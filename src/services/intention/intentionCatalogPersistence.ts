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

const DEFAULT_MEMO_WEIGHTS = {
  structure: 0.25,
  momentum: 0.25,
  zen: 0.25,
  stats: 0.25,
};

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
      if (draft.isAudioMemo) {
        const id = newRowId('audio_memo');
        await db.runAsync(
          `INSERT INTO intentions (
            id, title, description, status, priority, weights,
            platform_type, platform_user_id, created_at, synced,
            estimated_duration, actual_duration, completed_at,
            user_forced_urgent, is_late_night, alarm_enabled, is_flexible, is_micro_habit,
            is_hard_constraint, routine_id, anchor_date_ymd, fixed_start_minutes,
            raw_transcript, energy_score, local_notification_id, recurrence_rrule,
            type, parent_id, semantic_cluster_id, semantic_tags, sentiment_score, ping_history
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, 0, 0, 0, 1, 0, 0, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, '[]')`,
          [
            id,
            draft.title?.trim() || draft.content.trim().slice(0, 80) || 'Mémo audio',
            draft.content,
            'pending',
            1,
            JSON.stringify(DEFAULT_MEMO_WEIGHTS),
            'mobile',
            'local',
            now,
            5,
            draft.rawTranscript ?? draft.content,
            'audio_memo',
            JSON.stringify(['memo_audio']),
          ],
        );
      } else {
        await db.runAsync(`INSERT INTO quick_notes (id, content, created_at) VALUES (?, ?, ?)`, [
          newRowId('note'),
          draft.content,
          now,
        ]);
      }
    }
  });
}
