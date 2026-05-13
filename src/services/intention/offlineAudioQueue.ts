/**
 * File offline **SQLite** : copie audio locale, NOTE `is_pending_ai`, lignes `offline_audio_queue`
 * (schéma créé au bootstrap via `initTrankilV2Schema`), notifications — distincte de la queue AsyncStorage.
 *
 * @module offlineAudioQueue
 */
import * as FileSystem from 'expo-file-system/legacy';

import { insertTrankilV2Intention, withTrankilV2Database } from '../../api/trankilV2Db';
import i18n from '../../locales/i18n';
import { getNotifications } from '../notifications';
import { VERBOSE_DEBUG } from '../../config/verboseDebug';
import { newUuidV4 } from '../../utils/uuid';

export const OFFLINE_AUDIO_CATEGORY_ID = 'offline_audio_queue_actions';
export const OFFLINE_AUDIO_ACTION_ANALYZE = 'offline_audio_analyze';
export const OFFLINE_AUDIO_ACTION_KEEP = 'offline_audio_keep';

type OfflineQueuedAudioRow = {
  id: string;
  intention_id: string;
  transcript: string;
  audio_path: string;
  title: string;
  speech_lang?: string;
  status: 'pending' | 'analyzing' | 'kept' | 'done';
  created_at: number;
  notified_at: number | null;
  is_pending_ai?: number;
};

const OFFLINE_QUEUE_DIR = `${FileSystem.documentDirectory}offline_queue`;
const PROCESSED_RETENTION_MS = 48 * 60 * 60 * 1000;

function newQueueId(): string {
  return newUuidV4();
}

function newIntentionId(): string {
  return newUuidV4();
}

async function ensureOfflineQueueDirectory(): Promise<void> {
  await FileSystem.makeDirectoryAsync(OFFLINE_QUEUE_DIR, { intermediates: true });
}

/**
 * Met en file une capture avec audio : copie `.m4a` sous
 * `documentDirectory/offline_queue/`, NOTE + ligne `pending`, prêt pour replay OneTap.
 */
export async function queueOfflineAudioCapture(params: {
  transcript: string;
  audioUri: string;
  title: string;
  lang?: string;
}): Promise<{ intentionId: string; queueId: string; storedPath: string }> {
  if (__DEV__ && VERBOSE_DEBUG) {
    const now = new Date();
    console.log(`********** ${now.toLocaleString('fr-FR')} **********`);
    console.log(`********* [OFFLINE_QUEUE AUDIO] *********`);
    console.log(`[OFFLINE_QUEUE] 🧩 TRANSCRIPT (${params.transcript.length}c): "${String(params.transcript).slice(0, 160)}"`);
    console.log(`[OFFLINE_QUEUE] 🎧 AUDIO_URI: yes | LANG: ${params.lang || '—'}`);
  }
  await ensureOfflineQueueDirectory();
  const queueId = newQueueId();
  const intentionId = newIntentionId();
  const targetPath = `${OFFLINE_QUEUE_DIR}/${queueId}.m4a`;
  await FileSystem.copyAsync({ from: params.audioUri, to: targetPath });
  const now = Date.now();
  await insertTrankilV2Intention({
    id: intentionId,
    type: 'NOTE',
    title: params.title,
    content_raw: params.transcript,
    created_at: now,
    metadata_json: JSON.stringify({ source: 'offline_audio_queue', audio_path: targetPath, speech_lang: params.lang || null }),
    category_id: 'PERSO',
    is_pending_ai: 1,
  });
  await withTrankilV2Database(async (db) => {
    await db.runAsync(
      `INSERT INTO offline_audio_queue (id, intention_id, transcript, audio_path, title, speech_lang, status, is_pending_ai, created_at, notified_at, updated_at, is_dirty, server_version)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, NULL, ?, 1, 0)`,
      [queueId, intentionId, params.transcript, targetPath, params.title, params.lang || null, now, now],
    );
  });
  if (__DEV__ && VERBOSE_DEBUG) {
    console.log(`[OFFLINE_QUEUE] ✅ QUEUED: queueId=${queueId} | intentionId=${intentionId}`);
    console.log('***************************************');
  }
  return { intentionId, queueId, storedPath: targetPath };
}

/** Même file que l’audio mais sans copie fichier ; `audio_path` vide en base. */
export async function queueOfflineTextCapture(params: {
  transcript: string;
  title: string;
  lang?: string;
}): Promise<{ intentionId: string; queueId: string }> {
  if (__DEV__ && VERBOSE_DEBUG) {
    const now = new Date();
    console.log(`********** ${now.toLocaleString('fr-FR')} **********`);
    console.log(`********* [OFFLINE_QUEUE TEXT] *********`);
    console.log(`[OFFLINE_QUEUE] 🧩 TRANSCRIPT (${params.transcript.length}c): "${String(params.transcript).slice(0, 160)}"`);
    console.log(`[OFFLINE_QUEUE] 🎧 AUDIO_URI: no | LANG: ${params.lang || '—'}`);
  }
  const queueId = newQueueId();
  const intentionId = newIntentionId();
  const now = Date.now();
  await insertTrankilV2Intention({
    id: intentionId,
    type: 'NOTE',
    title: params.title,
    content_raw: params.transcript,
    created_at: now,
    metadata_json: JSON.stringify({ source: 'offline_audio_queue', speech_lang: params.lang || null }),
    category_id: 'PERSO',
    is_pending_ai: 1,
  });
  await withTrankilV2Database(async (db) => {
    await db.runAsync(
      `INSERT INTO offline_audio_queue (id, intention_id, transcript, audio_path, title, speech_lang, status, is_pending_ai, created_at, notified_at, updated_at, is_dirty, server_version)
       VALUES (?, ?, ?, '', ?, ?, 'pending', 1, ?, NULL, ?, 1, 0)`,
      [queueId, intentionId, params.transcript, params.title, params.lang || null, now, now],
    );
  });
  if (__DEV__ && VERBOSE_DEBUG) {
    console.log(`[OFFLINE_QUEUE] ✅ QUEUED: queueId=${queueId} | intentionId=${intentionId}`);
    console.log('***************************************');
  }
  return { intentionId, queueId };
}

/** Dernier élément `status = 'pending'` (le plus récent). */
export async function getLatestPendingOfflineAudio(): Promise<OfflineQueuedAudioRow | null> {
  return withTrankilV2Database(async (db) => {
    const row = await db.getFirstAsync<OfflineQueuedAudioRow>(
      `SELECT * FROM offline_audio_queue WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    );
    return row ?? null;
  });
}

/** Lecture directe par id de queue (ex. action notification). */
export async function getOfflineAudioById(queueId: string): Promise<OfflineQueuedAudioRow | null> {
  return withTrankilV2Database(async (db) => {
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
    /* best effort */
  }
}

/** Après analyse réussie : supprime le fichier audio copié, marque `done`. */
export async function markOfflineAudioAsDone(queueId: string): Promise<void> {
  await deleteQueuedAudioFile(queueId);
  await withTrankilV2Database(async (db) => {
    const now = Date.now();
    await db.runAsync(
      `UPDATE offline_audio_queue SET status = 'done', notified_at = COALESCE(notified_at, ?), updated_at = ?, is_dirty = 1 WHERE id = ?`,
      [now, now, queueId],
    );
  });
}

/** L’utilisateur garde la note sans relancer l’IA : fichier retiré, statut `kept`. */
export async function markOfflineAudioAsKept(queueId: string): Promise<void> {
  await deleteQueuedAudioFile(queueId);
  await withTrankilV2Database(async (db) => {
    const now = Date.now();
    await db.runAsync(
      `UPDATE offline_audio_queue SET status = 'kept', notified_at = COALESCE(notified_at, ?), updated_at = ?, is_dirty = 1 WHERE id = ?`,
      [now, now, queueId],
    );
  });
}

/**
 * Notification locale sticky + catégorie (Analyser / Garder audio) si un `pending`
 * n’a pas encore été notifié.
 */
export async function notifyOfflineAudioPendingAnalysis(): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  const pending = await getLatestPendingOfflineAudio();
  if (!pending || pending.notified_at) return;
  try {
    await n.setNotificationCategoryAsync(OFFLINE_AUDIO_CATEGORY_ID, [
      {
        identifier: OFFLINE_AUDIO_ACTION_ANALYZE,
        buttonTitle: i18n.t('notifications.offlineAnalyzeAction', { defaultValue: 'Analyser' }),
      },
      {
        identifier: OFFLINE_AUDIO_ACTION_KEEP,
        buttonTitle: i18n.t('notifications.offlineKeepAudioAction', { defaultValue: 'Garder audio' }),
      },
    ]);
  } catch {
    /* category unsupported */
  }
  await n.scheduleNotificationAsync({
    content: {
      title: i18n.t('notifications.offlineAudioReadyTitle', { defaultValue: 'Note hors-ligne disponible' }),
      body: i18n.t('notifications.offlineAudioReadyBody', {
        defaultValue: 'Une capture audio attend votre analyse.',
      }),
      data: { kind: 'offline_audio_queue', queueId: pending.id },
      categoryIdentifier: OFFLINE_AUDIO_CATEGORY_ID,
      sticky: true,
    },
    trigger: null,
  });
  await withTrankilV2Database(async (db) => {
    const now = Date.now();
    await db.runAsync(`UPDATE offline_audio_queue SET notified_at = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`, [
      now,
      now,
      pending.id,
    ]);
  });
}

/** Supprime entrées `done`/`kept` anciennes et leurs fichiers audio résiduels. */
export async function purgeProcessedQueue(): Promise<number> {
  const cutoff = Date.now() - PROCESSED_RETENTION_MS;
  return withTrankilV2Database(async (db) => {
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
