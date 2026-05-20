import type * as SQLite from 'expo-sqlite';

import { withTrankilV2Database } from './trankilV2Db';

async function ensureAppPrefsTable(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_prefs (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
}

export async function getAppPreference(key: string): Promise<string | null> {
  return withTrankilV2Database(async (db) => {
    await ensureAppPrefsTable(db);
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_prefs WHERE key = ?`,
      [key],
    );
    return row?.value ?? null;
  });
}

export async function setAppPreference(key: string, value: string): Promise<void> {
  await withTrankilV2Database(async (db) => {
    await ensureAppPrefsTable(db);
    await db.runAsync(`INSERT OR REPLACE INTO app_prefs (key, value) VALUES (?, ?)`, [key, value]);
  });
}

export async function clearAllAppPreferences(): Promise<void> {
  await withTrankilV2Database(async (db) => {
    await ensureAppPrefsTable(db);
    await db.execAsync(`DELETE FROM app_prefs;`);
  });
}
