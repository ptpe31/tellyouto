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
    completed_at INTEGER
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
}): Promise<void> {
  const database = await getLocalDatabase();
  await database.runAsync(
    `INSERT INTO intentions (
      id, title, description, status, priority, weights,
      platform_type, platform_user_id, created_at, synced,
      estimated_duration, actual_duration, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL)`,
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
    ],
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
