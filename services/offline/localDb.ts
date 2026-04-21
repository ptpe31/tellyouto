import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('phoenix_v2.db');
      await db.execAsync(`PRAGMA journal_mode = WAL;`);
      return db;
    })();
  }
  return dbPromise;
}

export async function withLocalDatabase<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await getDb();
  return fn(db);
}

