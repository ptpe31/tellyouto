import { withLocalDatabase } from '../../api/localDb';
import type { IntentionDraft } from './IntentionStateMachine';

async function ensureCatalogTables(): Promise<void> {
  await withLocalDatabase(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS trip_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        destination TEXT NOT NULL,
        arrival_time TEXT NOT NULL,
        safety_buffer_sec INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS timers (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        duration_sec INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        time TEXT NOT NULL,
        frequency TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        time TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS birthdays (
        id TEXT PRIMARY KEY NOT NULL,
        person_name TEXT NOT NULL,
        age INTEGER,
        date TEXT NOT NULL,
        special_tasks_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quick_notes (
        id TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  });
}

function newRowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function persistIntentionDrafts(drafts: IntentionDraft[]): Promise<void> {
  await ensureCatalogTables();
  const now = Date.now();
  await withLocalDatabase(async (db) => {
    for (const draft of drafts) {
      if (draft.kind === 'TRIP') {
        await db.runAsync(
          `INSERT INTO trip_tasks (id, destination, arrival_time, safety_buffer_sec, created_at) VALUES (?, ?, ?, ?, ?)`,
          [newRowId('trip'), draft.destination, draft.arrivalTime, draft.safetyBuffer, now],
        );
        continue;
      }
      if (draft.kind === 'TIMER') {
        await db.runAsync(
          `INSERT INTO timers (id, label, duration_sec, created_at) VALUES (?, ?, ?, ?)`,
          [newRowId('timer'), draft.label, draft.durationSec, now],
        );
        continue;
      }
      if (draft.kind === 'HABIT') {
        await db.runAsync(
          `INSERT INTO habits (id, title, time, frequency, created_at) VALUES (?, ?, ?, ?, ?)`,
          [newRowId('habit'), draft.title, draft.time, draft.frequency, now],
        );
        continue;
      }
      if (draft.kind === 'TASK') {
        await db.runAsync(
          `INSERT INTO tasks (id, title, time, notes, created_at) VALUES (?, ?, ?, ?, ?)`,
          [newRowId('task'), draft.title, draft.time, draft.notes, now],
        );
        continue;
      }
      if (draft.kind === 'BIRTHDAY') {
        await db.runAsync(
          `INSERT INTO birthdays (id, person_name, age, date, special_tasks_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            newRowId('birthday'),
            draft.personName,
            draft.age,
            draft.date,
            JSON.stringify(draft.specialTasks),
            now,
          ],
        );
        continue;
      }
      await db.runAsync(`INSERT INTO quick_notes (id, content, created_at) VALUES (?, ?, ?)`, [
        newRowId('note'),
        draft.content,
        now,
      ]);
    }
  });
}
