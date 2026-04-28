import * as SQLite from 'expo-sqlite';
import { DeviceEventEmitter } from 'react-native';

import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';

export type TrankilIntentType = 'TASK' | 'HABIT' | 'NOTE' | 'AUDIO' | 'PROJECT' | 'LIST';
export type TrankilIntentStatus = 'TODO' | 'DONE' | 'ARCHIVED';

export type TrankilV2IntentionRow = {
  id: string;
  type: TrankilIntentType;
  title: string;
  due_date?: string | null;
  content_raw: string;
  metadata_json: string;
  suggested_tags: string;
  category_id: string | null;
  category?: string | null;
  parent_id: string | null;
  status: TrankilIntentStatus;
  is_organized: number;
  is_local_processed: number;
  complexity_level: number;
  created_at: number;
  calendar_event_id?: string | null;
  calendar_name?: string | null;
  is_synced_calendar?: number;
  alarm_enabled?: number;
  remind_at?: number | null;
  local_notification_id?: string | null;
  recurrence_rrule?: string | null;
  /** 0/1 — synchronisé avec status DONE */
  is_done?: number;
  done_at?: number | null;
  /** 0/1 — synchronisé avec status ARCHIVED */
  is_archived?: number;
  archived_at?: number | null;
  /** 1 = coquille locale avant fin du tri IA (offline-first). */
  is_pending_ai?: number;
  /** 1 = rappel « quand partir » (logistique déplacement). */
  remind_to_leave?: number;
  /** Lieu / adresse texte libre (nullable). */
  location_address?: string | null;
  ai_model_used?: string | null;
  ai_latency_ms?: number | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  tokens_total?: number | null;
  location_id?: number | null;
};

export type TrankilV2TimelineItemRow = {
  id: string;
  type: TrankilIntentType;
  status: TrankilIntentStatus;
  due_date: string | null;
  created_at: number;
  content_raw: string;
  parent_id: string | null;
  project_title: string | null;
  display_title: string;
  section: 'TASK_HABIT' | 'PROJECT_SUBTASK' | 'NOTE_AUDIO' | 'LIST_CARD';
  is_synced_calendar: number;
  /** Présent lorsque la requête Timeline le joint (filtres contexte). */
  category_id?: string | null;
  /** JSON tableau de tags suggérés (ex. `a_trier`). */
  suggested_tags?: string | null;
  metadata_json?: string | null;
  is_pending_ai?: number;
};

export type TrankilV2TimelineDateMode = 'DAY' | 'WEEK';

/** Plafond offre Free : captures micro réussies / jour (date locale), sans cumul. */
export const FREE_DAILY_CAPTURE_MAX = 3;

/** Quota Free distinct : listes inventaire réussies / jour (date locale), sans cumul. */
export const FREE_DAILY_LIST_MAX = 1;

export type TrankilV2UserStatsRow = {
  ia_credits: number;
  zen_points: number;
  growth_score: number;
  local_action_streak: number;
  ad_last_reward_at: number | null;
  ad_videos_watched: number;
  pending_sync_ia_credits: number;
  recharge_window_started_at: number | null;
  recharge_videos_in_window: number;
  recharge_last_video_at: number | null;
  /** Optionnel — colonne absente tant que non migrée. */
  morning_focus_item_id?: string | null;
};

export type EmergencyLogRow = {
  id: string;
  error_message: string;
  stack: string;
  intentions_json: string;
  created_at: number;
};

export type UserActivityLogActionType =
  | 'TASK_DONE'
  | 'HABIT_DONE'
  | 'PROJECT_CREATED'
  | 'IA_SPENT'
  | 'ZEN_GAIN'
  | 'CALENDAR_SYNC_ARCHIVE'
  | 'AI_CALL'
  | 'SYNC_PUSH'
  | 'SYNC_PULL'
  | 'USER_EDIT';

export type UserActivityLogRow = {
  id: string;
  created_at: number;
  day_key: string;
  action_type: UserActivityLogActionType;
  points_delta: number;
  intention_id?: string | null;
  request_id?: string | null;
  api_name?: string | null;
  http_status?: number | null;
  latency_ms?: number | null;
  ai_model_used?: string | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  tokens_total?: number | null;
  meta_json: string;
};

export type BonusEventType =
  | 'ia_credits'
  | 'zen_points'
  | 'super_bonus_local_streak';

const DB_NAME = 'trankil_v2.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let v2SqlQueue: Promise<void> = Promise.resolve();
let pragmasApplied = false;

type SqliteAsyncMethodName = 'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync' | 'prepareAsync';

function runSerializedTrankilV2<T>(fn: () => Promise<T>): Promise<T> {
  const p = v2SqlQueue.then(fn, fn);
  v2SqlQueue = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

function wrapDbWithSerialization(database: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  const dbAny = database as unknown as {
    __trankilV2Serialized?: boolean;
    execAsync?: (...args: unknown[]) => Promise<unknown>;
    runAsync?: (...args: unknown[]) => Promise<unknown>;
    getFirstAsync?: (...args: unknown[]) => Promise<unknown>;
    getAllAsync?: (...args: unknown[]) => Promise<unknown>;
    prepareAsync?: (...args: unknown[]) => Promise<unknown>;
  };
  if (dbAny.__trankilV2Serialized) return database;
  dbAny.__trankilV2Serialized = true;
  (['execAsync', 'runAsync', 'getFirstAsync', 'getAllAsync', 'prepareAsync'] as SqliteAsyncMethodName[]).forEach(
    (name) => {
      const orig = (dbAny[name] as unknown as ((...args: unknown[]) => Promise<unknown>) | undefined)?.bind(database);
      if (!orig) return;
      dbAny[name] = (...args: unknown[]) => runSerializedTrankilV2(() => orig(...args));
    },
  );
  return database;
}

const DEFAULT_HORIZON_CATEGORIES: Array<{ id: string; label: string; sort_order: number }> = [
  { id: 'aujourdhui', label: "Aujourd'hui", sort_order: 1 },
  { id: 'demain', label: 'Demain', sort_order: 2 },
  { id: 'cette_semaine', label: 'Cette semaine', sort_order: 3 },
  { id: 'regulier', label: 'Regulier', sort_order: 4 },
  { id: 'sans_pression', label: 'Sans pression', sort_order: 5 },
];

function normalizeDueDate(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return null;
}

/** Filtre pilotage Timeline (Maison / Travail) — aligné sur l’ancien filtre JS. */
export type TimelineSqlContext = 'ALL' | 'HOME' | 'WORK';

export type TimelinePaging = {
  limit?: number;
  offset?: number;
};

export const TIMELINE_PAGE_SIZE = 50;

function timelineContextWhere(context: TimelineSqlContext, alias = 'i'): string {
  if (context === 'HOME') {
    return ` AND (
      lower(coalesce(${alias}.category_id, '')) LIKE '%maison%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%home%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%famille%'
    )`;
  }
  if (context === 'WORK') {
    return ` AND (
      lower(coalesce(${alias}.category_id, '')) LIKE '%travail%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%work%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%pro%'
    )`;
  }
  return '';
}

function appendTimelinePaging(
  sql: string,
  params: (string | number)[],
  paging?: TimelinePaging,
): { sql: string; params: (string | number)[] } {
  if (paging?.limit != null && Number.isFinite(paging.limit)) {
    const lim = Math.max(1, Math.min(500, Math.floor(Number(paging.limit))));
    const off = Math.max(0, Math.floor(Number(paging.offset ?? 0)));
    return { sql: `${sql}\n    LIMIT ? OFFSET ?`, params: [...params, lim, off] };
  }
  return { sql, params };
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      const wrapped = wrapDbWithSerialization(db);
      if (!pragmasApplied) {
        try {
          await wrapped.execAsync('PRAGMA journal_mode=WAL;');
          await wrapped.execAsync('PRAGMA busy_timeout=8000;');
        } catch {
          /* ignore */
        }
        pragmasApplied = true;
      }
      return wrapped;
    });
  }
  return dbPromise;
}

export async function withTrankilV2Database<T>(
  fn: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  return fn(db);
}

function notifyIntentionsChanged(payload?: { id?: string; reason?: string }): void {
  DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME, { source: 'trankil_v2', ...payload });
}

async function syncAfterIntentionWrite(reason: string): Promise<void> {
  try {
    const { syncNativeRailAlarmsAfterIntentionWrite } = await import('./intentionHardwareSync');
    await syncNativeRailAlarmsAfterIntentionWrite(reason);
  } catch {
    /* ignore */
  }
}

/**
 * Schéma SQLite de base Trankil-v2.
 */
export async function initTrankilV2Schema(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      formatted_address TEXT NOT NULL,
      place_id TEXT,
      lat REAL,
      lng REAL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_place_id
      ON locations (place_id);
    CREATE INDEX IF NOT EXISTS idx_locations_updated_at
      ON locations (updated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS location_anchors (
      anchor TEXT PRIMARY KEY NOT NULL,
      location_id INTEGER,
      label TEXT,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_location_anchors_location_id
      ON location_anchors (location_id);

    CREATE TABLE IF NOT EXISTS intentions (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('TASK', 'HABIT', 'NOTE', 'AUDIO', 'PROJECT', 'LIST')),
      title TEXT NOT NULL,
      due_date TEXT,
      content_raw TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      suggested_tags TEXT NOT NULL DEFAULT '[]',
      category_id TEXT,
      category TEXT,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'DONE', 'ARCHIVED')),
      is_organized INTEGER NOT NULL DEFAULT 0 CHECK (is_organized IN (0, 1)),
      is_local_processed INTEGER NOT NULL DEFAULT 0 CHECK (is_local_processed IN (0, 1)),
      complexity_level INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      calendar_event_id TEXT,
      calendar_name TEXT,
      is_synced_calendar INTEGER NOT NULL DEFAULT 0 CHECK (is_synced_calendar IN (0, 1)),
      alarm_enabled INTEGER NOT NULL DEFAULT 0 CHECK (alarm_enabled IN (0, 1)),
      remind_at INTEGER,
      local_notification_id TEXT,
      recurrence_rrule TEXT
      ,
      is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
      done_at INTEGER,
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
      archived_at INTEGER,
      is_pending_ai INTEGER NOT NULL DEFAULT 0 CHECK (is_pending_ai IN (0, 1)),
      remind_to_leave INTEGER NOT NULL DEFAULT 0 CHECK (remind_to_leave IN (0, 1)),
      location_address TEXT,
      ai_model_used TEXT,
      ai_latency_ms INTEGER,
      tokens_prompt INTEGER,
      tokens_completion INTEGER,
      tokens_total INTEGER,
      location_id INTEGER,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_intentions_type_status
      ON intentions (type, status);
    CREATE INDEX IF NOT EXISTS idx_intentions_created_at
      ON intentions (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_intentions_location_id
      ON intentions (location_id);
    CREATE INDEX IF NOT EXISTS idx_intentions_ai_model_used
      ON intentions (ai_model_used);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      firebase_uid TEXT,
      user_email TEXT,
      plan_type TEXT NOT NULL DEFAULT 'FREE',
      subscription_status TEXT NOT NULL DEFAULT 'INACTIVE',
      sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
      last_sync_at_ms INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identity_firebase_uid
      ON user_identity (firebase_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identity_user_email
      ON user_identity (user_email);
    INSERT OR IGNORE INTO user_identity (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS user_billing_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_intentions_limit INTEGER NOT NULL DEFAULT 0,
      current_day_intentions_count INTEGER NOT NULL DEFAULT 0,
      daily_notes_limit INTEGER NOT NULL DEFAULT 0,
      current_day_notes_count INTEGER NOT NULL DEFAULT 0,
      trip_credits_balance INTEGER NOT NULL DEFAULT 0,
      feature_flags_json TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO user_billing_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS user_knowledge (
      key TEXT PRIMARY KEY NOT NULL,
      value_text TEXT NOT NULL DEFAULT '',
      value_json TEXT NOT NULL DEFAULT '{}',
      namespace TEXT NOT NULL DEFAULT 'USER' CHECK (namespace IN ('USER', 'IA')),
      confidence_score REAL NOT NULL DEFAULT 0.0 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_knowledge_namespace
      ON user_knowledge (namespace);
    CREATE INDEX IF NOT EXISTS idx_user_knowledge_updated_at
      ON user_knowledge (updated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS user_context (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS user_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ia_credits INTEGER NOT NULL DEFAULT 10,
      zen_points INTEGER NOT NULL DEFAULT 0,
      local_action_streak INTEGER NOT NULL DEFAULT 0,
      ad_last_reward_at INTEGER,
      ad_videos_watched INTEGER NOT NULL DEFAULT 0,
      pending_sync_ia_credits INTEGER NOT NULL DEFAULT 0,
      recharge_window_started_at INTEGER,
      recharge_videos_in_window INTEGER NOT NULL DEFAULT 0,
      recharge_last_video_at INTEGER
    );

    INSERT OR IGNORE INTO user_stats (id, ia_credits, zen_points, local_action_streak, ad_last_reward_at, ad_videos_watched, pending_sync_ia_credits, recharge_window_started_at, recharge_videos_in_window, recharge_last_video_at)
    VALUES (1, 10, 0, 0, NULL, 0, 0, NULL, 0, NULL);

    CREATE TABLE IF NOT EXISTS bonus_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bonus_type TEXT NOT NULL,
      is_accepted INTEGER NOT NULL DEFAULT 0,
      triggered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS emergency_logs (
      id TEXT PRIMARY KEY NOT NULL,
      error_message TEXT NOT NULL,
      stack TEXT NOT NULL DEFAULT '',
      intentions_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      day_key TEXT NOT NULL,
      action_type TEXT NOT NULL,
      points_delta INTEGER NOT NULL DEFAULT 0,
      intention_id TEXT,
      request_id TEXT,
      api_name TEXT,
      http_status INTEGER,
      latency_ms INTEGER,
      ai_model_used TEXT,
      tokens_prompt INTEGER,
      tokens_completion INTEGER,
      tokens_total INTEGER,
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_day_key
      ON user_activity_logs (day_key);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_action_day
      ON user_activity_logs (action_type, day_key);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at
      ON user_activity_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_intention_id
      ON user_activity_logs (intention_id);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_request_id
      ON user_activity_logs (request_id);
  `);
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(intentions)`,
  );
  const hasParentId = cols.some((c) => c.name === 'parent_id');
  if (!hasParentId) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN parent_id TEXT;`);
  }
  const hasLocalProcessed = cols.some((c) => c.name === 'is_local_processed');
  if (!hasLocalProcessed) {
    await db.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_local_processed INTEGER NOT NULL DEFAULT 0;`,
    );
  }
  const hasSuggestedTags = cols.some((c) => c.name === 'suggested_tags');
  if (!hasSuggestedTags) {
    await db.execAsync(
      `ALTER TABLE intentions ADD COLUMN suggested_tags TEXT NOT NULL DEFAULT '[]';`,
    );
  }
  const hasComplexityLevel = cols.some((c) => c.name === 'complexity_level');
  if (!hasComplexityLevel) {
    await db.execAsync(
      `ALTER TABLE intentions ADD COLUMN complexity_level INTEGER NOT NULL DEFAULT 1;`,
    );
  }
  const hasCategory = cols.some((c) => c.name === 'category');
  if (!hasCategory) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN category TEXT;`);
    await db.execAsync(`UPDATE intentions SET category = category_id WHERE category IS NULL;`);
  }
  const hasDueDate = cols.some((c) => c.name === 'due_date');
  if (!hasDueDate) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN due_date TEXT;`);
  }
  const hasCalendarEventId = cols.some((c) => c.name === 'calendar_event_id');
  if (!hasCalendarEventId) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN calendar_event_id TEXT;`);
  }
  const hasCalendarName = cols.some((c) => c.name === 'calendar_name');
  if (!hasCalendarName) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN calendar_name TEXT;`);
  }
  const hasIsSyncedCalendar = cols.some((c) => c.name === 'is_synced_calendar');
  if (!hasIsSyncedCalendar) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN is_synced_calendar INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasAlarmEnabled = cols.some((c) => c.name === 'alarm_enabled');
  if (!hasAlarmEnabled) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN alarm_enabled INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasRemindAt = cols.some((c) => c.name === 'remind_at');
  if (!hasRemindAt) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN remind_at INTEGER;`);
  }
  const hasLocalNotificationId = cols.some((c) => c.name === 'local_notification_id');
  if (!hasLocalNotificationId) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN local_notification_id TEXT;`);
  }
  const hasRecurrenceRrule = cols.some((c) => c.name === 'recurrence_rrule');
  if (!hasRecurrenceRrule) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN recurrence_rrule TEXT;`);
  }
  await db.execAsync(
    `UPDATE intentions
     SET due_date = substr(trim(due_date), 1, 4) || '-' || substr(trim(due_date), 5, 2) || '-' || substr(trim(due_date), 7, 2)
     WHERE due_date IS NOT NULL
       AND trim(due_date) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'`,
  );
  for (const category of DEFAULT_HORIZON_CATEGORIES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO categories (id, label, sort_order) VALUES (?, ?, ?)`,
      [category.id, category.label, category.sort_order],
    );
  }
  const userStatsCols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(user_stats)`,
  );
  const hasIaCredits = userStatsCols.some((c) => c.name === 'ia_credits');
  if (!hasIaCredits) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN ia_credits INTEGER NOT NULL DEFAULT 10;`);
  }
  const hasZenPoints = userStatsCols.some((c) => c.name === 'zen_points');
  if (!hasZenPoints) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN zen_points INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasGrowthScore = userStatsCols.some((c) => c.name === 'growth_score');
  if (hasGrowthScore) {
    await db.execAsync(`UPDATE user_stats SET zen_points = COALESCE(zen_points, growth_score, 0) WHERE id = 1;`);
  }
  const hasRemainingIntents = userStatsCols.some((c) => c.name === 'remaining_intents');
  if (hasRemainingIntents) {
    await db.execAsync(`UPDATE user_stats SET ia_credits = COALESCE(remaining_intents, ia_credits, 10) WHERE id = 1;`);
  }
  if (!hasGrowthScore) {
    await db.execAsync(
      `ALTER TABLE user_stats ADD COLUMN growth_score INTEGER NOT NULL DEFAULT 0;`,
    );
  }
  const hasLocalStreak = userStatsCols.some((c) => c.name === 'local_action_streak');
  if (!hasLocalStreak) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN local_action_streak INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasAdLast = userStatsCols.some((c) => c.name === 'ad_last_reward_at');
  if (!hasAdLast) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN ad_last_reward_at INTEGER;`);
  }
  const hasAdVideosWatched = userStatsCols.some((c) => c.name === 'ad_videos_watched');
  if (!hasAdVideosWatched) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN ad_videos_watched INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasPendingSyncCredits = userStatsCols.some((c) => c.name === 'pending_sync_ia_credits');
  if (!hasPendingSyncCredits) {
    await db.execAsync(
      `ALTER TABLE user_stats ADD COLUMN pending_sync_ia_credits INTEGER NOT NULL DEFAULT 0;`,
    );
  }
  const hasRechargeWindowStart = userStatsCols.some((c) => c.name === 'recharge_window_started_at');
  if (!hasRechargeWindowStart) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN recharge_window_started_at INTEGER;`);
  }
  const hasRechargeVideosInWindow = userStatsCols.some((c) => c.name === 'recharge_videos_in_window');
  if (!hasRechargeVideosInWindow) {
    await db.execAsync(
      `ALTER TABLE user_stats ADD COLUMN recharge_videos_in_window INTEGER NOT NULL DEFAULT 0;`,
    );
  }
  const hasRechargeLastVideoAt = userStatsCols.some((c) => c.name === 'recharge_last_video_at');
  if (!hasRechargeLastVideoAt) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN recharge_last_video_at INTEGER;`);
  }
  const hasFreeCaptureDay = userStatsCols.some((c) => c.name === 'free_capture_day_ymd');
  if (!hasFreeCaptureDay) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN free_capture_day_ymd TEXT;`);
  }
  const hasFreeCaptureRemaining = userStatsCols.some((c) => c.name === 'free_capture_remaining');
  if (!hasFreeCaptureRemaining) {
    await db.execAsync(
      `ALTER TABLE user_stats ADD COLUMN free_capture_remaining INTEGER NOT NULL DEFAULT 3;`,
    );
  }
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      day_key TEXT NOT NULL,
      action_type TEXT NOT NULL,
      points_delta INTEGER NOT NULL DEFAULT 0,
      intention_id TEXT,
      request_id TEXT,
      api_name TEXT,
      http_status INTEGER,
      latency_ms INTEGER,
      ai_model_used TEXT,
      tokens_prompt INTEGER,
      tokens_completion INTEGER,
      tokens_total INTEGER,
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_day_key
      ON user_activity_logs (day_key);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_action_day
      ON user_activity_logs (action_type, day_key);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at
      ON user_activity_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_intention_id
      ON user_activity_logs (intention_id);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_request_id
      ON user_activity_logs (request_id);
  `);
  await db.execAsync(`UPDATE user_stats SET growth_score = COALESCE(growth_score, zen_points, 0) WHERE id = 1;`);
  await db.execAsync(`UPDATE user_stats SET zen_points = growth_score WHERE id = 1;`);
  const tableSql = await db.getFirstAsync<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='intentions'`,
  );
  const hasArchivedStatusInConstraint = String(tableSql?.sql || '').includes("'ARCHIVED'");
  if (!hasArchivedStatusInConstraint) {
    // Reliquat d'une migration interrompue : intentions_v2 peut déjà exister avec des lignes ;
    // sans DROP, le second INSERT relève une contrainte UNIQUE sur id (ex. après +crédits → init).
    await db.execAsync(`
      DROP TABLE IF EXISTS intentions_v2;
      CREATE TABLE intentions_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('TASK', 'HABIT', 'NOTE', 'AUDIO', 'PROJECT', 'LIST')),
        title TEXT NOT NULL,
        due_date TEXT,
        content_raw TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        suggested_tags TEXT NOT NULL DEFAULT '[]',
        category_id TEXT,
        category TEXT,
        parent_id TEXT,
        status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'DONE', 'ARCHIVED')),
        is_organized INTEGER NOT NULL DEFAULT 0 CHECK (is_organized IN (0, 1)),
        is_local_processed INTEGER NOT NULL DEFAULT 0 CHECK (is_local_processed IN (0, 1)),
        complexity_level INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        calendar_event_id TEXT,
        calendar_name TEXT,
        is_synced_calendar INTEGER NOT NULL DEFAULT 0 CHECK (is_synced_calendar IN (0, 1)),
        alarm_enabled INTEGER NOT NULL DEFAULT 0 CHECK (alarm_enabled IN (0, 1)),
        remind_at INTEGER,
        local_notification_id TEXT,
        recurrence_rrule TEXT,
        is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
        done_at INTEGER,
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        archived_at INTEGER,
        is_pending_ai INTEGER NOT NULL DEFAULT 0 CHECK (is_pending_ai IN (0, 1)),
        remind_to_leave INTEGER NOT NULL DEFAULT 0 CHECK (remind_to_leave IN (0, 1)),
        location_address TEXT,
        ai_model_used TEXT,
        ai_latency_ms INTEGER,
        tokens_prompt INTEGER,
        tokens_completion INTEGER,
        tokens_total INTEGER,
        location_id INTEGER
      );
      INSERT INTO intentions_v2 (
        id, type, title, due_date, content_raw, metadata_json, suggested_tags, category_id, category, parent_id,
        status, is_organized, is_local_processed, complexity_level, created_at, calendar_event_id, calendar_name,
        is_synced_calendar, alarm_enabled, remind_at, local_notification_id, recurrence_rrule,
        is_done, done_at, is_archived, archived_at,
        is_pending_ai, remind_to_leave, location_address,
        ai_model_used, ai_latency_ms, tokens_prompt, tokens_completion, tokens_total, location_id
      )
      SELECT
        id, type, title, due_date, content_raw, metadata_json, suggested_tags, category_id, category, parent_id,
        CASE WHEN status IN ('TODO', 'DONE', 'ARCHIVED') THEN status ELSE 'TODO' END,
        is_organized, is_local_processed, complexity_level, created_at, calendar_event_id, calendar_name,
        is_synced_calendar, alarm_enabled, remind_at, local_notification_id, recurrence_rrule,
        CASE WHEN status = 'DONE' THEN 1 ELSE 0 END,
        CASE WHEN status = 'DONE' THEN created_at ELSE NULL END,
        CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END,
        CASE WHEN status = 'ARCHIVED' THEN created_at ELSE NULL END,
        0, 0, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL
      FROM intentions;
      DROP TABLE intentions;
      ALTER TABLE intentions_v2 RENAME TO intentions;
      CREATE INDEX IF NOT EXISTS idx_intentions_type_status ON intentions (type, status);
      CREATE INDEX IF NOT EXISTS idx_intentions_created_at ON intentions (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_intentions_location_id ON intentions (location_id);
      CREATE INDEX IF NOT EXISTS idx_intentions_ai_model_used ON intentions (ai_model_used);
    `);
  }
  const mustCompactUserStats =
    userStatsCols.some((c) => c.name === 'flower_boosts') ||
    userStatsCols.some((c) => c.name === 'pshitt_sprays') ||
    userStatsCols.some((c) => c.name === 'magic_shake_passes') ||
    userStatsCols.some((c) => c.name === 'aesthetic_score');
  if (mustCompactUserStats) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_stats_compact (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        ia_credits INTEGER NOT NULL DEFAULT 10,
        zen_points INTEGER NOT NULL DEFAULT 0,
        growth_score INTEGER NOT NULL DEFAULT 0,
        local_action_streak INTEGER NOT NULL DEFAULT 0,
        ad_last_reward_at INTEGER,
        ad_videos_watched INTEGER NOT NULL DEFAULT 0,
        pending_sync_ia_credits INTEGER NOT NULL DEFAULT 0,
        recharge_window_started_at INTEGER,
        recharge_videos_in_window INTEGER NOT NULL DEFAULT 0,
        recharge_last_video_at INTEGER,
        free_capture_day_ymd TEXT,
        free_capture_remaining INTEGER NOT NULL DEFAULT 3
      );
      INSERT OR REPLACE INTO user_stats_compact (
        id, ia_credits, zen_points, growth_score, local_action_streak, ad_last_reward_at, ad_videos_watched, pending_sync_ia_credits, recharge_window_started_at, recharge_videos_in_window, recharge_last_video_at, free_capture_day_ymd, free_capture_remaining
      )
      SELECT
        1,
        COALESCE(ia_credits, remaining_intents, 10),
        COALESCE(growth_score, zen_points, 0),
        COALESCE(growth_score, zen_points, 0),
        COALESCE(local_action_streak, 0),
        ad_last_reward_at,
        COALESCE(ad_videos_watched, 0),
        0,
        NULL,
        0,
        NULL,
        NULL,
        3
      FROM user_stats
      WHERE id = 1;
      DROP TABLE user_stats;
      ALTER TABLE user_stats_compact RENAME TO user_stats;
    `);
  }

  const colsIntentions = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(intentions)`);
  if (!colsIntentions.some((c) => c.name === 'is_done')) {
    await db.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1));`,
    );
  }
  if (!colsIntentions.some((c) => c.name === 'done_at')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN done_at INTEGER;`);
  }
  if (!colsIntentions.some((c) => c.name === 'is_archived')) {
    await db.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));`,
    );
  }
  if (!colsIntentions.some((c) => c.name === 'archived_at')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN archived_at INTEGER;`);
  }
  await db.execAsync(
    `UPDATE intentions SET
       is_done = CASE WHEN status = 'DONE' THEN 1 ELSE 0 END,
       is_archived = CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END`,
  );
  await db.execAsync(
    `UPDATE intentions SET done_at = COALESCE(done_at, created_at) WHERE status = 'DONE' AND done_at IS NULL`,
  );
  await db.execAsync(
    `UPDATE intentions SET archived_at = COALESCE(archived_at, created_at) WHERE status = 'ARCHIVED' AND archived_at IS NULL`,
  );

  const colsIntentionsPending = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(intentions)`);
  if (!colsIntentionsPending.some((c) => c.name === 'is_pending_ai')) {
    await db.execAsync(
      `ALTER TABLE intentions ADD COLUMN is_pending_ai INTEGER NOT NULL DEFAULT 0 CHECK (is_pending_ai IN (0, 1));`,
    );
  }

  const userStatsCols2 = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(user_stats)`);
  if (!userStatsCols2.some((c) => c.name === 'list_free_day_ymd')) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN list_free_day_ymd TEXT;`);
  }
  if (!userStatsCols2.some((c) => c.name === 'list_free_remaining')) {
    await db.execAsync(
      `ALTER TABLE user_stats ADD COLUMN list_free_remaining INTEGER NOT NULL DEFAULT 1;`,
    );
  }

  const tableSqlListType = await db.getFirstAsync<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='intentions'`,
  );
  if (!String(tableSqlListType?.sql || '').includes("'LIST'")) {
    await db.execAsync(`
      DROP TABLE IF EXISTS intentions_list_mig;
      CREATE TABLE intentions_list_mig (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('TASK', 'HABIT', 'NOTE', 'AUDIO', 'PROJECT', 'LIST')),
        title TEXT NOT NULL,
        due_date TEXT,
        content_raw TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        suggested_tags TEXT NOT NULL DEFAULT '[]',
        category_id TEXT,
        category TEXT,
        parent_id TEXT,
        status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'DONE', 'ARCHIVED')),
        is_organized INTEGER NOT NULL DEFAULT 0 CHECK (is_organized IN (0, 1)),
        is_local_processed INTEGER NOT NULL DEFAULT 0 CHECK (is_local_processed IN (0, 1)),
        complexity_level INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        calendar_event_id TEXT,
        calendar_name TEXT,
        is_synced_calendar INTEGER NOT NULL DEFAULT 0 CHECK (is_synced_calendar IN (0, 1)),
        alarm_enabled INTEGER NOT NULL DEFAULT 0 CHECK (alarm_enabled IN (0, 1)),
        remind_at INTEGER,
        local_notification_id TEXT,
        recurrence_rrule TEXT,
        is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
        done_at INTEGER,
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        archived_at INTEGER,
        is_pending_ai INTEGER NOT NULL DEFAULT 0 CHECK (is_pending_ai IN (0, 1)),
        remind_to_leave INTEGER NOT NULL DEFAULT 0 CHECK (remind_to_leave IN (0, 1)),
        location_address TEXT,
        ai_model_used TEXT,
        ai_latency_ms INTEGER,
        tokens_prompt INTEGER,
        tokens_completion INTEGER,
        tokens_total INTEGER,
        location_id INTEGER
      );
      INSERT INTO intentions_list_mig (
        id, type, title, due_date, content_raw, metadata_json, suggested_tags, category_id, category, parent_id,
        status, is_organized, is_local_processed, complexity_level, created_at, calendar_event_id, calendar_name,
        is_synced_calendar, alarm_enabled, remind_at, local_notification_id, recurrence_rrule,
        is_done, done_at, is_archived, archived_at, is_pending_ai,
        remind_to_leave, location_address,
        ai_model_used, ai_latency_ms, tokens_prompt, tokens_completion, tokens_total, location_id
      )
      SELECT
        id, type, title, due_date, content_raw, metadata_json, suggested_tags, category_id, category, parent_id,
        status, is_organized, is_local_processed, complexity_level, created_at, calendar_event_id, calendar_name,
        is_synced_calendar, alarm_enabled, remind_at, local_notification_id, recurrence_rrule,
        COALESCE(is_done, CASE WHEN status = 'DONE' THEN 1 ELSE 0 END),
        done_at,
        COALESCE(is_archived, CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END),
        archived_at,
        COALESCE(is_pending_ai, 0),
        0, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL
      FROM intentions;
      DROP TABLE intentions;
      ALTER TABLE intentions_list_mig RENAME TO intentions;
      CREATE INDEX IF NOT EXISTS idx_intentions_type_status ON intentions (type, status);
      CREATE INDEX IF NOT EXISTS idx_intentions_created_at ON intentions (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_intentions_location_id ON intentions (location_id);
      CREATE INDEX IF NOT EXISTS idx_intentions_ai_model_used ON intentions (ai_model_used);
    `);
  }

  const colsIntentionsLogistics = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(intentions)`,
  );
  if (!colsIntentionsLogistics.some((c) => c.name === 'remind_to_leave')) {
    await db.execAsync(
      `ALTER TABLE intentions ADD COLUMN remind_to_leave INTEGER NOT NULL DEFAULT 0 CHECK (remind_to_leave IN (0, 1));`,
    );
  }
  if (!colsIntentionsLogistics.some((c) => c.name === 'location_address')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN location_address TEXT;`);
  }
  if (!colsIntentionsLogistics.some((c) => c.name === 'ai_model_used')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN ai_model_used TEXT;`);
  }
  if (!colsIntentionsLogistics.some((c) => c.name === 'ai_latency_ms')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN ai_latency_ms INTEGER;`);
  }
  if (!colsIntentionsLogistics.some((c) => c.name === 'tokens_prompt')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN tokens_prompt INTEGER;`);
  }
  if (!colsIntentionsLogistics.some((c) => c.name === 'tokens_completion')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN tokens_completion INTEGER;`);
  }
  if (!colsIntentionsLogistics.some((c) => c.name === 'tokens_total')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN tokens_total INTEGER;`);
  }
  if (!colsIntentionsLogistics.some((c) => c.name === 'location_id')) {
    await db.execAsync(`ALTER TABLE intentions ADD COLUMN location_id INTEGER;`);
  }
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_location_id ON intentions (location_id);`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_ai_model_used ON intentions (ai_model_used);`);

  const colsUserActivityLogs = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(user_activity_logs)`,
  );
  if (!colsUserActivityLogs.some((c) => c.name === 'intention_id')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN intention_id TEXT;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'request_id')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN request_id TEXT;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'api_name')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN api_name TEXT;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'http_status')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN http_status INTEGER;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'latency_ms')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN latency_ms INTEGER;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'ai_model_used')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN ai_model_used TEXT;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'tokens_prompt')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN tokens_prompt INTEGER;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'tokens_completion')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN tokens_completion INTEGER;`);
  }
  if (!colsUserActivityLogs.some((c) => c.name === 'tokens_total')) {
    await db.execAsync(`ALTER TABLE user_activity_logs ADD COLUMN tokens_total INTEGER;`);
  }
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs (created_at DESC);`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_intention_id ON user_activity_logs (intention_id);`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_request_id ON user_activity_logs (request_id);`);
}

export async function listTrankilV2Intentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions ORDER BY created_at DESC`,
  );
}

export async function listTrankilV2TimelineItemsByDate(
  selectedDateYmd: string,
  status: TrankilIntentStatus,
  mode: TrankilV2TimelineDateMode = 'DAY',
  opts?: { paging?: TimelinePaging; context?: TimelineSqlContext },
): Promise<TrankilV2TimelineItemRow[]> {
  const ctx = timelineContextWhere(opts?.context ?? 'ALL');
  await initTrankilV2Schema();
  const db = await getDb();
  const inner = `
    SELECT id, type, status, due_date, created_at, content_raw, parent_id, project_title, display_title, section, is_synced_calendar, category_id, suggested_tags, metadata_json, is_pending_ai
    FROM (
      SELECT
        i.id AS id,
        i.type AS type,
        i.status AS status,
        i.due_date AS due_date,
        i.created_at AS created_at,
        i.content_raw AS content_raw,
        i.parent_id AS parent_id,
        NULL AS project_title,
        i.title AS display_title,
        'TASK_HABIT' AS section,
        COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
        i.category_id AS category_id,
        i.suggested_tags AS suggested_tags,
        i.metadata_json AS metadata_json,
        COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
        i.due_date AS effective_date,
        1 AS section_order
      FROM intentions i
      WHERE i.status = ?
        AND COALESCE(i.is_archived, 0) = 0
        AND i.type IN ('TASK', 'HABIT')
        AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
        ${ctx}

      UNION ALL

      SELECT
        i.id AS id,
        i.type AS type,
        i.status AS status,
        i.due_date AS due_date,
        i.created_at AS created_at,
        i.content_raw AS content_raw,
        i.parent_id AS parent_id,
        p.title AS project_title,
        i.title AS display_title,
        'PROJECT_SUBTASK' AS section,
        COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
        i.category_id AS category_id,
        i.suggested_tags AS suggested_tags,
        i.metadata_json AS metadata_json,
        COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
        i.due_date AS effective_date,
        2 AS section_order
      FROM intentions i
      LEFT JOIN intentions p ON p.id = i.parent_id AND p.type = 'PROJECT'
      WHERE i.status = ?
        AND COALESCE(i.is_archived, 0) = 0
        AND i.type = 'TASK'
        AND i.parent_id IS NOT NULL
        AND trim(i.parent_id) != ''
        ${ctx}

      UNION ALL

      SELECT
        i.id AS id,
        i.type AS type,
        i.status AS status,
        i.due_date AS due_date,
        i.created_at AS created_at,
        i.content_raw AS content_raw,
        i.parent_id AS parent_id,
        NULL AS project_title,
        i.title AS display_title,
        CASE WHEN i.type = 'LIST' THEN 'LIST_CARD' ELSE 'NOTE_AUDIO' END AS section,
        COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
        i.category_id AS category_id,
        i.suggested_tags AS suggested_tags,
        i.metadata_json AS metadata_json,
        COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
        COALESCE(i.due_date, date(datetime(i.created_at / 1000, 'unixepoch', 'localtime'))) AS effective_date,
        3 AS section_order
      FROM intentions i
      WHERE i.status = ?
        AND COALESCE(i.is_archived, 0) = 0
        AND i.type IN ('NOTE', 'AUDIO', 'LIST')
        ${ctx}
    )
    WHERE
      (
        ? = 'DAY'
        AND effective_date = ?
      )
      OR (
        ? = 'WEEK'
        AND effective_date BETWEEN ? AND date(?, '+6 day')
      )
    ORDER BY section_order ASC, created_at DESC`;
  const baseParams = [status, status, status, mode, selectedDateYmd, mode, selectedDateYmd, selectedDateYmd];
  const { sql, params } = appendTimelinePaging(inner, baseParams, opts?.paging);
  return db.getAllAsync<TrankilV2TimelineItemRow>(sql, params);
}

/**
 * « Aujourd’hui » : journée courante + tâches « sans pression » non déjà présentes (fusion SQL + tri).
 */
export async function listTrankilV2MergedTodayTimelineWithLowPressure(
  selectedDateYmd: string,
  status: TrankilIntentStatus,
  context: TimelineSqlContext,
  paging: TimelinePaging,
): Promise<TrankilV2TimelineItemRow[]> {
  const ctx = timelineContextWhere(context);
  const ymdCompact = selectedDateYmd.replace(/-/g, '');
  const lim = Math.max(1, Math.min(500, Math.floor(Number(paging.limit ?? TIMELINE_PAGE_SIZE))));
  const off = Math.max(0, Math.floor(Number(paging.offset ?? 0)));
  await initTrankilV2Schema();
  const db = await getDb();
  const sql = `
WITH dated AS (
  SELECT * FROM (
    SELECT
      i.id AS id,
      i.type AS type,
      i.status AS status,
      i.due_date AS due_date,
      i.created_at AS created_at,
      i.content_raw AS content_raw,
      i.parent_id AS parent_id,
      NULL AS project_title,
      i.title AS display_title,
      'TASK_HABIT' AS section,
      COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
      i.category_id AS category_id,
      i.suggested_tags AS suggested_tags,
      i.metadata_json AS metadata_json,
      COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
      i.due_date AS effective_date,
      1 AS section_order
    FROM intentions i
    WHERE i.status = ?
      AND COALESCE(i.is_archived, 0) = 0
      AND i.type IN ('TASK', 'HABIT')
      AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
      ${ctx}
    UNION ALL
    SELECT
      i.id AS id,
      i.type AS type,
      i.status AS status,
      i.due_date AS due_date,
      i.created_at AS created_at,
      i.content_raw AS content_raw,
      i.parent_id AS parent_id,
      p.title AS project_title,
      i.title AS display_title,
      'PROJECT_SUBTASK' AS section,
      COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
      i.category_id AS category_id,
      i.suggested_tags AS suggested_tags,
      i.metadata_json AS metadata_json,
      COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
      i.due_date AS effective_date,
      2 AS section_order
    FROM intentions i
    LEFT JOIN intentions p ON p.id = i.parent_id AND p.type = 'PROJECT'
    WHERE i.status = ?
      AND COALESCE(i.is_archived, 0) = 0
      AND i.type = 'TASK'
      AND i.parent_id IS NOT NULL
      AND trim(i.parent_id) != ''
      ${ctx}
    UNION ALL
    SELECT
      i.id AS id,
      i.type AS type,
      i.status AS status,
      i.due_date AS due_date,
      i.created_at AS created_at,
      i.content_raw AS content_raw,
      i.parent_id AS parent_id,
      NULL AS project_title,
      i.title AS display_title,
      CASE WHEN i.type = 'LIST' THEN 'LIST_CARD' ELSE 'NOTE_AUDIO' END AS section,
      COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
      i.category_id AS category_id,
      i.suggested_tags AS suggested_tags,
      i.metadata_json AS metadata_json,
      COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
      COALESCE(i.due_date, date(datetime(i.created_at / 1000, 'unixepoch', 'localtime'))) AS effective_date,
      3 AS section_order
    FROM intentions i
    WHERE i.status = ?
      AND COALESCE(i.is_archived, 0) = 0
      AND i.type IN ('NOTE', 'AUDIO', 'LIST')
      ${ctx}
  ) z
  WHERE z.effective_date = ?
),
lowp AS (
  SELECT
    i.id AS id,
    i.type AS type,
    i.status AS status,
    i.due_date AS due_date,
    i.created_at AS created_at,
    i.content_raw AS content_raw,
    i.parent_id AS parent_id,
    NULL AS project_title,
    i.title AS display_title,
    'TASK_HABIT' AS section,
    COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
    i.category_id AS category_id,
    i.suggested_tags AS suggested_tags,
    i.metadata_json AS metadata_json,
    COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
    NULL AS effective_date,
    1 AS section_order
  FROM intentions i
  WHERE i.status = ?
    AND COALESCE(i.is_archived, 0) = 0
    AND i.type = 'TASK'
    AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
    AND (
      (i.due_date IS NULL OR trim(i.due_date) = '')
      OR (instr(i.suggested_tags, '"a_trier"') > 0)
    )
    ${ctx}
    AND NOT EXISTS (SELECT 1 FROM dated d WHERE d.id = i.id)
)
SELECT id, type, status, due_date, created_at, content_raw, parent_id, project_title, display_title, section, is_synced_calendar, category_id, suggested_tags, metadata_json, is_pending_ai
FROM (
  SELECT * FROM dated
  UNION ALL
  SELECT * FROM lowp
) u
ORDER BY u.section_order ASC,
  CASE WHEN u.type = 'HABIT' THEN 0 ELSE 1 END,
  CASE
    WHEN u.type = 'TASK' AND (
      (length(trim(u.due_date)) = 10 AND u.due_date = ?)
      OR (length(trim(u.due_date)) = 8 AND u.due_date = ?)
    ) THEN 0
    ELSE 1
  END,
  u.created_at DESC
LIMIT ? OFFSET ?`;
  return db.getAllAsync<TrankilV2TimelineItemRow>(sql, [
    status,
    status,
    status,
    selectedDateYmd,
    status,
    selectedDateYmd,
    ymdCompact,
    lim,
    off,
  ]);
}

/** Tâches racine sans échéance (« tirelire »), pour le même filtre de statut que la Timeline. */
export async function listTrankilV2UndatedRootTasks(
  status: TrankilIntentStatus,
  opts?: { paging?: TimelinePaging; context?: TimelineSqlContext },
): Promise<TrankilV2TimelineItemRow[]> {
  const ctx = timelineContextWhere(opts?.context ?? 'ALL');
  await initTrankilV2Schema();
  const db = await getDb();
  const inner = `SELECT
       i.id AS id,
       i.type AS type,
       i.status AS status,
       i.due_date AS due_date,
       i.created_at AS created_at,
       i.content_raw AS content_raw,
       i.parent_id AS parent_id,
       NULL AS project_title,
       i.title AS display_title,
       'TASK_HABIT' AS section,
       COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
       i.category_id AS category_id,
       i.suggested_tags AS suggested_tags,
       i.metadata_json AS metadata_json,
       COALESCE(i.is_pending_ai, 0) AS is_pending_ai
     FROM intentions i
     WHERE i.status = ?
       AND COALESCE(i.is_archived, 0) = 0
       AND i.type = 'TASK'
       AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
       AND (i.due_date IS NULL OR trim(i.due_date) = '')
       ${ctx}
     ORDER BY i.created_at DESC`;
  const { sql, params } = appendTimelinePaging(inner, [status], opts?.paging);
  return db.getAllAsync<TrankilV2TimelineItemRow>(sql, params);
}

/**
 * Tâches racine « sans pression » : sans échéance ou portant le tag `a_trier` (pilotage « Aujourd’hui »).
 */
export async function listTrankilV2LowPressureRootTasks(
  status: TrankilIntentStatus,
  opts?: { paging?: TimelinePaging; context?: TimelineSqlContext },
): Promise<TrankilV2TimelineItemRow[]> {
  const ctx = timelineContextWhere(opts?.context ?? 'ALL');
  await initTrankilV2Schema();
  const db = await getDb();
  const inner = `SELECT
       i.id AS id,
       i.type AS type,
       i.status AS status,
       i.due_date AS due_date,
       i.created_at AS created_at,
       i.content_raw AS content_raw,
       i.parent_id AS parent_id,
       NULL AS project_title,
       i.title AS display_title,
       'TASK_HABIT' AS section,
       COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
       i.category_id AS category_id,
       i.suggested_tags AS suggested_tags,
       i.metadata_json AS metadata_json,
       COALESCE(i.is_pending_ai, 0) AS is_pending_ai
     FROM intentions i
     WHERE i.status = ?
       AND COALESCE(i.is_archived, 0) = 0
       AND i.type = 'TASK'
       AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
       AND (
         (i.due_date IS NULL OR trim(i.due_date) = '')
         OR (instr(i.suggested_tags, '"a_trier"') > 0)
       )
       ${ctx}
     ORDER BY i.created_at DESC`;
  const { sql, params } = appendTimelinePaging(inner, [status], opts?.paging);
  return db.getAllAsync<TrankilV2TimelineItemRow>(sql, params);
}

export type TrankilV2ChildTaskStats = { total: number; done: number };

/** Compte les sous-tâches `TASK` rattachées à chaque `parent_id` (tâche racine ou projet). */
export async function bulkTrankilV2TaskChildStatsByParentIds(
  parentIds: string[],
): Promise<Map<string, TrankilV2ChildTaskStats>> {
  const unique = [...new Set(parentIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const out = new Map<string, TrankilV2ChildTaskStats>();
  if (unique.length === 0) return out;
  await initTrankilV2Schema();
  const db = await getDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ parent_id: string; total: number; done: number }>(
    `SELECT
       parent_id AS parent_id,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS done
     FROM intentions
     WHERE type = 'TASK' AND parent_id IN (${placeholders})
     GROUP BY parent_id`,
    unique,
  );
  for (const r of rows) {
    out.set(r.parent_id, {
      total: Number(r.total ?? 0),
      done: Number(r.done ?? 0),
    });
  }
  return out;
}

export async function listArchivedIntentions(limit: number = 200): Promise<TrankilV2TimelineItemRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.round(limit)) : 200;
  return db.getAllAsync<TrankilV2TimelineItemRow>(
    `SELECT
       i.id AS id,
       i.type AS type,
       i.status AS status,
       i.due_date AS due_date,
       i.created_at AS created_at,
       i.content_raw AS content_raw,
       i.parent_id AS parent_id,
       p.title AS project_title,
       i.title AS display_title,
       CASE WHEN i.type = 'LIST' THEN 'LIST_CARD'
            WHEN i.type IN ('NOTE', 'AUDIO') THEN 'NOTE_AUDIO'
            WHEN i.parent_id IS NOT NULL AND trim(i.parent_id) != '' THEN 'PROJECT_SUBTASK'
            ELSE 'TASK_HABIT' END AS section,
       COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
       i.category_id AS category_id,
       i.suggested_tags AS suggested_tags,
       i.metadata_json AS metadata_json,
       COALESCE(i.is_pending_ai, 0) AS is_pending_ai
     FROM intentions i
     LEFT JOIN intentions p ON p.id = i.parent_id AND p.type = 'PROJECT'
     WHERE i.status = 'ARCHIVED'
     ORDER BY i.created_at DESC
     LIMIT ?`,
    [safeLimit],
  );
}

export async function listTrankilV2Categories(): Promise<
  Array<{ id: string; label: string; sort_order: number }>
> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<{ id: string; label: string; sort_order: number }>(
    `SELECT id, label, sort_order FROM categories ORDER BY sort_order ASC, id ASC`,
  );
}

export async function getTrankilV2IntentionTaskCounts(): Promise<{
  intentionsCount: number;
  tasksCount: number;
}> {
  await initTrankilV2Schema();
  const db = await getDb();
  const intentionsRow = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM intentions`,
  );
  const tasksRow = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM intentions WHERE type = 'TASK'`,
  );
  return {
    intentionsCount: Number(intentionsRow?.total ?? 0),
    tasksCount: Number(tasksRow?.total ?? 0),
  };
}

export async function getLastTrankilV2IntentionRaw(): Promise<TrankilV2IntentionRow | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  return (
    (await db.getFirstAsync<TrankilV2IntentionRow>(
      `SELECT * FROM intentions ORDER BY created_at DESC LIMIT 1`,
    )) ?? null
  );
}

export async function purgeTrankilV2IntentionsCascade(): Promise<{
  intentionsDeleted: number;
  tasksDeleted: number;
}> {
  await initTrankilV2Schema();
  const db = await getDb();
  const before = await getTrankilV2IntentionTaskCounts();
  await db.execAsync(`DELETE FROM intentions;`);
  const hasTasksTable = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='tasks' LIMIT 1`,
  );
  if (hasTasksTable) {
    await db.execAsync(`DELETE FROM tasks;`);
  }
  return {
    intentionsDeleted: before.intentionsCount,
    tasksDeleted: before.tasksCount,
  };
}

/** Vrac Timeline : brouillon sans étiquette ni date, actif, non archivé (`is_organized = 0`). */
export async function listTrankilV2UnorganizedIntentions(opts?: {
  paging?: TimelinePaging;
  context?: TimelineSqlContext;
}): Promise<TrankilV2IntentionRow[]> {
  const ctx = timelineContextWhere(opts?.context ?? 'ALL', 'intentions');
  await initTrankilV2Schema();
  const db = await getDb();
  const inner = `SELECT * FROM intentions
     WHERE status = 'TODO'
       AND COALESCE(is_archived, 0) = 0
       AND is_organized = 0
       AND (category_id IS NULL OR trim(category_id) = '')
       AND (due_date IS NULL OR trim(due_date) = '')
       ${ctx}
     ORDER BY created_at DESC`;
  const { sql, params } = appendTimelinePaging(inner, [], opts?.paging);
  return db.getAllAsync<TrankilV2IntentionRow>(sql, params);
}

/** Intentions organisées : actif, non archivé, avec organisation / étiquette / date. */
export async function listTrankilV2OrganizedIntentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions
     WHERE status = 'TODO'
       AND COALESCE(is_archived, 0) = 0
       AND (
         is_organized = 1
         OR (category_id IS NOT NULL AND trim(category_id) != '')
         OR (due_date IS NOT NULL AND trim(due_date) != '')
       )
     ORDER BY created_at DESC`,
  );
}

/** Archives cycle de vie : terminées ou archivées. */
export async function listTrankilV2MeliArchivesIntentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions
     WHERE status IN ('DONE', 'ARCHIVED')
        OR COALESCE(is_done, 0) = 1
        OR COALESCE(is_archived, 0) = 1
     ORDER BY COALESCE(archived_at, done_at, created_at) DESC`,
  );
}

/** Intentions avec drapeau `is_archived` (pilotage Timeline « Archives »). */
export async function listTrankilV2IsArchivedIntentions(opts?: {
  paging?: TimelinePaging;
  /** Aligné sur le segment TODO / Done de la Timeline. */
  statusFilter?: 'TODO' | 'DONE';
  context?: TimelineSqlContext;
}): Promise<TrankilV2IntentionRow[]> {
  const ctx = timelineContextWhere(opts?.context ?? 'ALL', 'i');
  const statusPart =
    opts?.statusFilter === 'DONE'
      ? `AND i.status = 'DONE'`
      : opts?.statusFilter === 'TODO'
        ? `AND (i.status IN ('TODO', 'ARCHIVED'))`
        : '';
  await initTrankilV2Schema();
  const db = await getDb();
  const inner = `SELECT i.* FROM intentions i
     WHERE COALESCE(i.is_archived, 0) = 1
     ${statusPart}
     ${ctx}
     ORDER BY COALESCE(i.archived_at, i.created_at) DESC`;
  const { sql, params } = appendTimelinePaging(inner, [], opts?.paging);
  return db.getAllAsync<TrankilV2IntentionRow>(sql, params);
}

/** Projection légère d’une ligne `intentions` vers le modèle liste Timeline. */
export function mapTrankilIntentionToTimelineItemRow(row: TrankilV2IntentionRow): TrankilV2TimelineItemRow {
  const pid = String(row.parent_id ?? '').trim();
  const section: TrankilV2TimelineItemRow['section'] =
    row.type === 'LIST'
      ? 'LIST_CARD'
      : row.type === 'NOTE' || row.type === 'AUDIO'
        ? 'NOTE_AUDIO'
        : row.type === 'TASK' && pid
          ? 'PROJECT_SUBTASK'
          : 'TASK_HABIT';
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    due_date: row.due_date ?? null,
    created_at: row.created_at,
    content_raw: row.content_raw,
    parent_id: row.parent_id,
    project_title: null,
    display_title: row.title,
    section,
    is_synced_calendar: row.is_synced_calendar ?? 0,
    category_id: row.category_id ?? null,
    suggested_tags: row.suggested_tags ?? '[]',
    metadata_json: row.metadata_json,
    is_pending_ai: row.is_pending_ai ?? 0,
  };
}

/**
 * Supprime définitivement les intentions archivées dont `archived_at` dépasse la rétention
 * (préférence {@link getArchiveRetentionChoice} dans `archiveRetentionSettings`).
 */
export async function cleanOldArchives(): Promise<number> {
  const { getArchiveRetentionChoice } = await import('../services/archiveRetentionSettings');
  const choice = await getArchiveRetentionChoice();
  if (choice === 'never') return 0;
  const days = choice === '30' ? 30 : 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  await initTrankilV2Schema();
  const db = await getDb();
  const before = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions
     WHERE COALESCE(is_archived, 0) = 1
       AND archived_at IS NOT NULL
       AND archived_at < ?`,
    [cutoff],
  );
  const n = Number(before?.n ?? 0);
  if (n === 0) return 0;
  await db.runAsync(
    `DELETE FROM intentions
     WHERE COALESCE(is_archived, 0) = 1
       AND archived_at IS NOT NULL
       AND archived_at < ?`,
    [cutoff],
  );
  notifyIntentionsChanged({ reason: 'clean_old_archives' });
  return n;
}

export async function getTrankilV2UserStats(): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<TrankilV2UserStatsRow>(
    `SELECT ia_credits, growth_score, local_action_streak, ad_last_reward_at, ad_videos_watched, pending_sync_ia_credits, recharge_window_started_at, recharge_videos_in_window, recharge_last_video_at FROM user_stats WHERE id = 1`,
  );
  return (
    row ?? {
      ia_credits: 10,
      zen_points: 0,
      growth_score: 0,
      local_action_streak: 0,
      ad_last_reward_at: null,
      ad_videos_watched: 0,
      pending_sync_ia_credits: 0,
      recharge_window_started_at: null,
      recharge_videos_in_window: 0,
      recharge_last_video_at: null,
    }
  );
}

export type TrankilV2BillingStateRow = {
  daily_intentions_limit: number;
  current_day_intentions_count: number;
  daily_notes_limit: number;
  current_day_notes_count: number;
  trip_credits_balance: number;
  feature_flags_json: string;
};

export async function getBillingState(): Promise<TrankilV2BillingStateRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<TrankilV2BillingStateRow>(
    `SELECT daily_intentions_limit, current_day_intentions_count, daily_notes_limit, current_day_notes_count, trip_credits_balance, feature_flags_json
     FROM user_billing_state
     WHERE id = 1`,
  );
  return (
    row ?? {
      daily_intentions_limit: 0,
      current_day_intentions_count: 0,
      daily_notes_limit: 0,
      current_day_notes_count: 0,
      trip_credits_balance: 0,
      feature_flags_json: '{}',
    }
  );
}

export type TrankilV2KnowledgeNamespace = 'USER' | 'IA';

export type TrankilV2KnowledgeRow = {
  key: string;
  value_text: string;
  value_json: string;
  namespace: TrankilV2KnowledgeNamespace;
  confidence_score: number;
  updated_at_ms: number;
};

export async function getKnowledge(
  key: string,
): Promise<(TrankilV2KnowledgeRow & { value: unknown }) | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  const k = String(key || '').trim();
  if (!k) return null;
  const row = await db.getFirstAsync<TrankilV2KnowledgeRow>(
    `SELECT key, value_text, value_json, namespace, confidence_score, updated_at_ms
     FROM user_knowledge
     WHERE key = ?`,
    [k],
  );
  if (!row) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.value_json || '{}');
  } catch {
    parsed = null;
  }
  const value = row.value_text?.trim() ? row.value_text : parsed;
  return { ...row, value };
}

export async function setKnowledge(
  key: string,
  value: unknown,
  opts?: { namespace?: TrankilV2KnowledgeNamespace; confidence_score?: number; updated_at_ms?: number },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const k = String(key || '').trim();
  if (!k) return;
  const updatedAt =
    Number.isFinite(opts?.updated_at_ms as number) ? Number(opts?.updated_at_ms) : Date.now();
  const namespace = opts?.namespace ?? 'USER';
  const confidence = Number.isFinite(opts?.confidence_score as number)
    ? Math.max(0, Math.min(1, Number(opts?.confidence_score)))
    : 1;
  const valueText = typeof value === 'string' ? value : '';
  let valueJson = '{}';
  if (typeof value === 'string') {
    valueJson = '{}';
  } else {
    try {
      valueJson = JSON.stringify(value ?? {});
    } catch {
      valueJson = '{}';
    }
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO user_knowledge (key, value_text, value_json, namespace, confidence_score, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [k, valueText, valueJson, namespace, confidence, updatedAt],
  );
}

export async function getUserContext(key: string): Promise<unknown | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  const k = String(key || '').trim();
  if (!k) return null;
  const row = await db.getFirstAsync<{ value_json: string }>(
    `SELECT value_json FROM user_context WHERE key = ?`,
    [k],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.value_json || '{}');
  } catch {
    return null;
  }
}

export async function setUserContext(key: string, value: unknown): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const k = String(key || '').trim();
  if (!k) return;
  let json = '{}';
  try {
    json = JSON.stringify(value ?? {});
  } catch {
    json = '{}';
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO user_context (key, value_json) VALUES (?, ?)`,
    [k, json],
  );
}

export async function grantViralBonus(nowMs: number = Date.now()): Promise<{
  granted: boolean;
  nextEligibleAt: number;
}> {
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const cooldownUntil = nowMs + 24 * 60 * 60 * 1000;
  await db.runAsync(
    `UPDATE user_stats
      SET zen_points = ?,
          growth_score = ?
      WHERE id = 1`,
    [stats.zen_points + 10, stats.zen_points + 10],
  );
  return { granted: true, nextEligibleAt: cooldownUntil };
}

export async function setNotificationsQuietUntil(timestamp: number | null): Promise<void> {
  void timestamp;
}

export async function consumeTrankilV2IntentCredit(): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const nextRemaining = Math.max(0, current.ia_credits - 1);
  await db.runAsync(
    `UPDATE user_stats SET ia_credits = ? WHERE id = 1`,
    [nextRemaining],
  );
  return {
    ...current,
    ia_credits: nextRemaining,
  };
}

export async function consumeIaCredits(cost: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const safeCost = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  const nextRemaining = Math.max(0, Number(current.ia_credits || 0) - safeCost);
  await db.runAsync(`UPDATE user_stats SET ia_credits = ? WHERE id = 1`, [nextRemaining]);
  if (safeCost > 0) {
    void insertUserActivityLog({
      action_type: 'IA_SPENT',
      points_delta: -Math.round(safeCost),
      meta_json: JSON.stringify({ source: 'consumeIaCredits' }),
    }).catch(() => undefined);
  }
  return {
    ...current,
    ia_credits: nextRemaining,
  };
}

export async function addIaCredits(count: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  const next = current.ia_credits + safe;
  await db.runAsync(`UPDATE user_stats SET ia_credits = ? WHERE id = 1`, [next]);
  return {
    ...current,
    ia_credits: next,
  };
}

export async function refundIaCredit(count: number = 1): Promise<TrankilV2UserStatsRow> {
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return addIaCredits(safe);
}

function formatYmdLocalForQuota(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function ensureFreeDailyCaptureResetForDb(db: SQLite.SQLiteDatabase): Promise<void> {
  const today = formatYmdLocalForQuota(new Date());
  const row = await db.getFirstAsync<{
    free_capture_day_ymd: string | null;
    free_capture_remaining: number | null;
  }>(`SELECT free_capture_day_ymd, free_capture_remaining FROM user_stats WHERE id = 1`);
  if (!row) return;
  if (row.free_capture_day_ymd !== today) {
    await db.runAsync(
      `UPDATE user_stats SET free_capture_day_ymd = ?, free_capture_remaining = ? WHERE id = 1`,
      [today, FREE_DAILY_CAPTURE_MAX],
    );
  }
}

export type FreeCaptureQuotaSnapshot = {
  remaining: number;
  max: number;
  dayYmd: string;
};

export async function getFreeCaptureQuotaSnapshot(): Promise<FreeCaptureQuotaSnapshot> {
  await initTrankilV2Schema();
  const db = await getDb();
  await ensureFreeDailyCaptureResetForDb(db);
  const row = await db.getFirstAsync<{
    free_capture_day_ymd: string | null;
    free_capture_remaining: number | null;
  }>(`SELECT free_capture_day_ymd, free_capture_remaining FROM user_stats WHERE id = 1`);
  const today = formatYmdLocalForQuota(new Date());
  const remaining = Math.max(
    0,
    Math.min(
      FREE_DAILY_CAPTURE_MAX,
      Number(row?.free_capture_remaining ?? FREE_DAILY_CAPTURE_MAX),
    ),
  );
  return {
    remaining,
    max: FREE_DAILY_CAPTURE_MAX,
    dayYmd: row?.free_capture_day_ymd ?? today,
  };
}

/**
 * Décrémente d’une unité le quota Free après une capture micro réussie (hors Pro).
 * Émet {@link INTENTIONS_CHANGED_EVENT_NAME} pour rafraîchir les badges.
 */
export async function consumeFreeCaptureSuccessOnce(): Promise<FreeCaptureQuotaSnapshot> {
  await initTrankilV2Schema();
  const db = await getDb();
  await ensureFreeDailyCaptureResetForDb(db);
  const before = await db.getFirstAsync<{ free_capture_remaining: number | null }>(
    `SELECT free_capture_remaining FROM user_stats WHERE id = 1`,
  );
  const cur = Math.max(
    0,
    Math.min(FREE_DAILY_CAPTURE_MAX, Number(before?.free_capture_remaining ?? 0)),
  );
  if (cur <= 0) {
    return getFreeCaptureQuotaSnapshot();
  }
  const next = cur - 1;
  await db.runAsync(`UPDATE user_stats SET free_capture_remaining = ? WHERE id = 1`, [next]);
  notifyIntentionsChanged({ reason: 'free_capture_consumed' });
  const today = formatYmdLocalForQuota(new Date());
  return { remaining: next, max: FREE_DAILY_CAPTURE_MAX, dayYmd: today };
}

async function ensureListFreeDailyResetForDb(db: SQLite.SQLiteDatabase): Promise<void> {
  const today = formatYmdLocalForQuota(new Date());
  const row = await db.getFirstAsync<{
    list_free_day_ymd: string | null;
    list_free_remaining: number | null;
  }>(`SELECT list_free_day_ymd, list_free_remaining FROM user_stats WHERE id = 1`);
  if (!row) return;
  if (row.list_free_day_ymd !== today) {
    await db.runAsync(
      `UPDATE user_stats SET list_free_day_ymd = ?, list_free_remaining = ? WHERE id = 1`,
      [today, FREE_DAILY_LIST_MAX],
    );
  }
}

export type ListFreeQuotaSnapshot = {
  remaining: number;
  max: number;
  dayYmd: string;
};

export async function getListFreeQuotaSnapshot(): Promise<ListFreeQuotaSnapshot> {
  await initTrankilV2Schema();
  const db = await getDb();
  await ensureListFreeDailyResetForDb(db);
  const row = await db.getFirstAsync<{
    list_free_day_ymd: string | null;
    list_free_remaining: number | null;
  }>(`SELECT list_free_day_ymd, list_free_remaining FROM user_stats WHERE id = 1`);
  const today = formatYmdLocalForQuota(new Date());
  const remaining = Math.max(
    0,
    Math.min(FREE_DAILY_LIST_MAX, Number(row?.list_free_remaining ?? FREE_DAILY_LIST_MAX)),
  );
  return {
    remaining,
    max: FREE_DAILY_LIST_MAX,
    dayYmd: row?.list_free_day_ymd ?? today,
  };
}

export async function consumeListFreeSuccessOnce(): Promise<ListFreeQuotaSnapshot> {
  await initTrankilV2Schema();
  const db = await getDb();
  await ensureListFreeDailyResetForDb(db);
  const before = await db.getFirstAsync<{ list_free_remaining: number | null }>(
    `SELECT list_free_remaining FROM user_stats WHERE id = 1`,
  );
  const cur = Math.max(0, Math.min(FREE_DAILY_LIST_MAX, Number(before?.list_free_remaining ?? 0)));
  if (cur <= 0) {
    return getListFreeQuotaSnapshot();
  }
  const next = cur - 1;
  await db.runAsync(`UPDATE user_stats SET list_free_remaining = ? WHERE id = 1`, [next]);
  notifyIntentionsChanged({ reason: 'list_free_consumed' });
  const today = formatYmdLocalForQuota(new Date());
  return { remaining: next, max: FREE_DAILY_LIST_MAX, dayYmd: today };
}

export async function markIaRechargeWatch(nowMs: number = Date.now()): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const windowStart = stats.recharge_window_started_at ?? nowMs;
  const windowExpired = nowMs - windowStart >= 24 * 60 * 60 * 1000;
  const nextWindowStart = windowExpired ? nowMs : windowStart;
  const nextCount = windowExpired ? 1 : stats.recharge_videos_in_window + 1;
  await db.runAsync(
    `UPDATE user_stats
      SET recharge_window_started_at = ?,
          recharge_videos_in_window = ?,
          recharge_last_video_at = ?
      WHERE id = 1`,
    [nextWindowStart, nextCount, nowMs],
  );
  return {
    ...stats,
    recharge_window_started_at: nextWindowStart,
    recharge_videos_in_window: nextCount,
    recharge_last_video_at: nowMs,
  };
}

export async function setPendingIaCreditSync(count: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const next = Math.max(0, Math.round(count));
  await db.runAsync(`UPDATE user_stats SET pending_sync_ia_credits = ? WHERE id = 1`, [next]);
  return { ...stats, pending_sync_ia_credits: next };
}

export async function addPendingIaCreditSync(delta: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const safe = Number.isFinite(delta) ? Math.round(delta) : 0;
  const next = Math.max(0, stats.pending_sync_ia_credits + safe);
  await db.runAsync(`UPDATE user_stats SET pending_sync_ia_credits = ? WHERE id = 1`, [next]);
  return { ...stats, pending_sync_ia_credits: next };
}

export async function addRemainingIntents(count: number): Promise<TrankilV2UserStatsRow> {
  return addIaCredits(count);
}

export type TrankilV2IntentionInsert = {
  id: string;
  type: TrankilIntentType;
  title: string;
  due_date?: string | null;
  content_raw: string;
  metadata_json?: string;
  suggested_tags?: string;
  category_id?: string | null;
  parent_id?: string | null;
  status?: TrankilIntentStatus;
  is_organized?: number;
  is_local_processed?: number;
  complexity_level?: number;
  created_at?: number;
  calendar_event_id?: string | null;
  calendar_name?: string | null;
  is_synced_calendar?: number;
  alarm_enabled?: number;
  remind_at?: number | null;
  local_notification_id?: string | null;
  recurrence_rrule?: string | null;
  is_pending_ai?: number;
  remind_to_leave?: number;
  location_address?: string | null;
  ai_model_used?: string | null;
  ai_latency_ms?: number | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  tokens_total?: number | null;
  location_id?: number | null;
};

function normalizeTitleForLogisticsMatch(title: string): string {
  /** Aligné sur le `WHERE` SQL : trim + lower + tab/sauts → espace (sans fusion des espaces multiples). */
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\t/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ');
}

/**
 * Dernière intention enregistrée avec le même titre (normalisé) et une adresse — mémoire logistique one-tap.
 */
export async function fetchLatestOneTapLogisticsMemory(
  title: string,
): Promise<{ location_address: string; remind_to_leave: number } | null> {
  await initTrankilV2Schema();
  const key = normalizeTitleForLogisticsMatch(title);
  if (!key) return null;
  const db = await getDb();
  const row = await db.getFirstAsync<{
    location_address: string | null;
    remind_to_leave: number | null;
  }>(
    `SELECT location_address, remind_to_leave FROM intentions
     WHERE trim(lower(replace(replace(title, char(9), ' '), char(10), ' '))) = ?
       AND location_address IS NOT NULL
       AND trim(location_address) != ''
     ORDER BY created_at DESC
     LIMIT 1`,
    [key],
  );
  if (!row?.location_address?.trim()) return null;
  return {
    location_address: row.location_address.trim(),
    remind_to_leave: row.remind_to_leave ? 1 : 0,
  };
}

export async function insertTrankilV2Intention(
  row: TrankilV2IntentionInsert,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const remindLeave = row.remind_to_leave ?? 0;
  const locAddr = row.location_address?.trim() ? row.location_address.trim() : null;
  await db.runAsync(
    `INSERT INTO intentions (
      id, type, title, due_date, content_raw, metadata_json, suggested_tags, category_id, category, parent_id, status, is_organized, is_local_processed, complexity_level, created_at, calendar_event_id, calendar_name, is_synced_calendar, alarm_enabled, remind_at, local_notification_id, recurrence_rrule,
      is_pending_ai,
      remind_to_leave, location_address,
      ai_model_used, ai_latency_ms, tokens_prompt, tokens_completion, tokens_total, location_id,
      is_done, done_at, is_archived, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL)`,
    [
      row.id,
      row.type,
      row.title,
      normalizeDueDate(row.due_date),
      row.content_raw,
      row.metadata_json ?? '{}',
      row.suggested_tags ?? '[]',
      row.category_id ?? null,
      row.category_id ?? null,
      row.parent_id ?? null,
      row.status ?? 'TODO',
      row.is_organized ?? 0,
      row.is_local_processed ?? 0,
      row.complexity_level ?? 1,
      row.created_at ?? Date.now(),
      row.calendar_event_id ?? null,
      row.calendar_name ?? null,
      row.is_synced_calendar ?? 0,
      row.alarm_enabled ?? 0,
      row.remind_at ?? null,
      row.local_notification_id ?? null,
      row.recurrence_rrule ?? null,
      row.is_pending_ai ?? 0,
      remindLeave ? 1 : 0,
      locAddr,
      row.ai_model_used ?? null,
      Number.isFinite(row.ai_latency_ms as number) ? Number(row.ai_latency_ms) : null,
      Number.isFinite(row.tokens_prompt as number) ? Number(row.tokens_prompt) : null,
      Number.isFinite(row.tokens_completion as number) ? Number(row.tokens_completion) : null,
      Number.isFinite(row.tokens_total as number) ? Number(row.tokens_total) : null,
      Number.isFinite(row.location_id as number) ? Number(row.location_id) : null,
    ],
  );
  const stats = await getTrankilV2UserStats();
  void stats;
  await syncAfterIntentionWrite('insertTrankilV2Intention');
  notifyIntentionsChanged({ id: row.id, reason: 'insert' });
}

/**
 * Remplace le contenu d’une intention existante (flux one-tap optimiste : UPDATE final).
 * Ne modifie pas `created_at`.
 */
export async function replaceTrankilV2IntentionOneTap(
  id: string,
  patch: Omit<TrankilV2IntentionInsert, 'id' | 'created_at'>,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const remindLeave = patch.remind_to_leave ?? 0;
  const locAddr =
    patch.location_address !== undefined && patch.location_address !== null
      ? String(patch.location_address).trim() || null
      : null;
  await db.runAsync(
    `UPDATE intentions SET
      type = ?,
      title = ?,
      due_date = ?,
      content_raw = ?,
      metadata_json = ?,
      suggested_tags = ?,
      category_id = ?,
      category = ?,
      parent_id = ?,
      status = ?,
      is_organized = ?,
      is_local_processed = ?,
      complexity_level = ?,
      is_pending_ai = ?,
      remind_to_leave = ?,
      location_address = ?,
      ai_model_used = COALESCE(?, ai_model_used),
      ai_latency_ms = COALESCE(?, ai_latency_ms),
      tokens_prompt = COALESCE(?, tokens_prompt),
      tokens_completion = COALESCE(?, tokens_completion),
      tokens_total = COALESCE(?, tokens_total),
      location_id = COALESCE(?, location_id)
    WHERE id = ?`,
    [
      patch.type,
      patch.title,
      normalizeDueDate(patch.due_date ?? null),
      patch.content_raw,
      patch.metadata_json ?? '{}',
      patch.suggested_tags ?? '[]',
      patch.category_id ?? null,
      patch.category_id ?? null,
      patch.parent_id ?? null,
      patch.status ?? 'TODO',
      patch.is_organized ?? 0,
      patch.is_local_processed ?? 1,
      patch.complexity_level ?? 1,
      patch.is_pending_ai ?? 0,
      remindLeave ? 1 : 0,
      locAddr,
      patch.ai_model_used ?? null,
      Number.isFinite(patch.ai_latency_ms as number) ? Number(patch.ai_latency_ms) : null,
      Number.isFinite(patch.tokens_prompt as number) ? Number(patch.tokens_prompt) : null,
      Number.isFinite(patch.tokens_completion as number) ? Number(patch.tokens_completion) : null,
      Number.isFinite(patch.tokens_total as number) ? Number(patch.tokens_total) : null,
      Number.isFinite(patch.location_id as number) ? Number(patch.location_id) : null,
      id,
    ],
  );
  await syncAfterIntentionWrite('replaceTrankilV2IntentionOneTap');
  notifyIntentionsChanged({ id, reason: 'one_tap_replace' });
}

export async function updateTrankilV2IntentionQuick(
  id: string,
  patch: { title?: string; category_id?: string | null },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE id = ?`,
    [id],
  );
  if (!current) return;
  await db.runAsync(
    `UPDATE intentions SET title = ?, category_id = ?, category = ? WHERE id = ?`,
    [
      patch.title ?? current.title,
      patch.category_id ?? current.category_id,
      patch.category_id ?? current.category_id,
      id,
    ],
  );
}

export async function updateTrankilV2IntentionTemporal(
  id: string,
  patch: { due_date?: string | null; category_id?: string | null; metadata_json?: string },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE id = ?`,
    [id],
  );
  if (!current) return;
  const nextCategory = patch.category_id ?? current.category_id;
  await db.runAsync(
    `UPDATE intentions
     SET due_date = ?,
         category_id = ?,
         category = ?,
         metadata_json = ?
     WHERE id = ?`,
    [
      normalizeDueDate(patch.due_date ?? current.due_date ?? null),
      nextCategory,
      nextCategory,
      patch.metadata_json ?? current.metadata_json,
      id,
    ],
  );
  await syncAfterIntentionWrite('updateTrankilV2IntentionTemporal');
  notifyIntentionsChanged({ id, reason: 'temporal' });
}

export async function updateTrankilV2IntentionOrganization(
  id: string,
  patch: { is_organized: number; title?: string; category_id?: string | null },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE id = ?`,
    [id],
  );
  if (!current) return;
  await db.runAsync(
    `UPDATE intentions SET is_organized = ?, title = ?, category_id = ?, category = ? WHERE id = ?`,
    [
      patch.is_organized,
      patch.title ?? current.title,
      patch.category_id ?? current.category_id,
      patch.category_id ?? current.category_id,
      id,
    ],
  );
  if (patch.is_organized === 1 && current.is_organized !== 1) {
    await db.runAsync(`UPDATE user_stats SET zen_points = zen_points + 0 WHERE id = 1`);
  }
}

export async function updateTrankilV2IntentionClassification(
  id: string,
  patch: {
    type?: TrankilIntentType;
    title?: string;
    category_id?: string | null;
    status?: TrankilIntentStatus;
    is_organized?: number;
    is_local_processed?: number;
  },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE id = ?`,
    [id],
  );
  if (!current) return;
  const nextCategory = patch.category_id ?? current.category_id;
  const nextOrganized = patch.is_organized ?? current.is_organized;
  await db.runAsync(
    `UPDATE intentions
     SET type = ?,
         title = ?,
         category_id = ?,
         category = ?,
         status = ?,
         is_organized = ?,
         is_local_processed = ?
     WHERE id = ?`,
    [
      patch.type ?? current.type,
      patch.title ?? current.title,
      nextCategory,
      nextCategory,
      patch.status ?? current.status,
      nextOrganized,
      patch.is_local_processed ?? current.is_local_processed,
      id,
    ],
  );
  if (nextOrganized === 1 && current.is_organized !== 1) {
    await db.runAsync(`UPDATE user_stats SET zen_points = zen_points + 0 WHERE id = 1`);
  }
  const nextStatus = patch.status ?? current.status;
  const nextType = patch.type ?? current.type;
  if (current.status !== 'DONE' && nextStatus === 'DONE' && (nextType === 'TASK' || nextType === 'HABIT')) {
    void insertUserActivityLog({
      action_type: nextType === 'TASK' ? 'TASK_DONE' : 'HABIT_DONE',
      points_delta: 0,
      meta_json: JSON.stringify({ intention_id: id, source: 'updateTrankilV2IntentionClassification' }),
    }).catch(() => undefined);
  }
  await db.runAsync(
    `UPDATE intentions SET
       is_done = CASE WHEN status = 'DONE' THEN 1 ELSE 0 END,
       is_archived = CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END
     WHERE id = ?`,
    [id],
  );
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions SET done_at = ? WHERE id = ? AND status = 'DONE' AND done_at IS NULL`,
    [now, id],
  );
  await db.runAsync(`UPDATE intentions SET done_at = NULL WHERE id = ? AND status != 'DONE'`, [id]);
  await db.runAsync(
    `UPDATE intentions SET archived_at = ? WHERE id = ? AND status = 'ARCHIVED' AND archived_at IS NULL`,
    [now, id],
  );
  await db.runAsync(`UPDATE intentions SET archived_at = NULL WHERE id = ? AND status != 'ARCHIVED'`, [id]);
}

export async function getTrankilV2UnorganizedCount(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM intentions
     WHERE status = 'TODO'
       AND COALESCE(is_archived, 0) = 0
       AND is_organized = 0
       AND (category_id IS NULL OR trim(category_id) = '')
       AND (due_date IS NULL OR trim(due_date) = '')`,
  );
  return Number(row?.total ?? 0);
}

/** Tâches / habitudes racine dont l’échéance correspond au jour local (YYYY-MM-DD ou YYYYMMDD). */
export async function countTrankilV2RootTodoTasksDueOnLocalDate(ymdHyphen: string): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const ymd = String(ymdHyphen || '').trim();
  if (!ymd) return 0;
  const compact = ymd.replace(/-/g, '');
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM intentions i
     WHERE i.status = 'TODO'
       AND COALESCE(i.is_archived, 0) = 0
       AND i.type IN ('TASK', 'HABIT')
       AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
       AND (
         trim(coalesce(i.due_date, '')) = ?
         OR replace(trim(coalesce(i.due_date, '')), '-', '') = ?
       )`,
    [ymd, compact],
  );
  return Number(row?.total ?? 0);
}

export async function getLocalEcoScore(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM intentions WHERE is_local_processed = 1`,
  );
  return Number(row?.total ?? 0);
}

export async function deleteTrankilV2IntentionById(id: string): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(`DELETE FROM intentions WHERE id = ?`, [id]);
  await syncAfterIntentionWrite('deleteTrankilV2IntentionById');
  notifyIntentionsChanged({ id, reason: 'delete' });
}

export async function getTrankilV2IntentionById(id: string): Promise<TrankilV2IntentionRow | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  return (
    (await db.getFirstAsync<TrankilV2IntentionRow>(`SELECT * FROM intentions WHERE id = ? LIMIT 1`, [id])) ??
    null
  );
}

export async function updateTrankilV2IntentionPendingAiFlag(id: string, is_pending_ai: number): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(`UPDATE intentions SET is_pending_ai = ? WHERE id = ?`, [is_pending_ai ? 1 : 0, id]);
  await syncAfterIntentionWrite('updateTrankilV2IntentionPendingAiFlag');
  notifyIntentionsChanged({ id, reason: 'pending_ai_flag' });
}

/** Finalise une coquille NOTE → HABIT après succès IA (offline-first). */
export async function finalizeOfflineFirstHabitFromShell(
  id: string,
  fields: {
    title: string;
    due_date: string | null;
    metadata_json: string;
    suggested_tags: string;
    category_id: string;
  },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(
    `UPDATE intentions SET
       type = 'HABIT',
       title = ?,
       due_date = ?,
       category_id = ?,
       category = ?,
       metadata_json = ?,
       suggested_tags = ?,
       is_pending_ai = 0,
       is_local_processed = 1,
       complexity_level = 1
     WHERE id = ?`,
    [
      fields.title,
      normalizeDueDate(fields.due_date),
      fields.category_id,
      fields.category_id,
      fields.metadata_json,
      fields.suggested_tags,
      id,
    ],
  );
  await syncAfterIntentionWrite('finalizeOfflineFirstHabitFromShell');
  notifyIntentionsChanged({ id, reason: 'offline_first_habit' });
}

export async function updateTrankilV2IntentionMetadataJson(
  id: string,
  metadata_json: string,
  opts?: { silent?: boolean },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(`UPDATE intentions SET metadata_json = ? WHERE id = ?`, [metadata_json, id]);
  if (opts?.silent) return;
  await syncAfterIntentionWrite('updateTrankilV2IntentionMetadataJson');
  notifyIntentionsChanged({ id, reason: 'metadata' });
}

export async function countOfflineFirstAiPendingNotes(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions
     WHERE type IN ('NOTE', 'AUDIO')
       AND status = 'TODO'
       AND COALESCE(is_archived, 0) = 0
       AND COALESCE(is_pending_ai, 0) = 1`,
  );
  return Number(row?.n ?? 0);
}

export async function updateTrankilV2IntentionCalendarSync(
  id: string,
  patch: {
    calendar_event_id?: string | null;
    calendar_name?: string | null;
    is_synced_calendar?: number;
  },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2IntentionById(id);
  if (!current) return;
  await db.runAsync(
    `UPDATE intentions
     SET calendar_event_id = ?,
         calendar_name = ?,
         is_synced_calendar = ?
     WHERE id = ?`,
    [
      patch.calendar_event_id ?? current.calendar_event_id ?? null,
      patch.calendar_name ?? current.calendar_name ?? null,
      patch.is_synced_calendar ?? current.is_synced_calendar ?? 0,
      id,
    ],
  );
}

export async function updateTrankilV2IntentionAlarmFields(
  id: string,
  patch: {
    alarm_enabled?: number;
    remind_at?: number | null;
    local_notification_id?: string | null;
    recurrence_rrule?: string | null;
  },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2IntentionById(id);
  if (!current) return;
  await db.runAsync(
    `UPDATE intentions
     SET alarm_enabled = ?,
         remind_at = ?,
         local_notification_id = ?,
         recurrence_rrule = ?
     WHERE id = ?`,
    [
      patch.alarm_enabled ?? current.alarm_enabled ?? 0,
      patch.remind_at === undefined ? current.remind_at ?? null : patch.remind_at,
      patch.local_notification_id === undefined
        ? current.local_notification_id ?? null
        : patch.local_notification_id,
      patch.recurrence_rrule === undefined
        ? current.recurrence_rrule ?? null
        : patch.recurrence_rrule,
      id,
    ],
  );
}

export async function listTrankilV2PendingAlarmIntentions(
  nowMs: number = Date.now(),
): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions
     WHERE status = 'TODO'
       AND alarm_enabled = 1
       AND (
         (remind_at IS NOT NULL AND remind_at > ?)
         OR recurrence_rrule IS NOT NULL
       )
     ORDER BY COALESCE(remind_at, created_at) ASC`,
    [nowMs],
  );
}

export async function markTrankilV2IntentionDone(id: string): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ type: TrankilIntentType; status: TrankilIntentStatus }>(
    `SELECT type, status FROM intentions WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row || row.status !== 'TODO') return;
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions SET status = 'DONE', is_done = 1, done_at = ? WHERE id = ?`,
    [now, id],
  );
  if (row.type === 'TASK' || row.type === 'HABIT') {
    void insertUserActivityLog({
      action_type: row.type === 'TASK' ? 'TASK_DONE' : 'HABIT_DONE',
      points_delta: 0,
      meta_json: JSON.stringify({ intention_id: id }),
    }).catch(() => undefined);
  }
  await syncAfterIntentionWrite('markTrankilV2IntentionDone');
  notifyIntentionsChanged({ id, reason: 'mark_done' });
}

/** Bascule TODO ⟷ DONE (hors archives), avec horodatage `done_at`. */
export async function toggleIntentionDone(id: string): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ type: TrankilIntentType; status: TrankilIntentStatus }>(
    `SELECT type, status FROM intentions WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row || row.status === 'ARCHIVED') return;
  const now = Date.now();
  if (row.status === 'DONE') {
    await db.runAsync(
      `UPDATE intentions SET status = 'TODO', is_done = 0, done_at = NULL WHERE id = ?`,
      [id],
    );
  } else {
    await db.runAsync(
      `UPDATE intentions SET status = 'DONE', is_done = 1, done_at = ? WHERE id = ?`,
      [now, id],
    );
    if (row.type === 'TASK' || row.type === 'HABIT') {
      void insertUserActivityLog({
        action_type: row.type === 'TASK' ? 'TASK_DONE' : 'HABIT_DONE',
        points_delta: 0,
        meta_json: JSON.stringify({ intention_id: id, source: 'toggleIntentionDone' }),
      }).catch(() => undefined);
    }
  }
  await syncAfterIntentionWrite('toggleIntentionDone');
  notifyIntentionsChanged({ id, reason: 'toggle_done' });
}

export async function updateTrankilV2IntentionArchiveState(
  id: string,
  archived: boolean,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const now = Date.now();
  if (archived) {
    await db.runAsync(
      `UPDATE intentions
       SET status = 'ARCHIVED',
           is_organized = 1,
           is_archived = 1,
           archived_at = COALESCE(archived_at, ?)
       WHERE id = ?`,
      [now, id],
    );
  } else {
    await db.runAsync(
      `UPDATE intentions
       SET status = 'TODO',
           is_organized = 0,
           is_archived = 0,
           archived_at = NULL
       WHERE id = ?`,
      [id],
    );
  }
  await syncAfterIntentionWrite('updateTrankilV2IntentionArchiveState');
  notifyIntentionsChanged({ id, reason: 'archive_state' });
}

/** Archive l’intention (alias menu — voir {@link updateTrankilV2IntentionArchiveState}). */
export async function archiveIntention(id: string): Promise<void> {
  await updateTrankilV2IntentionArchiveState(id, true);
}

export async function pickAvailabilityTask(): Promise<TrankilV2IntentionRow | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions
     WHERE status = 'TODO'
       AND type = 'TASK'
       AND (
         LOWER(title) LIKE '%2 min%'
         OR LOWER(metadata_json) LIKE '%2 min%'
         OR LOWER(metadata_json) LIKE '%simple_task%'
       )
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  if (row) return row;
  return db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions
     WHERE status = 'TODO'
       AND type = 'TASK'
     ORDER BY created_at ASC
     LIMIT 1`,
  );
}

export async function applyAvailabilityReward(): Promise<{
  ia_credits: number;
  zen_points: number;
  rewardType: 'rescue_credit' | 'zen_points';
}> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  if (current.ia_credits <= 0) {
    const nextCredits = current.ia_credits + 2;
  await db.runAsync(`UPDATE user_stats SET ia_credits = ? WHERE id = 1`, [nextCredits]);
    return {
      ia_credits: nextCredits,
      zen_points: current.zen_points,
      rewardType: 'rescue_credit',
    };
  }
  const nextPoints = current.zen_points + 5;
  await db.runAsync(`UPDATE user_stats SET zen_points = ?, growth_score = ? WHERE id = 1`, [
    nextPoints,
    nextPoints,
  ]);
  return {
    ia_credits: current.ia_credits,
    zen_points: nextPoints,
    rewardType: 'zen_points',
  };
}

const GROWTH_MIN = 0;
const GROWTH_MAX = 999999;

export function growthPointsForType(type: TrankilIntentType): number {
  if (type === 'HABIT') return 5;
  if (type === 'PROJECT') return 15;
  if (type === 'TASK') return 2;
  if (type === 'LIST') return 0;
  return 0;
}

export async function applyGrowthDecayIfNeeded(
  nowMs: number = Date.now(),
): Promise<TrankilV2UserStatsRow> {
  void nowMs;
  return getTrankilV2UserStats();
}

export async function updateGrowth(points: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const decayed = await applyGrowthDecayIfNeeded();
  const safePoints = Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0;
  const nextScore = Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, decayed.growth_score + safePoints));
  await db.runAsync(
    `UPDATE user_stats SET zen_points = ?, growth_score = ? WHERE id = 1`,
    [nextScore, nextScore],
  );
  if (safePoints > 0) {
    void insertUserActivityLog({
      action_type: 'ZEN_GAIN',
      points_delta: safePoints,
      meta_json: JSON.stringify({ source: 'updateGrowth' }),
    }).catch(() => undefined);
  }
  return { ...decayed, zen_points: nextScore, growth_score: nextScore };
}

export async function adjustZenPoints(delta: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const safeDelta = Number.isFinite(delta) ? Math.round(delta) : 0;
  const nextScore = Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, current.growth_score + safeDelta));
  await db.runAsync(
    `UPDATE user_stats SET zen_points = ?, growth_score = ? WHERE id = 1`,
    [nextScore, nextScore],
  );
  if (safeDelta > 0) {
    void insertUserActivityLog({
      action_type: 'ZEN_GAIN',
      points_delta: safeDelta,
      meta_json: JSON.stringify({ source: 'adjustZenPoints' }),
    }).catch(() => undefined);
  }
  return { ...current, zen_points: nextScore, growth_score: nextScore };
}

function localDayKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function insertUserActivityLog(input: {
  id?: string;
  created_at?: number;
  day_key?: string;
  action_type: UserActivityLogActionType;
  points_delta: number;
  meta_json?: string;
}): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const createdAt = Number.isFinite(input.created_at) ? Number(input.created_at) : Date.now();
  const dayKey = String(input.day_key || localDayKeyFromMs(createdAt)).trim();
  const pointsDelta = Number.isFinite(input.points_delta) ? Math.round(input.points_delta) : 0;
  const id =
    String(input.id || '').trim() ||
    `ual_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    `INSERT INTO user_activity_logs (
      id, created_at, day_key, action_type, points_delta, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, createdAt, dayKey, input.action_type, pointsDelta, input.meta_json ?? '{}'],
  );
}

export async function getDailyActivityStatsSeries(daysCount: number): Promise<
  Array<{ day_key: string; action_type: string; points_total: number; actions_count: number }>
> {
  await initTrankilV2Schema();
  const db = await getDb();
  const safeDays = Number.isFinite(daysCount) ? Math.max(1, Math.round(daysCount)) : 30;
  return db.getAllAsync<{
    day_key: string;
    action_type: string;
    points_total: number;
    actions_count: number;
  }>(
    `SELECT
       day_key,
       action_type,
       SUM(points_delta) AS points_total,
       COUNT(*) AS actions_count
     FROM user_activity_logs
     WHERE day_key >= date('now', 'localtime', ?)
     GROUP BY day_key, action_type
     ORDER BY day_key ASC, action_type ASC`,
    [`-${safeDays - 1} day`],
  );
}

export async function spendZenPoints(cost: number): Promise<{
  ok: boolean;
  stats: TrankilV2UserStatsRow;
}> {
  await initTrankilV2Schema();
  const current = await getTrankilV2UserStats();
  const safeCost = Number.isFinite(cost) ? Math.max(0, Math.round(cost)) : 0;
  if (current.growth_score < safeCost) {
    return { ok: false, stats: current };
  }
  const next = await adjustZenPoints(-safeCost);
  return { ok: true, stats: next };
}

export async function setMorningFocusSelection(
  itemId: string,
  dateKey: string,
): Promise<void> {
  void itemId;
  void dateKey;
}

export async function setEveningRitualDateKey(dateKey: string): Promise<void> {
  void dateKey;
}

export async function setLocalActionStreak(value: number): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(`UPDATE user_stats SET local_action_streak = ? WHERE id = 1`, [
    Math.max(0, Math.round(value)),
  ]);
}

export async function incrementLocalActionStreak(): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const next = current.local_action_streak + 1;
  await db.runAsync(`UPDATE user_stats SET local_action_streak = ? WHERE id = 1`, [next]);
  return { ...current, local_action_streak: next };
}

export async function addMagicShakePasses(count: number): Promise<TrankilV2UserStatsRow> {
  void count;
  return getTrankilV2UserStats();
}

export async function addPshittSprays(count: number): Promise<TrankilV2UserStatsRow> {
  void count;
  return getTrankilV2UserStats();
}

export async function logBonusEvent(
  bonusType: BonusEventType,
  isAccepted: boolean,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO bonus_events (bonus_type, is_accepted, triggered_at) VALUES (?, ?, ?)`,
    [bonusType, isAccepted ? 1 : 0, Date.now()],
  );
}

export async function setAdState(patch: {
  ia_credits?: number;
  ad_last_reward_at?: number | null;
}): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const next: TrankilV2UserStatsRow = {
    ...current,
    ia_credits: patch.ia_credits ?? current.ia_credits,
    zen_points: current.zen_points,
    growth_score: current.growth_score,
    ad_last_reward_at:
      patch.ad_last_reward_at === undefined
        ? current.ad_last_reward_at
        : patch.ad_last_reward_at,
    ad_videos_watched: current.ad_videos_watched,
    local_action_streak: current.local_action_streak,
  };
  await db.runAsync(
    `UPDATE user_stats SET ia_credits = ?, ad_last_reward_at = ? WHERE id = 1`,
    [
      next.ia_credits,
      next.ad_last_reward_at,
    ],
  );
  return next;
}

export async function incrementBehaviorScores(patch: {
  aestheticDelta?: number;
  utilityDelta?: number;
}): Promise<TrankilV2UserStatsRow> {
  void patch;
  return getTrankilV2UserStats();
}

export async function recordLocalAffinityEvent(isLocal: boolean): Promise<TrankilV2UserStatsRow> {
  void isLocal;
  return getTrankilV2UserStats();
}

export async function incrementAdVideosWatched(count: number = 1): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  const next = stats.ad_videos_watched + safe;
  await db.runAsync(`UPDATE user_stats SET ad_videos_watched = ? WHERE id = 1`, [next]);
  return { ...stats, ad_videos_watched: next };
}

export async function setDebugSpawnFlies(count: number): Promise<TrankilV2UserStatsRow> {
  void count;
  return getTrankilV2UserStats();
}

export async function saveEmergencyLog(
  errorMessage: string,
  stack: string,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const intentions = await db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE status = 'TODO' ORDER BY created_at DESC LIMIT 40`,
  );
  await db.runAsync(
    `INSERT INTO emergency_logs (id, error_message, stack, intentions_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      `emg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      errorMessage.slice(0, 400),
      (stack || '').slice(0, 2000),
      JSON.stringify(intentions),
      Date.now(),
    ],
  );
}

export async function addFlowerBoosts(points: number): Promise<TrankilV2UserStatsRow> {
  void points;
  return getTrankilV2UserStats();
}

export async function getEveningDoneSummaryToday(): Promise<{
  doneCount: number;
  victoryTitle: string | null;
}> {
  await initTrankilV2Schema();
  const db = await getDb();
  const countRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c
     FROM intentions
     WHERE status = 'DONE'
       AND date(datetime(created_at / 1000, 'unixepoch', 'localtime')) = date('now', 'localtime')`,
  );
  const victory = await db.getFirstAsync<{ title: string | null }>(
    `SELECT title
     FROM intentions
     WHERE status = 'DONE'
       AND date(datetime(created_at / 1000, 'unixepoch', 'localtime')) = date('now', 'localtime')
     ORDER BY CASE type
       WHEN 'PROJECT' THEN 3
       WHEN 'HABIT' THEN 2
       WHEN 'TASK' THEN 1
       ELSE 0
     END DESC, LENGTH(title) DESC
     LIMIT 1`,
  );
  return {
    doneCount: countRow?.c ?? 0,
    victoryTitle: victory?.title ?? null,
  };
}
