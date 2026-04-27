import * as SQLite from 'expo-sqlite';

export async function wipeLegacyDatabasesOnBoot(): Promise<void> {
  if (!__DEV__) return;
  const names = ['talkndone.db', 'trankil_v2.db'];
  await Promise.all(
    names.map(async (name) => {
      try {
        await SQLite.deleteDatabaseAsync(name);
      } catch {
      }
    })
  );
}

