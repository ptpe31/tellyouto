import * as SQLite from 'expo-sqlite';
import { DeviceEventEmitter } from 'react-native';

import type { SpectrumWeights } from '../context/UserSpectrumContext';

let db: SQLite.SQLiteDatabase | null = null;

/** Émis après DROP + recréation du schéma — ex. Radar recharge la liste. */
export const LOCAL_DB_RESET_EVENT = 'tellyouto/local_db_reset';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS intentions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL,
    weights TEXT NOT NULL,
    platform_type TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    estimated_duration INTEGER NOT NULL DEFAULT 25,
    actual_duration INTEGER,
    completed_at INTEGER,
    user_forced_urgent INTEGER NOT NULL DEFAULT 0,
    is_late_night INTEGER NOT NULL DEFAULT 0,
    alarm_enabled INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_intentions_synced ON intentions (synced);
  CREATE INDEX IF NOT EXISTS idx_intentions_created ON intentions (created_at DESC);
`;

async function migrateIntentionsColumns(database: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(intentions)`,
  );
  const names = new Set(rows.map((r) => r.name));
  if (!names.has('estimated_duration')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN estimated_duration INTEGER NOT NULL DEFAULT 25`,
    );
  }
  if (!names.has('actual_duration')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN actual_duration INTEGER`,
    );
  }
  if (!names.has('completed_at')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN completed_at INTEGER`,
    );
    await database.runAsync(
      `UPDATE intentions SET completed_at = created_at WHERE status = 'done' AND actual_duration IS NOT NULL AND completed_at IS NULL`,
    );
  }
  if (!names.has('user_forced_urgent')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN user_forced_urgent INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!names.has('is_late_night')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_late_night INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!names.has('alarm_enabled')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN alarm_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

/**
 * SQLite local — offline-first (intentions + file de sync).
 */
export async function getLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('tellyouto.db');
    await db.execAsync(SCHEMA);
    await migrateIntentionsColumns(db);
  }
  return db;
}

/**
 * DROP des tables puis recréation du schéma (comme au premier lancement).
 * Réinitialise le cache module `db` pour éviter un état incohérent.
 */
export async function resetLocalDatabaseSchema(): Promise<void> {
  const database =
    db ?? (await SQLite.openDatabaseAsync('tellyouto.db'));
  await database.execAsync(`
    DROP TABLE IF EXISTS intentions;
    DROP TABLE IF EXISTS sync_queue;
  `);
  db = null;
  await getLocalDatabase();
  DeviceEventEmitter.emit(LOCAL_DB_RESET_EVENT);
}

export type IntentionStatus = 'pending' | 'active' | 'done';

export type IntentionRow = {
  id: string;
  title: string;
  description: string;
  status: IntentionStatus;
  priority: number;
  weights: SpectrumWeights;
  platform_type: string;
  platform_user_id: string;
  created_at: number;
  synced: number;
  /** Durée prévue en minutes */
  estimated_duration: number;
  /** Durée réelle en minutes (après Capsule), null si non terminée */
  actual_duration: number | null;
  /** Horodatage fin de session focus (ms), pour stats / historique */
  completed_at: number | null;
  /** Case « Urgent » cochée à la création (Radar) */
  user_forced_urgent: boolean;
  /** Fin de journée / coucher — classé par l’agent (rail après 21h) */
  is_late_night: boolean;
  /** Notification à l’heure du créneau suggéré sur le rail */
  alarm_enabled: boolean;
};

function rowToIntention(row: Record<string, unknown>): IntentionRow {
  const weightsRaw = row.weights as string;
  let weights: SpectrumWeights;
  try {
    weights = JSON.parse(weightsRaw) as SpectrumWeights;
  } catch {
    weights = {
      structure: 0.25,
      momentum: 0.25,
      zen: 0.25,
      stats: 0.25,
    };
  }
  const est = row.estimated_duration;
  const act = row.actual_duration;
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as IntentionStatus,
    priority: row.priority as number,
    weights,
    platform_type: row.platform_type as string,
    platform_user_id: row.platform_user_id as string,
    created_at: row.created_at as number,
    synced: row.synced as number,
    estimated_duration:
      typeof est === 'number' ? est : 25,
    actual_duration: typeof act === 'number' ? act : null,
    completed_at:
      typeof row.completed_at === 'number' ? row.completed_at : null,
    user_forced_urgent: Number(row.user_forced_urgent) === 1,
    is_late_night: Number(row.is_late_night) === 1,
    alarm_enabled:
      row.alarm_enabled != null && Number(row.alarm_enabled) === 1,
  };
}

export async function insertIntention(input: {
  id: string;
  title: string;
  description: string;
  status: IntentionStatus;
  priority: number;
  weights: SpectrumWeights;
  platform_type: string;
  platform_user_id: string;
  created_at: number;
  estimated_duration: number;
  user_forced_urgent?: boolean;
  is_late_night?: boolean;
  alarm_enabled?: boolean;
}): Promise<void> {
  const database = await getLocalDatabase();
  const ufu = input.user_forced_urgent ? 1 : 0;
  const iln = input.is_late_night ? 1 : 0;
  const alarm = input.alarm_enabled ? 1 : 0;
  await database.runAsync(
    `INSERT INTO intentions (
      id, title, description, status, priority, weights,
      platform_type, platform_user_id, created_at, synced,
      estimated_duration, actual_duration, completed_at,
      user_forced_urgent, is_late_night, alarm_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?, ?)`,
    [
      input.id,
      input.title,
      input.description,
      input.status,
      input.priority,
      JSON.stringify(input.weights),
      input.platform_type,
      input.platform_user_id,
      input.created_at,
      input.estimated_duration,
      ufu,
      iln,
      alarm,
    ],
  );
}

/** Session déjà terminée (démo / outils pilote) — conserve durées réelles pour les stats. */
export async function insertCompletedIntention(input: {
  id: string;
  title: string;
  description: string;
  priority: number;
  weights: SpectrumWeights;
  platform_type: string;
  platform_user_id: string;
  created_at: number;
  estimated_duration: number;
  actual_duration: number;
  completed_at: number;
  user_forced_urgent?: boolean;
  is_late_night?: boolean;
  alarm_enabled?: boolean;
}): Promise<void> {
  const database = await getLocalDatabase();
  const ufu = input.user_forced_urgent ? 1 : 0;
  const iln = input.is_late_night ? 1 : 0;
  const alarm = input.alarm_enabled ? 1 : 0;
  await database.runAsync(
    `INSERT INTO intentions (
      id, title, description, status, priority, weights,
      platform_type, platform_user_id, created_at, synced,
      estimated_duration, actual_duration, completed_at,
      user_forced_urgent, is_late_night, alarm_enabled
    ) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.title,
      input.description,
      input.priority,
      JSON.stringify(input.weights),
      input.platform_type,
      input.platform_user_id,
      input.created_at,
      input.estimated_duration,
      input.actual_duration,
      input.completed_at,
      ufu,
      iln,
      alarm,
    ],
  );
}

export async function updateIntentionAlarmEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const database = await getLocalDatabase();
  await database.runAsync(
    `UPDATE intentions SET alarm_enabled = ?, synced = 0 WHERE id = ?`,
    [enabled ? 1 : 0, id],
  );
}

export async function getIntentionById(
  id: string,
): Promise<IntentionRow | null> {
  const database = await getLocalDatabase();
  const row = await database.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM intentions WHERE id = ?`,
    [id],
  );
  return row ? rowToIntention(row) : null;
}

export async function markIntentionActive(id: string): Promise<void> {
  const database = await getLocalDatabase();
  await database.runAsync(
    `UPDATE intentions SET status = 'active', synced = 0 WHERE id = ?`,
    [id],
  );
}

export async function updateIntentionAfterFocus(input: {
  id: string;
  actual_duration: number;
  status: IntentionStatus;
}): Promise<void> {
  const database = await getLocalDatabase();
  const completedAt = input.status === 'done' ? Date.now() : null;
  await database.runAsync(
    `UPDATE intentions SET actual_duration = ?, status = ?, synced = 0, completed_at = ? WHERE id = ?`,
    [input.actual_duration, input.status, completedAt, input.id],
  );
  if (input.status === 'done') {
    void import('../services/alarmManager').then(({ cancelIntentionRailAlarm }) => {
      void cancelIntentionRailAlarm(input.id);
    });
  }
}

/** Termine une intention depuis la liste (sans session timer) — durée indicative pour l’historique. */
export async function markIntentionQuickComplete(id: string): Promise<void> {
  const row = await getIntentionById(id);
  if (!row || row.status === 'done') return;
  const actual = Math.max(1, Math.min(row.estimated_duration, 45));
  await updateIntentionAfterFocus({
    id: row.id,
    actual_duration: actual,
    status: 'done',
  });
}

export async function listIntentionsDescending(): Promise<IntentionRow[]> {
  const database = await getLocalDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM intentions ORDER BY priority DESC, created_at DESC`,
  );
  return rows.map(rowToIntention);
}

export async function listUnsyncedIntentions(): Promise<IntentionRow[]> {
  const database = await getLocalDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM intentions WHERE synced = 0`,
  );
  return rows.map(rowToIntention);
}

export async function markIntentionSynced(id: string): Promise<void> {
  const database = await getLocalDatabase();
  await database.runAsync(`UPDATE intentions SET synced = 1 WHERE id = ?`, [
    id,
  ]);
}

/** Sessions focus terminées dont l’horodatage (completed_at ou repli created_at) est dans [startMs, endMs]. */
export async function listCompletedSessionsBetween(
  startMs: number,
  endMs: number,
): Promise<IntentionRow[]> {
  const database = await getLocalDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM intentions
     WHERE status = 'done' AND actual_duration IS NOT NULL
       AND COALESCE(completed_at, created_at) >= ?
       AND COALESCE(completed_at, created_at) <= ?
     ORDER BY COALESCE(completed_at, created_at) DESC`,
    [startMs, endMs],
  );
  return rows.map(rowToIntention);
}

/** Dernières sessions terminées — pour historique par jour (grouper côté UI). */
export async function listRecentCompletedFocusSessions(
  limit: number,
): Promise<IntentionRow[]> {
  const database = await getLocalDatabase();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM intentions
     WHERE status = 'done' AND actual_duration IS NOT NULL
     ORDER BY COALESCE(completed_at, created_at) DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(rowToIntention);
}

/**
 * Pousse le journal SQLite (WAL) vers le disque — à appeler en arrière-plan
 * avant suspension / fermeture pour limiter la perte de données.
 */
export async function checkpointLocalDatabase(): Promise<void> {
  try {
    const database = await getLocalDatabase();
    await database.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    /* mode journal non-WAL ou indisponible : ignoré */
  }
}
