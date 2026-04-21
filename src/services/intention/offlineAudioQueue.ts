import * as FileSystem from 'expo-file-system/legacy';

import { insertIntention, withLocalDatabase } from '../../api/localDb';
import { getNotifications } from '../notifications';
import i18n from '../../locales/i18n';

export const OFFLINE_AUDIO_CATEGORY_ID = 'offline_audio_queue_actions';
export const OFFLINE_AUDIO_ACTION_ANALYZE = 'offline_audio_analyze';
export const OFFLINE_AUDIO_ACTION_KEEP = 'offline_audio_keep';

type OfflineQueuedAudioRow = {
  id: string;
  intention_id: string;
  transcript: string;
  audio_path: string;
  title: string;
  status: 'pending' | 'analyzing' | 'kept' | 'done';
  created_at: number;
  notified_at: number | null;
};

const OFFLINE_QUEUE_DIR = `${FileSystem.documentDirectory}offline_queue`;
const PROCESSED_RETENTION_MS = 48 * 60 * 60 * 1000;

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function ensureOfflineAudioQueueTable(): Promise<void> {
  await withLocalDatabase(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS offline_audio_queue (
        id TEXT PRIMARY KEY NOT NULL,
        intention_id TEXT NOT NULL,
        transcript TEXT NOT NULL,
        audio_path TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        notified_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_offline_audio_queue_status ON offline_audio_queue (status, created_at DESC);
    `);
  });
}

async function ensureOfflineQueueDirectory(): Promise<void> {
  await FileSystem.makeDirectoryAsync(OFFLINE_QUEUE_DIR, { intermediates: true });
}

export async function queueOfflineAudioCapture(params: {
  transcript: string;
  audioUri: string;
  title: string;
}): Promise<{ intentionId: string; queueId: string; storedPath: string }> {
  await ensureOfflineAudioQueueTable();
  await ensureOfflineQueueDirectory();
  const queueId = newId('offline_audio');
  const intentionId = newId('offline_intention');
  const targetPath = `${OFFLINE_QUEUE_DIR}/${queueId}.m4a`;
  await FileSystem.copyAsync({ from: params.audioUri, to: targetPath });
  const now = Date.now();
  await insertIntention({
    id: intentionId,
    title: params.title,
    description: params.transcript,
    status: 'pending',
    priority: 1,
    weights: { structure: 0.25, momentum: 0.25, zen: 0.25, stats: 0.25 },
    platform_type: 'mobile',
    platform_user_id: 'local',
    created_at: now,
    estimated_duration: 5,
    raw_transcript: params.transcript,
    type: 'audio_memo',
    semantic_tags: ['offline_queue'],
    is_pending_analysis: true,
  });
  await withLocalDatabase(async (db) => {
    await db.runAsync(
      `INSERT INTO offline_audio_queue (id, intention_id, transcript, audio_path, title, status, created_at, notified_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
      [queueId, intentionId, params.transcript, targetPath, params.title, now],
    );
  });
  return { intentionId, queueId, storedPath: targetPath };
}

export async function getPendingOfflineAudioCount(): Promise<number> {
  await ensureOfflineAudioQueueTable();
  return withLocalDatabase(async (db) => {
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM offline_audio_queue WHERE status = 'pending'`,
    );
    return Number(row?.c ?? 0);
  });
}

export async function getLatestPendingOfflineAudio(): Promise<OfflineQueuedAudioRow | null> {
  await ensureOfflineAudioQueueTable();
  return withLocalDatabase(async (db) => {
    const row = await db.getFirstAsync<OfflineQueuedAudioRow>(
      `SELECT * FROM offline_audio_queue WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    );
    return row ?? null;
  });
}

export async function getOfflineAudioById(queueId: string): Promise<OfflineQueuedAudioRow | null> {
  await ensureOfflineAudioQueueTable();
  return withLocalDatabase(async (db) => {
    const row = await db.getFirstAsync<OfflineQueuedAudioRow>(
      `SELECT * FROM offline_audio_queue WHERE id = ? LIMIT 1`,
      [queueId],
    );
    return row ?? null;
  });
}

async function deleteQueuedAudioFile(queueId: string): Promise<void> {
  const row = await getOfflineAudioById(queueId);
  const path = row?.audio_path?.trim();
  if (!path) return;
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    /* delete best effort */
  }
}

export async function markOfflineAudioAsDone(queueId: string): Promise<void> {
  await ensureOfflineAudioQueueTable();
  await deleteQueuedAudioFile(queueId);
  await withLocalDatabase(async (db) => {
    await db.runAsync(
      `UPDATE offline_audio_queue SET status = 'done', notified_at = COALESCE(notified_at, ?) WHERE id = ?`,
      [Date.now(), queueId],
    );
    await db.runAsync(`UPDATE intentions SET is_pending_analysis = 0 WHERE id = (SELECT intention_id FROM offline_audio_queue WHERE id = ?)`, [
      queueId,
    ]);
  });
}

export async function markOfflineAudioAsKept(queueId: string): Promise<void> {
  await ensureOfflineAudioQueueTable();
  await deleteQueuedAudioFile(queueId);
  await withLocalDatabase(async (db) => {
    await db.runAsync(`UPDATE offline_audio_queue SET status = 'kept', notified_at = COALESCE(notified_at, ?) WHERE id = ?`, [
      Date.now(),
      queueId,
    ]);
  });
}

export async function notifyOfflineAudioPendingAnalysis(): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  await ensureOfflineAudioQueueTable();
  const pending = await getLatestPendingOfflineAudio();
  if (!pending) return;
  if (pending.notified_at) return;
  try {
    await n.setNotificationCategoryAsync(OFFLINE_AUDIO_CATEGORY_ID, [
      {
        identifier: OFFLINE_AUDIO_ACTION_ANALYZE,
        buttonTitle: i18n.t('notifications.offlineAnalyzeAction'),
      },
      {
        identifier: OFFLINE_AUDIO_ACTION_KEEP,
        buttonTitle: i18n.t('notifications.offlineKeepAudioAction'),
        options: { isDestructive: false },
      },
    ]);
  } catch {
    /* keep simple fallback without category */
  }
  await n.scheduleNotificationAsync({
    content: {
      title: i18n.t('notifications.offlineAudioReadyTitle'),
      body: i18n.t('notifications.offlineAudioReadyBody'),
      data: {
        kind: 'offline_audio_queue',
        queueId: pending.id,
      },
      categoryIdentifier: OFFLINE_AUDIO_CATEGORY_ID,
      sticky: true,
    },
    trigger: null,
  });
  await withLocalDatabase(async (db) => {
    await db.runAsync(`UPDATE offline_audio_queue SET notified_at = ? WHERE id = ?`, [Date.now(), pending.id]);
  });
}

/** Purge discrète des entrées traitées/kept > 48h. */
export async function purgeProcessedQueue(): Promise<number> {
  await ensureOfflineAudioQueueTable();
  const cutoff = Date.now() - PROCESSED_RETENTION_MS;
  return withLocalDatabase(async (db) => {
    const rows = await db.getAllAsync<{ id: string; audio_path: string | null }>(
      `SELECT id, audio_path FROM offline_audio_queue
       WHERE (status = 'done' OR status = 'kept')
         AND COALESCE(notified_at, created_at) < ?`,
      [cutoff],
    );
    for (const row of rows) {
      const path = typeof row.audio_path === 'string' ? row.audio_path.trim() : '';
      if (!path) continue;
      try {
        await FileSystem.deleteAsync(path, { idempotent: true });
      } catch {
        /* best effort */
      }
    }
    await db.runAsync(
      `DELETE FROM offline_audio_queue
       WHERE (status = 'done' OR status = 'kept')
         AND COALESCE(notified_at, created_at) < ?`,
      [cutoff],
    );
    return rows.length;
  });
}
