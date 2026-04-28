import * as SQLite from 'expo-sqlite';

import { Platform } from '../utils/rnPlatform';

const DB_FILE_NAME = 'talkndone.db';

let db: SQLite.SQLiteDatabase | null = null;
let openingDb: Promise<SQLite.SQLiteDatabase> | null = null;

let pragmasApplied = false;

let sqliteQueueTail: Promise<unknown> = Promise.resolve();
let sqliteReentrantDepth = 0;

async function runSerializedSqlite<T>(operation: () => Promise<T>): Promise<T> {
  if (sqliteReentrantDepth > 0) {
    return operation();
  }
  const next = sqliteQueueTail.then(async () => {
    sqliteReentrantDepth += 1;
    try {
      return await operation();
    } finally {
      sqliteReentrantDepth -= 1;
    }
  });
  sqliteQueueTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function ensureDbReady(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    openingDb ??= SQLite.openDatabaseAsync(DB_FILE_NAME);
    try {
      db = await openingDb;
    } finally {
      openingDb = null;
    }
  }

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_prefs (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  if (!pragmasApplied && Platform.OS !== 'web') {
    try {
      await db.execAsync('PRAGMA journal_mode=WAL;');
      await db.execAsync('PRAGMA busy_timeout=8000;');
    } catch {}
    pragmasApplied = true;
  }

  return db;
}

export async function getAppPreference(key: string): Promise<string | null> {
  return runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const row = await database.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_prefs WHERE key = ?`,
      [key],
    );
    return row?.value ?? null;
  });
}

export async function setAppPreference(key: string, value: string): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(
      `INSERT OR REPLACE INTO app_prefs (key, value) VALUES (?, ?)`,
      [key, value],
    );
  });
}

export async function clearAllAppPreferences(): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.execAsync(`DELETE FROM app_prefs;`);
  });
}
