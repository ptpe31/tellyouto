/**
 * Couche **SQLite** : source de vérité **offline-first** pour les intentions, routines, file de sync.
 *
 * **Pourquoi** : le réseau est optionnel ; l’utilisateur doit voir et entendre ses engagements
 * même en mode avion. Toute logique métier « critique » (alarme, rail) lit ici en premier.
 *
 * **Sérialisation** : {@link runSerializedSqlite} garantit une file d’attente unique pour éviter les
 * verrous et les `finalizeAsync` concurrents (Android).
 *
 * **Reset** : {@link deleteAllIntentions} exécute transaction + `VACUUM`, purge les notifications Expo,
 * puis émet {@link INTENTIONS_CHANGED_EVENT_NAME} pour que les écrans se vident.
 *
 * @module localDb
 */
import * as SQLite from 'expo-sqlite';
import { deleteAsync } from 'expo-file-system/legacy';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import { DeviceEventEmitter } from 'react-native';

import { Platform } from '../utils/rnPlatform';

import type { SpectrumWeights } from '../context/UserSpectrumContext';
import {
  APP_PREF_RAIL_ALARM_SOUND_KEY,
  normalizeRailAlarmSoundId,
  type RailAlarmSoundId,
} from '../services/railAlarmSound';
import { syncNativeRailAlarmsAfterIntentionWrite } from './intentionHardwareSync';
import {
  alertNativeModuleMissing,
  isLikelyMissingNativeModuleError,
} from '../utils/nativeModuleErrorAlert';

let db: SQLite.SQLiteDatabase | null = null;
/** Évite deux ouvertures concurrentes (cold start : alarmes + écrans). */
let openingDb: Promise<SQLite.SQLiteDatabase> | null = null;

/** File d’attente réentrante : un seul flux SQLite à la fois, sans blocage si sync appelle listIntentions depuis insert. */
let sqliteQueueTail: Promise<unknown> = Promise.resolve();
let sqliteReentrantDepth = 0;

/**
 * Exécute une opération SQLite dans une **file d’attente globale** (réentrante si déjà dans la file).
 *
 * @param operation Callback async contenant `runAsync` / `withTransactionAsync` / `execAsync`.
 * @returns Résultat de l’opération.
 */
export function runSerializedSqlite<T>(operation: () => Promise<T>): Promise<T> {
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

/**
 * Lit une entrée générique de préférences locales (SQLite).
 *
 * @param key Clé stable (ex. {@link APP_PREF_RAIL_ALARM_SOUND_KEY}).
 * @returns Valeur stockée ou `null`.
 */
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

/**
 * Upsert d’une préférence clé/valeur (profil alarme, etc.).
 */
export async function setAppPreference(
  key: string,
  value: string,
): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(
      `INSERT OR REPLACE INTO app_prefs (key, value) VALUES (?, ?)`,
      [key, value],
    );
  });
}

/**
 * Sonnerie rail préférée persistée en SQLite (lue par `alarmManager` hors React).
 */
export async function getPreferredRailAlarmSoundId(): Promise<RailAlarmSoundId> {
  const v = await getAppPreference(APP_PREF_RAIL_ALARM_SOUND_KEY);
  return normalizeRailAlarmSoundId(v);
}

/**
 * Aligner SQLite sur le profil utilisateur (AsyncStorage) après changement de sonnerie.
 */
export async function syncPreferredRailAlarmSoundToSqlite(
  soundId: RailAlarmSoundId,
): Promise<void> {
  await setAppPreference(APP_PREF_RAIL_ALARM_SOUND_KEY, soundId);
}

let pragmasApplied = false;
/** Après le premier `execAsync(SCHEMA)` réussi de la session — évite de re-parser le DDL à chaque accès. */
let sessionSchemaPrimed = false;

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
    is_flexible INTEGER NOT NULL DEFAULT 1,
    is_micro_habit INTEGER NOT NULL DEFAULT 0,
    is_hard_constraint INTEGER NOT NULL DEFAULT 0,
    routine_id TEXT,
    anchor_date_ymd TEXT,
    fixed_start_minutes INTEGER,
    raw_transcript TEXT,
    energy_score REAL,
    local_notification_id TEXT,
    recurrence_rrule TEXT
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

  CREATE TABLE IF NOT EXISTS app_prefs (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
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
  await runSerializedSqlite(async () => {
    openingDb = null;
    pragmasApplied = false;
    sessionSchemaPrimed = false;
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
      DROP TABLE IF EXISTS app_prefs;
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

    await ensureDbReady();
  });
  try {
    const { cancelAllScheduledRailAlarms } = await import(
      '../services/alarmManager'
    );
    await cancelAllScheduledRailAlarms();
  } catch {
    /* Expo Go / module indisponible */
  }
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
  if (!names.has('raw_transcript')) {
    await database.execAsync(`ALTER TABLE intentions ADD COLUMN raw_transcript TEXT`);
  }
  if (!names.has('energy_score')) {
    await database.execAsync(`ALTER TABLE intentions ADD COLUMN energy_score REAL`);
  }
  if (!names.has('local_notification_id')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN local_notification_id TEXT`,
    );
  }
  if (!names.has('recurrence_rrule')) {
    await database.execAsync(`ALTER TABLE intentions ADD COLUMN recurrence_rrule TEXT`);
  }
  if (!names.has('is_flexible')) {
    await database.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_flexible INTEGER NOT NULL DEFAULT 1`,
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
 * Ouvre la base si besoin, applique schéma + migrations + PRAGMAs (WAL / busy_timeout sur mobile).
 * À n’appeler que depuis `runSerializedSqlite` ou `withLocalDatabase`.
 */
async function ensureDbReady(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    openingDb ??= SQLite.openDatabaseAsync(DB_FILE_NAME);
    try {
      db = await openingDb;
    } catch (e) {
      openingDb = null;
      throw e;
    } finally {
      openingDb = null;
    }
  }
  if (!sessionSchemaPrimed) {
    await db.execAsync(SCHEMA);
    sessionSchemaPrimed = true;
  }
  await migrateIntentionsColumns(db);
  if (!pragmasApplied && Platform.OS !== 'web') {
    try {
      await db.execAsync('PRAGMA journal_mode=WAL;');
      await db.execAsync('PRAGMA busy_timeout=8000;');
    } catch {
      /* indisponible selon build */
    }
    pragmasApplied = true;
  }
  return db;
}

/**
 * Exécute un bloc avec la base prête — toutes les requêtes du callback sont sérialisées avec le reste de l’app.
 */
export async function withLocalDatabase<T>(
  fn: (database: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  return runSerializedSqlite(async () => fn(await ensureDbReady()));
}

/**
 * Lecture minimale sur `intentions` pour valider que SQLite est prêt.
 * Ne charge pas toute la table. Appelé après le premier rendu (RootNavigator) pour ne pas
 * bloquer le TTI sur la file `runSerializedSqlite`.
 */
export async function touchLocalDatabaseForStartup(): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM intentions LIMIT 1`,
    );
  });
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
  /**
   * Créneau laissé à l’IA (Momentum/Zen) — exclusif avec `alarm_enabled` :
   * pas les deux à la fois.
   */
  is_flexible: boolean;
  /** Micro-habitude (soin répété) — fragmentée sur le rail */
  is_micro_habit: boolean;
  /** Ancre structurelle (routine récurrente + heure) — créneau sanctuarisé */
  is_hard_constraint: boolean;
  routine_id: string | null;
  /** Jour calendaire de cette instance (AAAA-MM-JJ local), null = flottant */
  anchor_date_ymd: string | null;
  /** Début d’ancrage rail (minutes depuis minuit), null = placement libre */
  fixed_start_minutes: number | null;
  /** Texte vocal / brut avant analyse (messagerie, tests) */
  raw_transcript: string | null;
  /** Score énergie / charge (0–1), optionnel */
  energy_score: number | null;
  /** Identifiant expo-notifications (poignée matérielle pour annulation / remplacement) */
  local_notification_id: string | null;
  /** Partie RRULE seule (ex. FREQ=WEEKLY;BYDAY=MO) — DTSTART = anchor_date_ymd + fixed_start_minutes */
  recurrence_rrule: string | null;
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
    is_flexible:
      row.is_flexible == null ? true : Number(row.is_flexible) === 1,
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
    raw_transcript:
      typeof row.raw_transcript === 'string' && row.raw_transcript.trim()
        ? row.raw_transcript
        : null,
    energy_score:
      typeof row.energy_score === 'number' && Number.isFinite(row.energy_score)
        ? row.energy_score
        : null,
    local_notification_id:
      typeof row.local_notification_id === 'string' &&
      row.local_notification_id.trim()
        ? row.local_notification_id.trim()
        : null,
    recurrence_rrule:
      typeof row.recurrence_rrule === 'string' && row.recurrence_rrule.trim()
        ? row.recurrence_rrule.trim()
        : null,
  };
}

/**
 * Alarme et créneau flexible sont mutuellement exclusifs. Alarme active ⇒ ancre fixe + contrainte dure.
 */
export function normalizeFlexAlarmForInsert(input: {
  is_flexible?: boolean;
  alarm_enabled?: boolean;
  is_hard_constraint?: boolean;
  routine_id?: string | null;
}): {
  is_flexible: boolean;
  alarm_enabled: boolean;
  is_hard_constraint: boolean;
} {
  const alarm = !!input.alarm_enabled;
  if (alarm) {
    return { is_flexible: false, alarm_enabled: true, is_hard_constraint: true };
  }
  const isFlexible = input.is_flexible !== false;
  if (isFlexible) {
    return {
      is_flexible: true,
      alarm_enabled: false,
      is_hard_constraint: input.routine_id
        ? true
        : !!input.is_hard_constraint,
    };
  }
  return {
    is_flexible: false,
    alarm_enabled: false,
    is_hard_constraint: !!input.is_hard_constraint || !!input.routine_id,
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
  is_flexible?: boolean;
  is_micro_habit?: boolean;
  is_hard_constraint?: boolean;
  routine_id?: string | null;
  anchor_date_ymd?: string | null;
  fixed_start_minutes?: number | null;
  raw_transcript?: string | null;
  energy_score?: number | null;
  recurrence_rrule?: string | null;
}): Promise<void> {
  try {
    const norm = normalizeFlexAlarmForInsert({
      is_flexible: input.is_flexible,
      alarm_enabled: input.alarm_enabled,
      is_hard_constraint: input.is_hard_constraint,
      routine_id: input.routine_id,
    });
    await runSerializedSqlite(async () => {
      const database = await ensureDbReady();
      const ufu = input.user_forced_urgent ? 1 : 0;
      const iln = input.is_late_night ? 1 : 0;
      const alarm = norm.alarm_enabled ? 1 : 0;
      const flex = norm.is_flexible ? 1 : 0;
      const micro = input.is_micro_habit ? 1 : 0;
      const hard = norm.is_hard_constraint ? 1 : 0;
      await database.runAsync(
        `INSERT INTO intentions (
      id, title, description, status, priority, weights,
      platform_type, platform_user_id, created_at, synced,
      estimated_duration, actual_duration, completed_at,
      user_forced_urgent, is_late_night, alarm_enabled, is_flexible, is_micro_habit,
      is_hard_constraint, routine_id, anchor_date_ymd, fixed_start_minutes,
      raw_transcript, energy_score, local_notification_id, recurrence_rrule
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
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
          flex,
          micro,
          hard,
          input.routine_id ?? null,
          input.anchor_date_ymd ?? null,
          input.fixed_start_minutes ?? null,
          input.raw_transcript ?? null,
          input.energy_score ?? null,
          input.recurrence_rrule?.trim() ?? null,
        ],
      );
    });
    if (norm.alarm_enabled) {
      const alarmMod = await import('../services/alarmManager');
      await alarmMod.requestAlarmPermissionIfNeeded();
    }
    await syncNativeRailAlarmsAfterIntentionWrite('insertIntention');
  } catch (e) {
    if (isLikelyMissingNativeModuleError(e)) {
      alertNativeModuleMissing('insertIntention (expo-sqlite / expo-notifications)', e);
    }
    throw e;
  }
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
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const ufu = input.user_forced_urgent ? 1 : 0;
    const iln = input.is_late_night ? 1 : 0;
    const alarm = input.alarm_enabled ? 1 : 0;
    const micro = input.is_micro_habit ? 1 : 0;
    await database.runAsync(
      `INSERT INTO intentions (
      id, title, description, status, priority, weights,
      platform_type, platform_user_id, created_at, synced,
      estimated_duration, actual_duration, completed_at,
      user_forced_urgent, is_late_night, alarm_enabled, is_flexible, is_micro_habit,
      is_hard_constraint, routine_id, anchor_date_ymd, fixed_start_minutes,
      raw_transcript, energy_score, local_notification_id, recurrence_rrule
    ) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
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
        1,
        micro,
      ],
    );
  });
  await syncNativeRailAlarmsAfterIntentionWrite('insertCompletedIntention');
}

export async function recordMicroHabitFragmentCheck(input: {
  id: string;
  intention_id: string;
  day_ymd: string;
  fragment_index: number;
}): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
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
  });
}

export async function countMicroHabitChecksOnDay(dayYmd: string): Promise<number> {
  return runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const row = await database.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM micro_habit_checks WHERE day_ymd = ?`,
      [dayYmd],
    );
    return row?.c ?? 0;
  });
}

export async function updateIntentionAlarmEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    if (enabled) {
      await database.runAsync(
        `UPDATE intentions SET alarm_enabled = 1, is_flexible = 0, is_hard_constraint = 1, synced = 0 WHERE id = ?`,
        [id],
      );
    } else {
      const row = await database.getFirstAsync<{ routine_id: string | null }>(
        `SELECT routine_id FROM intentions WHERE id = ?`,
        [id],
      );
      const routine =
        row?.routine_id != null && String(row.routine_id).trim() !== '';
      await database.runAsync(
        `UPDATE intentions SET alarm_enabled = 0, is_flexible = 1, is_hard_constraint = ?, local_notification_id = NULL, synced = 0 WHERE id = ?`,
        [routine ? 1 : 0, id],
      );
    }
  });
  const alarm = await import('../services/alarmManager');
  if (enabled) {
    await alarm.requestAlarmPermissionIfNeeded();
  }
  await syncNativeRailAlarmsAfterIntentionWrite('updateIntentionAlarmEnabled');
}

export async function getIntentionById(
  id: string,
): Promise<IntentionRow | null> {
  return runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM intentions WHERE id = ?`,
      [id],
    );
    return row ? rowToIntention(row) : null;
  });
}

export async function markIntentionActive(id: string): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(
      `UPDATE intentions SET status = 'active', synced = 0 WHERE id = ?`,
      [id],
    );
  });
  await syncNativeRailAlarmsAfterIntentionWrite('markIntentionActive');
}

export async function setIntentionLocalNotificationId(
  id: string,
  notificationId: string | null,
): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(
      `UPDATE intentions SET local_notification_id = ?, synced = 0 WHERE id = ?`,
      [notificationId, id],
    );
  });
}

/**
 * Remet à NULL toutes les poignées `local_notification_id` (ex. après `cancelAllScheduledRailAlarms`).
 */
export async function clearAllIntentionLocalNotificationHandles(): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(
      `UPDATE intentions SET local_notification_id = NULL WHERE local_notification_id IS NOT NULL`,
    );
  });
}

/**
 * Supprime une intention locale et annule immédiatement son alarme native (OS).
 */
export async function deleteIntentionById(id: string): Promise<void> {
  const { cancelIntentionRailAlarm } = await import('../services/alarmManager');
  await cancelIntentionRailAlarm(id);
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(`DELETE FROM intentions WHERE id = ?`, [id]);
  });
  await syncNativeRailAlarmsAfterIntentionWrite('deleteIntentionById');
}

/**
 * Avance l’ancrage local à l’occurrence RRULE suivante (une seule alarme native à la fois).
 */
export async function advanceIntentionToNextRecurrenceSlot(
  id: string,
): Promise<boolean> {
  const row = await getIntentionById(id);
  if (!row?.recurrence_rrule?.trim()) return false;
  const { nextOccurrenceAfter } = await import('../services/recurrenceRrule');
  const next = nextOccurrenceAfter(row, new Date());
  if (!next) return false;
  logIaAlarmNextOccurrence(row.title, next);
  const { cancelIntentionRailAlarm } = await import('../services/alarmManager');
  await cancelIntentionRailAlarm(id);
  const ymd = formatLocalDateYmd(next);
  const mins = next.getHours() * 60 + next.getMinutes();
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(
      `UPDATE intentions SET anchor_date_ymd = ?, fixed_start_minutes = ?, local_notification_id = NULL, synced = 0 WHERE id = ?`,
      [ymd, mins, id],
    );
  });
  await syncNativeRailAlarmsAfterIntentionWrite(
    'advanceIntentionToNextRecurrenceSlot',
  );
  return true;
}

/**
 * Mise à jour date/heure/RRULE par l’agent — annule l’alarme matérielle existante puis replanifie si besoin.
 */
export async function updateIntentionScheduleFields(input: {
  id: string;
  anchor_date_ymd?: string | null;
  fixed_start_minutes?: number | null;
  recurrence_rrule?: string | null;
}): Promise<void> {
  const row = await getIntentionById(input.id);
  if (!row) return;
  const { cancelIntentionRailAlarm } = await import('../services/alarmManager');
  await cancelIntentionRailAlarm(input.id);
  const ymd =
    input.anchor_date_ymd !== undefined ? input.anchor_date_ymd : row.anchor_date_ymd;
  const mins =
    input.fixed_start_minutes !== undefined
      ? input.fixed_start_minutes
      : row.fixed_start_minutes;
  const rrule =
    input.recurrence_rrule !== undefined
      ? input.recurrence_rrule?.trim() ?? null
      : row.recurrence_rrule;
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(
      `UPDATE intentions SET anchor_date_ymd = ?, fixed_start_minutes = ?, recurrence_rrule = ?, local_notification_id = NULL, synced = 0 WHERE id = ?`,
      [ymd, mins, rrule, input.id],
    );
  });
  await syncNativeRailAlarmsAfterIntentionWrite('updateIntentionScheduleFields');
}

export async function updateIntentionAfterFocus(input: {
  id: string;
  actual_duration: number;
  status: IntentionStatus;
}): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const row = await getIntentionById(input.id);

    if (input.status === 'done' && row?.recurrence_rrule?.trim()) {
      const { nextOccurrenceAfter } = await import('../services/recurrenceRrule');
      const next = nextOccurrenceAfter(row, new Date());
      if (next) {
        logIaAlarmNextOccurrence(row.title, next);
        const am = await import('../services/alarmManager');
        await am.cancelIntentionRailAlarm(input.id);
        const ymd = formatLocalDateYmd(next);
        const mins = next.getHours() * 60 + next.getMinutes();
        await database.runAsync(
          `UPDATE intentions SET actual_duration = NULL, status = 'pending', completed_at = NULL, anchor_date_ymd = ?, fixed_start_minutes = ?, local_notification_id = NULL, synced = 0 WHERE id = ?`,
          [ymd, mins, input.id],
        );
        await syncNativeRailAlarmsAfterIntentionWrite(
          'updateIntentionAfterFocus/recurrence',
        );
        return;
      }
    }

    const completedAt = input.status === 'done' ? Date.now() : null;
    if (input.status === 'done') {
      await database.runAsync(
        `UPDATE intentions SET actual_duration = ?, status = ?, synced = 0, completed_at = ?, local_notification_id = NULL WHERE id = ?`,
        [input.actual_duration, input.status, completedAt, input.id],
      );
    } else {
      await database.runAsync(
        `UPDATE intentions SET actual_duration = ?, status = ?, synced = 0, completed_at = ? WHERE id = ?`,
        [input.actual_duration, input.status, completedAt, input.id],
      );
    }
    if (input.status === 'done') {
      const am = await import('../services/alarmManager');
      await am.cancelIntentionRailAlarm(input.id);
    }
    await syncNativeRailAlarmsAfterIntentionWrite('updateIntentionAfterFocus');
  });
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
  return runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM intentions ORDER BY priority DESC, created_at DESC`,
    );
    return rows.map(rowToIntention);
  });
}

export async function listUnsyncedIntentions(): Promise<IntentionRow[]> {
  return runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM intentions WHERE synced = 0`,
    );
    return rows.map(rowToIntention);
  });
}

export async function markIntentionSynced(id: string): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.runAsync(`UPDATE intentions SET synced = 1 WHERE id = ?`, [
      id,
    ]);
  });
}

/** Sessions focus terminées dont l’horodatage (completed_at ou repli created_at) est dans [startMs, endMs]. */
export async function listCompletedSessionsBetween(
  startMs: number,
  endMs: number,
): Promise<IntentionRow[]> {
  return runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM intentions
     WHERE status = 'done' AND actual_duration IS NOT NULL
       AND COALESCE(completed_at, created_at) >= ?
       AND COALESCE(completed_at, created_at) <= ?
     ORDER BY COALESCE(completed_at, created_at) DESC`,
      [startMs, endMs],
    );
    return rows.map(rowToIntention);
  });
}

/** Dernières sessions terminées — pour historique par jour (grouper côté UI). */
export async function listRecentCompletedFocusSessions(
  limit: number,
): Promise<IntentionRow[]> {
  return runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM intentions
     WHERE status = 'done' AND actual_duration IS NOT NULL
     ORDER BY COALESCE(completed_at, created_at) DESC
     LIMIT ?`,
      [limit],
    );
    return rows.map(rowToIntention);
  });
}

function logIaAlarmNextOccurrence(title: string, next: Date): void {
  if (!__DEV__) return;
  const nextDate = next.toLocaleString('fr-FR', {
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  console.log(
    `[IA-Alarm] Prochaine occurrence calculée pour '${title}' : ${nextDate}.`,
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Date locale AAAA-MM-JJ */
export function formatLocalDateYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export async function insertRoutine(input: RoutineRow): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
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
  });
}

/**
 * Génère une instance d’intention par jour calendaire correspondant au motif (horizon glissant).
 */
export async function ensureRoutineIntentionInstancesForHorizon(
  routineId: string,
  platformUserId: string,
  horizonDays = 14,
): Promise<void> {
  const inserted = await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM routines WHERE id = ?`,
      [routineId],
    );
    if (!row) return 0;

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

    let n = 0;
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
        user_forced_urgent, is_late_night, alarm_enabled, is_flexible, is_micro_habit,
        is_hard_constraint, routine_id, anchor_date_ymd, fixed_start_minutes,
        raw_transcript, energy_score, local_notification_id, recurrence_rrule
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, NULL, NULL, 0, 0, 0, 1, 0, 1, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
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
      n += 1;
    }
    return n;
  });
  if (inserted > 0) {
    await syncNativeRailAlarmsAfterIntentionWrite(
      'ensureRoutineIntentionInstancesForHorizon',
    );
  }
}

/**
 * Pousse le journal SQLite (WAL) vers le disque — à appeler en arrière-plan
 * avant suspension / fermeture pour limiter la perte de données.
 */
export async function checkpointLocalDatabase(): Promise<void> {
  try {
    await runSerializedSqlite(async () => {
      const database = await ensureDbReady();
      await database.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
    });
  } catch {
    /* mode journal non-WAL ou indisponible : ignoré */
  }
}

/**
 * Aligné sur `INTENTIONS_CHANGED_EVENT` (`externalIntentIngest`) — évite import circulaire.
 * Tous les écrans qui écoutent `tellyouto/intentions_changed` sont notifiés.
 */
export const INTENTIONS_CHANGED_EVENT_NAME = 'tellyouto/intentions_changed';

/**
 * Supprime toutes les intentions locales (+ contrôles micro-habitudes) — tests Debug / profils.
 *
 * Ordre : transaction SQLite (DELETE) → `VACUUM` → annulation **totale** des notifications Expo
 * (`cancelAllScheduledNotificationsAsync`) → nettoyage poignées rail / SQLite → resync alarmes (no-op) →
 * événement global pour rafraîchir l’UI.
 */
export async function deleteAllIntentions(): Promise<void> {
  await runSerializedSqlite(async () => {
    const database = await ensureDbReady();
    await database.withTransactionAsync(async () => {
      await database.execAsync('DELETE FROM micro_habit_checks;');
      await database.execAsync('DELETE FROM intentions;');
    });
    try {
      await database.execAsync('VACUUM;');
    } catch {
      /* VACUUM peut échouer sur certaines configs (lecture seule, etc.) — DELETE déjà validé */
    }
  });

  try {
    const { cancelAllLocalScheduledNotifications } = await import(
      '../services/notifications'
    );
    await cancelAllLocalScheduledNotifications();
  } catch {
    /* Expo Go / module absent */
  }
  try {
    const { cancelAllScheduledRailAlarms } = await import(
      '../services/alarmManager'
    );
    await cancelAllScheduledRailAlarms();
  } catch {
    /* second passage : préfixes rail + UPDATE SQLite */
  }
  try {
    await syncNativeRailAlarmsAfterIntentionWrite('deleteAllIntentions');
  } catch {
    /* ne pas bloquer l’UI après DELETE réussi */
  }

  DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
}

/** Vue compacte pour l’écran Debug (Use Cases / sync Firebase). */
export function intentionRowToDebugSnapshot(row: IntentionRow): Record<string, unknown> {
  return {
    title: row.title,
    start_time_ms: row.created_at,
    rail_start_minutes: row.fixed_start_minutes,
    isMicroHabit: row.is_micro_habit,
    isHardConstraint: row.is_hard_constraint,
    energy_score: row.energy_score,
    sync_status: row.synced === 1 ? 'synced' : 'pending',
    raw_transcript: row.raw_transcript,
    _full_row: row,
  };
}
