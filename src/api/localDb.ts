import * as SQLite from 'expo-sqlite';
import { deleteAsync } from 'expo-file-system/legacy';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import { DeviceEventEmitter, Platform } from 'react-native';

import type { SpectrumWeights } from '../context/UserSpectrumContext';

let db: SQLite.SQLiteDatabase | null = null;

export const DB_FILE_NAME = 'tellyouto.db';

/** Émis après DROP + recréation du schéma — ex. Radar recharge la liste. */
export const LOCAL_DB_RESET_EVENT = 'tellyouto/local_db_reset';

/**
 * Émis après un reset usine complet (DB + AsyncStorage nettoyés) — réinitialise les contextes en mémoire.
 */
export const DATABASE_RESET_COMPLETE_EVENT = 'tellyouto/database_reset_complete';

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
    alarm_enabled INTEGER NOT NULL DEFAULT 0,
    is_micro_habit INTEGER NOT NULL DEFAULT 0,
    is_hard_constraint INTEGER NOT NULL DEFAULT 0,
    routine_id TEXT,
    anchor_date_ymd TEXT,
    fixed_start_minutes INTEGER
  );

  CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    weekday INTEGER NOT NULL,
    start_minutes INTEGER NOT NULL,
    duration_min INTEGER NOT NULL,
    weights TEXT NOT NULL,
    priority INTEGER NOT NULL,
    platform_type TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_intentions_anchor ON intentions (anchor_date_ymd);
  CREATE INDEX IF NOT EXISTS idx_intentions_routine ON intentions (routine_id);

  CREATE TABLE IF NOT EXISTS micro_habit_checks (
    id TEXT PRIMARY KEY NOT NULL,
    intention_id TEXT NOT NULL,
    day_ymd TEXT NOT NULL,
    fragment_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_micro_habit_day ON micro_habit_checks (day_ymd);
  CREATE INDEX IF NOT EXISTS idx_intentions_synced ON intentions (synced);
  CREATE INDEX IF NOT EXISTS idx_intentions_created ON intentions (created_at DESC);
`;

function getPhysicalDatabasePaths(): string[] {
  if (!defaultDatabaseDirectory) return [];
  const dir = defaultDatabaseDirectory.replace(/\/*$/, '');
  return [
    `${dir}/${DB_FILE_NAME}`,
    `${dir}/${DB_FILE_NAME}-wal`,
    `${dir}/${DB_FILE_NAME}-shm`,
  ];
}

async function deletePhysicalDatabaseFiles(): Promise<void> {
  if (Platform.OS === 'web') return;
  for (const uri of getPhysicalDatabasePaths()) {
    try {
      await deleteAsync(uri, { idempotent: true });
    } catch {
      /* fichier absent ou verrou : on poursuit */
    }
  }
}

/**
 * Ferme la connexion SQLite, supprime les fichiers sur disque (hors web), recrée la base et les migrations.
 */
export async function dangerouslyResetDatabase(): Promise<void> {
  if (db) {
    try {
      await db.closeAsync();
    } catch {
      /* déjà fermée */
    }
    db = null;
  }

  if (Platform.OS === 'web') {
    const database = await SQLite.openDatabaseAsync(DB_FILE_NAME);
    await database.execAsync(`
      DROP TABLE IF EXISTS micro_habit_checks;
      DROP TABLE IF EXISTS intentions;
      DROP TABLE IF EXISTS routines;
      DROP TABLE IF EXISTS sync_queue;
    `);
    try {
      await database.closeAsync();
    } catch {
      /* */
    }
    db = null;
  } else {
    await deletePhysicalDatabaseFiles();
  }

  await getLocalDatabase();
  DeviceEventEmitter.emit(LOCAL_DB_RESET_EVENT);
}

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
  if (!names.has('is_micro_habit')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_micro_habit INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!names.has('is_hard_constraint')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_hard_constraint INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!names.has('routine_id')) {
    await database.execAsync(`ALTER TABLE intentions ADD COLUMN routine_id TEXT`);
  }
  if (!names.has('anchor_date_ymd')) {
    await database.execAsync(`ALTER TABLE intentions ADD COLUMN anchor_date_ymd TEXT`);
  }
  if (!names.has('fixed_start_minutes')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN fixed_start_minutes INTEGER`,
    );
  }
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      start_minutes INTEGER NOT NULL,
      duration_min INTEGER NOT NULL,
      weights TEXT NOT NULL,
      priority INTEGER NOT NULL,
      platform_type TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_intentions_anchor ON intentions (anchor_date_ymd);
    CREATE INDEX IF NOT EXISTS idx_intentions_routine ON intentions (routine_id);
  `);
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS micro_habit_checks (
      id TEXT PRIMARY KEY NOT NULL,
      intention_id TEXT NOT NULL,
      day_ymd TEXT NOT NULL,
      fragment_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_micro_habit_day ON micro_habit_checks (day_ymd);
  `);
}

/**
 * SQLite local — offline-first (intentions + file de sync).
 */
export async function getLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DB_FILE_NAME);
    await db.execAsync(SCHEMA);
    await migrateIntentionsColumns(db);
  }
  return db;
}

/**
 * Réinitialisation SQLite complète (fichiers supprimés sur mobile ; DROP sur web).
 * Préférer `performFullFactoryReset` depuis Debug pour reset usine + onboarding.
 */
export async function resetLocalDatabaseSchema(): Promise<void> {
  await dangerouslyResetDatabase();
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
  /** Micro-habitude (soin répété) — fragmentée sur le rail */
  is_micro_habit: boolean;
  /** Ancre structurelle (routine récurrente + heure) — créneau sanctuarisé */
  is_hard_constraint: boolean;
  routine_id: string | null;
  /** Jour calendaire de cette instance (AAAA-MM-JJ local), null = flottant */
  anchor_date_ymd: string | null;
  /** Début d’ancrage rail (minutes depuis minuit), null = placement libre */
  fixed_start_minutes: number | null;
};

export type RoutineRow = {
  id: string;
  title: string;
  description: string;
  weekday: number;
  start_minutes: number;
  duration_min: number;
  weights: SpectrumWeights;
  priority: number;
  platform_type: string;
  platform_user_id: string;
  created_at: number;
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
    is_micro_habit:
      row.is_micro_habit != null && Number(row.is_micro_habit) === 1,
    is_hard_constraint:
      row.is_hard_constraint != null && Number(row.is_hard_constraint) === 1,
    routine_id: (row.routine_id as string) ?? null,
    anchor_date_ymd: (row.anchor_date_ymd as string) ?? null,
    fixed_start_minutes:
      typeof row.fixed_start_minutes === 'number'
        ? row.fixed_start_minutes
        : null,
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
  is_micro_habit?: boolean;
  is_hard_constraint?: boolean;
  routine_id?: string | null;
  anchor_date_ymd?: string | null;
  fixed_start_minutes?: number | null;
}): Promise<void> {
  const database = await getLocalDatabase();
  const ufu = input.user_forced_urgent ? 1 : 0;
  const iln = input.is_late_night ? 1 : 0;
  const alarm = input.alarm_enabled ? 1 : 0;
  const micro = input.is_micro_habit ? 1 : 0;
  const hard = input.is_hard_constraint ? 1 : 0;
  await database.runAsync(
    `INSERT INTO intentions (
      id, title, description, status, priority, weights,
      platform_type, platform_user_id, created_at, synced,
      estimated_duration, actual_duration, completed_at,
      user_forced_urgent, is_late_night, alarm_enabled, is_micro_habit,
      is_hard_constraint, routine_id, anchor_date_ymd, fixed_start_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      micro,
      hard,
      input.routine_id ?? null,
      input.anchor_date_ymd ?? null,
      input.fixed_start_minutes ?? null,
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
  is_micro_habit?: boolean;
}): Promise<void> {
  const database = await getLocalDatabase();
  const ufu = input.user_forced_urgent ? 1 : 0;
  const iln = input.is_late_night ? 1 : 0;
  const alarm = input.alarm_enabled ? 1 : 0;
  const micro = input.is_micro_habit ? 1 : 0;
  await database.runAsync(
    `INSERT INTO intentions (
      id, title, description, status, priority, weights,
      platform_type, platform_user_id, created_at, synced,
      estimated_duration, actual_duration, completed_at,
      user_forced_urgent, is_late_night, alarm_enabled, is_micro_habit,
      is_hard_constraint, routine_id, anchor_date_ymd, fixed_start_minutes
    ) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL)`,
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
      micro,
    ],
  );
}

export async function recordMicroHabitFragmentCheck(input: {
  id: string;
  intention_id: string;
  day_ymd: string;
  fragment_index: number;
}): Promise<void> {
  const database = await getLocalDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO micro_habit_checks (id, intention_id, day_ymd, fragment_index, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.id,
      input.intention_id,
      input.day_ymd,
      input.fragment_index,
      Date.now(),
    ],
  );
}

export async function countMicroHabitChecksOnDay(dayYmd: string): Promise<number> {
  const database = await getLocalDatabase();
  const row = await database.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM micro_habit_checks WHERE day_ymd = ?`,
    [dayYmd],
  );
  return row?.c ?? 0;
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Date locale AAAA-MM-JJ */
export function formatLocalDateYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export async function insertRoutine(input: RoutineRow): Promise<void> {
  const database = await getLocalDatabase();
  await database.runAsync(
    `INSERT INTO routines (
      id, title, description, weekday, start_minutes, duration_min, weights,
      priority, platform_type, platform_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.title,
      input.description,
      input.weekday,
      input.start_minutes,
      input.duration_min,
      JSON.stringify(input.weights),
      input.priority,
      input.platform_type,
      input.platform_user_id,
      input.created_at,
    ],
  );
}

/**
 * Génère une instance d’intention par jour calendaire correspondant au motif (horizon glissant).
 */
export async function ensureRoutineIntentionInstancesForHorizon(
  routineId: string,
  platformUserId: string,
  horizonDays = 14,
): Promise<void> {
  const database = await getLocalDatabase();
  const row = await database.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM routines WHERE id = ?`,
    [routineId],
  );
  if (!row) return;

  const routine: RoutineRow = {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    weekday: row.weekday as number,
    start_minutes: row.start_minutes as number,
    duration_min: row.duration_min as number,
    weights: JSON.parse(row.weights as string) as SpectrumWeights,
    priority: row.priority as number,
    platform_type: row.platform_type as string,
    platform_user_id: row.platform_user_id as string,
    created_at: row.created_at as number,
  };

  const uid = platformUserId.trim() || routine.platform_user_id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let delta = 0; delta < horizonDays; delta++) {
    const d = new Date(today);
    d.setDate(d.getDate() + delta);
    if (d.getDay() !== routine.weekday) continue;

    const ymd = formatLocalDateYmd(d);
    const intentionId = `${routineId}_${ymd}`;

    const existing = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM intentions WHERE id = ?`,
      [intentionId],
    );
    if (existing) continue;

    await database.runAsync(
      `INSERT INTO intentions (
        id, title, description, status, priority, weights,
        platform_type, platform_user_id, created_at, synced,
        estimated_duration, actual_duration, completed_at,
        user_forced_urgent, is_late_night, alarm_enabled, is_micro_habit,
        is_hard_constraint, routine_id, anchor_date_ymd, fixed_start_minutes
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, NULL, NULL, 0, 0, 0, 0, 1, ?, ?, ?, ?)`,
      [
        intentionId,
        routine.title,
        routine.description,
        routine.priority,
        JSON.stringify(routine.weights),
        routine.platform_type,
        uid,
        Date.now(),
        routine.duration_min,
        routineId,
        ymd,
        routine.start_minutes,
      ],
    );
  }
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
