import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

export const VIA_DB_NAME = 'via_production.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let schemaReady = false;

export async function getOrCreateViaUserId(): Promise<string> {
  const k = '@tellyouto/via_user_id';
  const existing = (await AsyncStorage.getItem(k))?.trim();
  if (existing) return existing;
  const next = randomUUID();
  await AsyncStorage.setItem(k, next);
  return next;
}

export async function ensureViaSchema(): Promise<void> {
  const db = await getViaDb();
  if (schemaReady) return;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout=8000;

    CREATE TABLE IF NOT EXISTS user_profile (
      user_id TEXT PRIMARY KEY NOT NULL,
      is_pro_user INTEGER NOT NULL DEFAULT 0 CHECK (is_pro_user IN (0, 1)),
      sentinel_trial_balance INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0 CHECK (is_synced IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS via_locations (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      alias TEXT,
      formatted_address TEXT NOT NULL,
      place_id TEXT,
      lat REAL,
      lng REAL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0 CHECK (is_synced IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_via_locations_user_alias
      ON via_locations (user_id, alias);
    CREATE INDEX IF NOT EXISTS idx_via_locations_user_place
      ON via_locations (user_id, place_id);

    CREATE TABLE IF NOT EXISTS via_sentinel_trips (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      target_arrival_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      sentinel_mode TEXT NOT NULL DEFAULT 'SENTINEL',
      last_traffic_duration_sec INTEGER NOT NULL DEFAULT 0,
      internal_scan_count INTEGER NOT NULL DEFAULT 0,
      next_check_at_ms INTEGER,
      gate_prompted_at_ms INTEGER,
      last_error_at_ms INTEGER,
      t_optimiste_ms INTEGER,
      t_pessimiste_ms INTEGER,
      vigilance_status TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0 CHECK (is_synced IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_via_sentinel_trips_user_status
      ON via_sentinel_trips (user_id, status);
    CREATE INDEX IF NOT EXISTS idx_via_sentinel_trips_arrival
      ON via_sentinel_trips (target_arrival_ms);

    CREATE TABLE IF NOT EXISTS core_intentions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content_raw TEXT NOT NULL DEFAULT '',
      due_at_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0 CHECK (is_synced IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_core_intentions_user_due
      ON core_intentions (user_id, due_at_ms);
  `);
  schemaReady = true;
}

export async function withViaDb<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await getViaDb();
  await ensureViaSchema();
  return fn(db);
}

async function getViaDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(VIA_DB_NAME);
  }
  return dbPromise;
}
