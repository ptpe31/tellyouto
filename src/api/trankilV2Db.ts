import * as SQLite from 'expo-sqlite';
import { DeviceEventEmitter } from 'react-native';

/**
 * Repository SQLite Trankil-v2 (`talkndone.db`) : schéma, écritures sérialisées, timeline, quotas, `patchMetadata`.
 * Voir `PROJECT_STATUS.md` §1.4 / §3.3.
 *
 * @module trankilV2Db
 */

import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { VERBOSE_DEBUG } from '../config/verboseDebug';
import { newUuidV4 } from '../utils/uuid';

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
  context_tag?: string | null;
  parent_id: string | null;
  zoom_parent_jalon_uid?: string | null;
  status: TrankilIntentStatus;
  is_organized: number;
  is_local_processed: number;
  complexity_level: number;
  created_at: number;
  updated_at: number;
  is_dirty: number;
  server_version: number;
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
  /** 0/1 — épinglé dans l’Espace Sacré (Cockpit). */
  is_pinned?: number;
  /** Lieu / adresse texte libre (nullable). */
  location_address?: string | null;
  ai_model_used?: string | null;
  ai_latency_ms?: number | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  tokens_total?: number | null;
  cost?: number | null;
  location_id?: string | null;
  transport_mode?: string | null;
};

export type TrankilV2TimelineItemRow = {
  id: string;
  type: TrankilIntentType;
  status: TrankilIntentStatus;
  due_date: string | null;
  created_at: number;
  updated_at?: number;
  is_dirty?: number;
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
  transport_mode?: string | null;
  remind_to_leave?: number;
  is_pinned?: number;
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
  | 'USER_EDIT'
  | 'SENTINEL_TRACE';

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

const DB_NAME = 'talkndone.db';
const DISABLE_TRANKIL_V2_PRAGMAS = true;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let currentDb: SQLite.SQLiteDatabase | null = null;
let pragmasApplied = false;
let schemaInitPromise: Promise<void> | null = null;
let schemaReady = false;
let bootstrapPromise: Promise<void> | null = null;

let sqliteQueueTail: Promise<unknown> = Promise.resolve();
let sqliteReentrantDepth = 0;
/** > 0 lorsqu’un `BEGIN` explicite est ouvert sur la connexion partagée (évite BEGIN imbriqué). */
let sqliteExplicitTransactionDepth = 0;
/** Profondeur des SAVEPOINT `patchMetadata` — noms uniques pour éviter collision en réentrance. */
let sqliteMetadataPatchSavepointDepth = 0;
/** > 0 pendant un `patchMetadata` avec BEGIN ouvert sur la connexion (réentrance sans SAVEPOINT). */
let sqliteMetadataPatchInProgress = 0;

async function runSerializedSqlite<T>(operation: () => Promise<T>): Promise<T> {
  if (sqliteReentrantDepth > 0) {
    sqliteReentrantDepth += 1;
    try {
      return await operation();
    } finally {
      sqliteReentrantDepth -= 1;
    }
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

function resetTrankilV2RuntimeState(): void {
  const stale = currentDb;
  currentDb = null;
  dbPromise = null;
  pragmasApplied = false;
  sqliteReentrantDepth = 0;
  sqliteExplicitTransactionDepth = 0;
  sqliteMetadataPatchSavepointDepth = 0;
  sqliteMetadataPatchInProgress = 0;
  // Ne pas réinitialiser schemaReady / schemaInitPromise : le schéma est sur disque,
  // un re-init complet pendant le retry provoque des DDL concurrents et prepareAsync reject.
  if (stale) {
    void stale.closeAsync().catch(() => {});
  }
}

/** Attend la fin de la file SQLite (lectures + écritures). */
export function waitForTrankilV2SqliteIdle(): Promise<void> {
  return sqliteQueueTail.then(() => undefined);
}

/** Barrière temporelle après écriture UI — laisse SQLite libérer ses locks natifs. */
export const SQLITE_UI_BARRIER_MS = 500;

export async function trankilV2SqliteBarrier(ms: number = SQLITE_UI_BARRIER_MS): Promise<void> {
  await waitForTrankilV2SqliteIdle();
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isNativePrepareAsyncRejected(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('NativeDatabase.prepareAsync') || msg.includes('NullPointerException');
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
      upper(trim(coalesce(${alias}.category_id, ''))) IN ('HOME','PERSO','FAMILLE','HEALTH','SHOP')
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%maison%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%home%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%famille%'
      OR lower(trim(coalesce(${alias}.category_id, ''))) IN ('sans_pression','aujourdhui','demain','cette_semaine','regulier','zen')
    )`;
  }
  if (context === 'WORK') {
    return ` AND (
      upper(trim(coalesce(${alias}.category_id, ''))) IN ('WORK','PRO','FINANCE')
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%travail%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%work%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%pro%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%finance%'
      OR lower(coalesce(${alias}.category_id, '')) LIKE '%projets%'
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
      if (VERBOSE_DEBUG) console.log('[SQL_TRACE] 🏁 openDatabaseAsync terminé');
      if (!DISABLE_TRANKIL_V2_PRAGMAS && !pragmasApplied) {
        try {
          await db.execAsync('PRAGMA journal_mode=WAL;');
          await db.execAsync('PRAGMA busy_timeout=8000;');
        } catch {
          /* ignore */
        }
        pragmasApplied = true;
      }
      const anyDb = db as any;
      if (!anyDb.__trankilV2Serialized) {
        const wrap =
          <T extends (...args: any[]) => Promise<any>>(raw: T) =>
          (...args: Parameters<T>) =>
            runSerializedSqlite(() => raw(...args));
        anyDb.runAsync = wrap(db.runAsync.bind(db));
        anyDb.execAsync = wrap(db.execAsync.bind(db));
        if (typeof db.getFirstAsync === 'function') {
          anyDb.getFirstAsync = wrap(db.getFirstAsync.bind(db));
        }
        if (typeof db.getAllAsync === 'function') {
          anyDb.getAllAsync = wrap(db.getAllAsync.bind(db));
        }
        anyDb.__trankilV2Serialized = true;
      }
      currentDb = db;
      return db;
    });
  }
  return dbPromise;
}

/** Point d’entrée unique d’init : garantit `initTrankilV2Schema()` une fois par runtime. */
export async function bootstrapTrankilV2Database(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    await initTrankilV2Schema();
  })();
  return bootstrapPromise;
}

/**
 * Exécute `fn` dans une file **sérialisée** ; si `prepareAsync` rejette, rouvre la base et réessaie une fois.
 */
export async function withTrankilV2Database<T>(
  fn: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  return runSerializedSqlite(async () => {
    const db = await getDb();
    try {
      return await fn(db);
    } catch (e) {
      if (!isNativePrepareAsyncRejected(e)) throw e;
      console.log('[DATABASE] ♻️ Reset connexion SQLite (NativeDatabase.prepareAsync rejected)');
      resetTrankilV2RuntimeState();
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      const next = await getDb();
      return await fn(next);
    }
  });
}

function notifyIntentionsChanged(payload?: { id?: string; reason?: string }): void {
  DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME, { source: 'trankil_v2', ...payload });
}

async function syncAfterIntentionWrite(reason: string): Promise<void> {
  try {
    const { syncNativeRailAlarmsAfterIntentionWrite } = await import('./intentionHardwareSync');
    void syncNativeRailAlarmsAfterIntentionWrite(reason);
  } catch {
    /* ignore */
  }
}

/**
 * Crée / migre tables et index Trankil-v2 (PRAGMA foreign_keys, `intentions`, billing, etc.).
 * Inclut nativement `offline_audio_queue` et ses index (file offline-first ; plus de DDL dupliqué côté services).
 */
export async function initTrankilV2Schema(): Promise<void> {
  if (schemaReady) return;
  if (schemaInitPromise) return schemaInitPromise;
  schemaInitPromise = runSerializedSqlite(async () => {
    const db = await getDb();
    try {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    } catch {}
    const now = Date.now();

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY NOT NULL,
        formatted_address TEXT NOT NULL,
        place_id TEXT,
        lat REAL,
        lng REAL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_place_id ON locations (place_id);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_locations_updated_at ON locations (updated_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_locations_dirty_updated ON locations (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS location_anchors (
        anchor TEXT PRIMARY KEY NOT NULL,
        location_id TEXT,
        label TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_location_anchors_location_id ON location_anchors (location_id);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_location_anchors_dirty_updated ON location_anchors (is_dirty, updated_at DESC);`);

    await db.execAsync(`
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
        context_tag TEXT,
        parent_id TEXT,
        zoom_parent_jalon_uid TEXT,
        status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'DONE', 'ARCHIVED')),
        is_organized INTEGER NOT NULL DEFAULT 0 CHECK (is_organized IN (0, 1)),
        is_local_processed INTEGER NOT NULL DEFAULT 0 CHECK (is_local_processed IN (0, 1)),
        complexity_level INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0,
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
        cost REAL,
        debug_tokens INTEGER,
        debug_latency_ms INTEGER,
        location_id TEXT,
        transport_mode TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
        FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_type_status ON intentions (type, status);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_created_at ON intentions (created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_updated_at ON intentions (updated_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_dirty_updated ON intentions (is_dirty, updated_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_status_due_date_created_at ON intentions (status, due_date, created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_parent_id ON intentions (parent_id);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_location_id ON intentions (location_id);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_ai_model_used ON intentions (ai_model_used);`);

    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(intentions);`);
    const hasZoomUid = columns.some((c) => c.name === 'zoom_parent_jalon_uid');
    if (!hasZoomUid) {
      await db.execAsync(`ALTER TABLE intentions ADD COLUMN zoom_parent_jalon_uid TEXT;`);
    }
    const hasContextTag = columns.some((c) => c.name === 'context_tag');
    if (!hasContextTag) {
      await db.execAsync(`ALTER TABLE intentions ADD COLUMN context_tag TEXT;`);
    }
    const hasIsPinned = columns.some((c) => c.name === 'is_pinned');
    if (!hasIsPinned) {
      await db.execAsync(
        `ALTER TABLE intentions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1));`,
      );
    }
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_intentions_is_pinned ON intentions (is_pinned, updated_at DESC);`,
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_intentions_parent_zoom_uid_created_at ON intentions (parent_id, zoom_parent_jalon_uid, created_at);`,
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_intentions_parent_zoom_uid_status ON intentions (parent_id, zoom_parent_jalon_uid, status);`,
    );

    const toBackfill = await db.getAllAsync<{ id: string; metadata_json: string }>(
      `SELECT id, metadata_json
       FROM intentions
       WHERE (zoom_parent_jalon_uid IS NULL OR trim(zoom_parent_jalon_uid) = '')
         AND instr(metadata_json, '"zoom_parent_jalon_uid"') > 0
       LIMIT 2000`,
    );
    if (toBackfill.length) {
      sqliteExplicitTransactionDepth += 1;
      try {
        await db.execAsync('BEGIN;');
        try {
          for (const r of toBackfill) {
            const parsed = safeParseJsonRecord(r.metadata_json);
            const raw = parsed.zoom_parent_jalon_uid;
            const next = typeof raw === 'string' ? raw.trim() : '';
            if (!next) continue;
            await db.runAsync(`UPDATE intentions SET zoom_parent_jalon_uid = ? WHERE id = ?`, [next, r.id]);
          }
          await db.execAsync('COMMIT;');
        } catch (e) {
          try {
            await db.execAsync('ROLLBACK;');
          } catch {}
          throw e;
        }
      } finally {
        sqliteExplicitTransactionDepth -= 1;
      }
    }

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories (sort_order);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_categories_dirty_updated ON categories (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        firebase_uid TEXT,
        user_email TEXT,
        plan_type TEXT NOT NULL DEFAULT 'FREE',
        subscription_status TEXT NOT NULL DEFAULT 'INACTIVE',
        sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
        last_sync_at_ms INTEGER,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identity_firebase_uid ON user_identity (firebase_uid);`);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identity_user_email ON user_identity (user_email);`);
    await db.runAsync(`INSERT OR IGNORE INTO user_identity (id, updated_at, is_dirty, server_version) VALUES (1, ?, 0, 0);`, [
      now,
    ]);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_billing_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        plan_type TEXT NOT NULL DEFAULT 'FREE',
        daily_intentions_limit INTEGER NOT NULL DEFAULT 0,
        current_day_intentions_count INTEGER NOT NULL DEFAULT 0,
        daily_notes_limit INTEGER NOT NULL DEFAULT 0,
        current_day_notes_count INTEGER NOT NULL DEFAULT 0,
        trip_credits_balance INTEGER NOT NULL DEFAULT 0,
        feature_flags_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.runAsync(`INSERT OR IGNORE INTO user_billing_state (id, updated_at, is_dirty, server_version) VALUES (1, ?, 0, 0);`, [
      now,
    ]);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_stats (
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
        free_capture_remaining INTEGER NOT NULL DEFAULT 3,
        list_free_day_ymd TEXT,
        list_free_remaining INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.runAsync(`INSERT OR IGNORE INTO user_stats (id, updated_at, is_dirty, server_version) VALUES (1, ?, 0, 0);`, [
      now,
    ]);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_knowledge (
        key TEXT PRIMARY KEY NOT NULL,
        value_text TEXT NOT NULL DEFAULT '',
        value_json TEXT NOT NULL DEFAULT '{}',
        namespace TEXT NOT NULL DEFAULT 'USER' CHECK (namespace IN ('USER', 'IA')),
        confidence_score REAL NOT NULL DEFAULT 0.0 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_knowledge_namespace ON user_knowledge (namespace);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_knowledge_updated_at ON user_knowledge (updated_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_knowledge_dirty_updated ON user_knowledge (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_context (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_context_dirty_updated ON user_context (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS bonus_events (
        id TEXT PRIMARY KEY NOT NULL,
        bonus_type TEXT NOT NULL,
        is_accepted INTEGER NOT NULL DEFAULT 0 CHECK (is_accepted IN (0, 1)),
        triggered_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_bonus_events_triggered_at ON bonus_events (triggered_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_bonus_events_dirty_updated ON bonus_events (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS emergency_logs (
        id TEXT PRIMARY KEY NOT NULL,
        error_message TEXT NOT NULL,
        stack TEXT NOT NULL DEFAULT '',
        intentions_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_emergency_logs_created_at ON emergency_logs (created_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_activity_logs (
        id TEXT PRIMARY KEY NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0,
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
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_day_key ON user_activity_logs (day_key);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_action_day ON user_activity_logs (action_type, day_key);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs (created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_intention_id ON user_activity_logs (intention_id);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_user_activity_logs_request_id ON user_activity_logs (request_id);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sentinel_trips (
        id TEXT PRIMARY KEY NOT NULL,
        destination TEXT NOT NULL,
        arrival_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        sentinel_mode TEXT NOT NULL DEFAULT 'SENTINEL',
        target_duration_sec INTEGER NOT NULL DEFAULT 0,
        last_traffic_duration INTEGER NOT NULL DEFAULT 0,
        internal_scan_count INTEGER NOT NULL DEFAULT 0,
        next_check_at INTEGER,
        gate_prompted_at INTEGER,
        last_error_at INTEGER,
        t_optimiste_ms INTEGER,
        t_pessimiste_ms INTEGER,
        vigilance_status TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_sentinel_trips_status ON sentinel_trips (status);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_sentinel_trips_dirty_updated ON sentinel_trips (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS location_favorites (
        alias TEXT PRIMARY KEY NOT NULL,
        formatted_address TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_location_favorites_dirty_updated ON location_favorites (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS offline_audio_queue (
        id TEXT PRIMARY KEY NOT NULL,
        intention_id TEXT NOT NULL,
        transcript TEXT NOT NULL,
        audio_path TEXT NOT NULL,
        title TEXT NOT NULL,
        speech_lang TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        is_pending_ai INTEGER NOT NULL DEFAULT 1 CHECK (is_pending_ai IN (0, 1)),
        created_at INTEGER NOT NULL,
        notified_at INTEGER,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_offline_audio_queue_status ON offline_audio_queue (status, created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_offline_audio_queue_dirty_updated ON offline_audio_queue (is_dirty, updated_at DESC);`);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        id TEXT PRIMARY KEY NOT NULL,
        summary_date TEXT NOT NULL,
        content_html TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_daily_summaries_summary_date ON daily_summaries (summary_date DESC, created_at DESC);`,
    );

    for (const category of DEFAULT_HORIZON_CATEGORIES) {
      await db.runAsync(`INSERT OR IGNORE INTO categories (id, label, sort_order, updated_at, is_dirty, server_version) VALUES (?, ?, ?, ?, 0, 0)`, [
        category.id,
        category.label,
        category.sort_order,
        now,
      ]);
    }

    const testId = `system_ready_${Date.now()}`;
    await db.runAsync(`INSERT OR REPLACE INTO intentions (id, type, title, created_at, updated_at) VALUES (?, 'NOTE', 'System Ready', ?, ?)`, [
      testId,
      now,
      now,
    ]);
    const check = await db.getFirstAsync<{ title: string }>(`SELECT title FROM intentions WHERE id = ? LIMIT 1`, [
      testId,
    ]);
    if (check?.title === 'System Ready' && VERBOSE_DEBUG) console.log('[DATABASE] ✨ Base de données reconstruite et fonctionnelle.');

    schemaReady = true;
  });
  await schemaInitPromise;
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
  const reserved = `AND i.title != 'System Ready'`;
  await initTrankilV2Schema();
  const db = await getDb();
  const inner = `
    SELECT id, type, status, due_date, created_at, updated_at, is_dirty, content_raw, parent_id, project_title, display_title, section, is_synced_calendar, category_id, suggested_tags, metadata_json, is_pending_ai, transport_mode, remind_to_leave
    FROM (
      SELECT
        i.id AS id,
        i.type AS type,
        i.status AS status,
        i.due_date AS due_date,
        i.created_at AS created_at,
        i.updated_at AS updated_at,
        i.is_dirty AS is_dirty,
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
        i.transport_mode AS transport_mode,
        COALESCE(i.remind_to_leave, 0) AS remind_to_leave,
        i.due_date AS effective_date,
        1 AS section_order
      FROM intentions i
      WHERE i.status = ?
        AND COALESCE(i.is_archived, 0) = 0
        AND i.type IN ('TASK', 'HABIT')
        AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
        ${reserved}
        ${ctx}

      UNION ALL

      SELECT
        i.id AS id,
        i.type AS type,
        i.status AS status,
        i.due_date AS due_date,
        i.created_at AS created_at,
        i.updated_at AS updated_at,
        i.is_dirty AS is_dirty,
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
        i.transport_mode AS transport_mode,
        COALESCE(i.remind_to_leave, 0) AS remind_to_leave,
        i.due_date AS effective_date,
        2 AS section_order
      FROM intentions i
      LEFT JOIN intentions p ON p.id = i.parent_id AND p.type = 'PROJECT'
      WHERE i.status = ?
        AND COALESCE(i.is_archived, 0) = 0
        AND i.type = 'TASK'
        AND i.parent_id IS NOT NULL
        AND trim(i.parent_id) != ''
        ${reserved}
        ${ctx}

      UNION ALL

      SELECT
        i.id AS id,
        i.type AS type,
        i.status AS status,
        i.due_date AS due_date,
        i.created_at AS created_at,
        i.updated_at AS updated_at,
        i.is_dirty AS is_dirty,
        i.content_raw AS content_raw,
        i.parent_id AS parent_id,
        NULL AS project_title,
        i.title AS display_title,
        CASE WHEN i.type IN ('LIST', 'PROJECT') THEN 'LIST_CARD' ELSE 'NOTE_AUDIO' END AS section,
        COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
        i.category_id AS category_id,
        i.suggested_tags AS suggested_tags,
        i.metadata_json AS metadata_json,
        COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
        i.transport_mode AS transport_mode,
        COALESCE(i.remind_to_leave, 0) AS remind_to_leave,
        COALESCE(i.due_date, date(datetime(i.created_at / 1000, 'unixepoch', 'localtime'))) AS effective_date,
        3 AS section_order
      FROM intentions i
      WHERE i.status = ?
        AND COALESCE(i.is_archived, 0) = 0
        AND i.type IN ('NOTE', 'AUDIO', 'LIST', 'PROJECT')
        ${reserved}
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
    ORDER BY
      section_order ASC,
      (due_date IS NULL) ASC,
      due_date ASC,
      created_at DESC`;
  const baseParams = [status, status, status, mode, selectedDateYmd, mode, selectedDateYmd, selectedDateYmd];
  const { sql, params } = appendTimelinePaging(inner, baseParams, opts?.paging);
  return db.getAllAsync<TrankilV2TimelineItemRow>(sql, params);
}

/**
 * Feuille de route « Aujourd’hui » : items traités (échéance du jour ou épinglé), hors Inbox brut.
 */
export async function listTrankilV2MergedTodayTimelineWithLowPressure(
  selectedDateYmd: string,
  status: TrankilIntentStatus,
  context: TimelineSqlContext,
  paging: TimelinePaging,
): Promise<TrankilV2TimelineItemRow[]> {
  const ctx = timelineContextWhere(context);
  const reserved = `AND i.title != 'System Ready'`;
  const ymdCompact = selectedDateYmd.replace(/-/g, '');
  const lim = Math.max(1, Math.min(500, Math.floor(Number(paging.limit ?? TIMELINE_PAGE_SIZE))));
  const off = Math.max(0, Math.floor(Number(paging.offset ?? 0)));
  const execParams = [selectedDateYmd, ymdCompact, selectedDateYmd] as const;
  await initTrankilV2Schema();
  const db = await getDb();
  const roadmap = intentionExecutionRoadmapSql(selectedDateYmd);
  const sql = `
WITH dated AS (
  SELECT * FROM (
    SELECT
      i.id AS id,
      i.type AS type,
      i.status AS status,
      i.due_date AS due_date,
      i.created_at AS created_at,
      i.updated_at AS updated_at,
      i.is_dirty AS is_dirty,
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
      i.transport_mode AS transport_mode,
      COALESCE(i.remind_to_leave, 0) AS remind_to_leave,
      COALESCE(i.is_pinned, 0) AS is_pinned,
      CASE
        WHEN COALESCE(i.is_pinned, 0) = 1 AND (i.due_date IS NULL OR trim(i.due_date) = '') THEN ?
        ELSE substr(trim(COALESCE(i.due_date, '')), 1, 10)
      END AS effective_date,
      1 AS section_order
    FROM intentions i
    WHERE i.status = ?
      AND COALESCE(i.is_archived, 0) = 0
      AND i.type IN ('TASK', 'HABIT')
      AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
      ${reserved}
      ${ctx}
      ${roadmap}
    UNION ALL
    SELECT
      i.id AS id,
      i.type AS type,
      i.status AS status,
      i.due_date AS due_date,
      i.created_at AS created_at,
      i.updated_at AS updated_at,
      i.is_dirty AS is_dirty,
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
      i.transport_mode AS transport_mode,
      COALESCE(i.remind_to_leave, 0) AS remind_to_leave,
      COALESCE(i.is_pinned, 0) AS is_pinned,
      CASE
        WHEN COALESCE(i.is_pinned, 0) = 1 AND (i.due_date IS NULL OR trim(i.due_date) = '') THEN ?
        ELSE substr(trim(COALESCE(i.due_date, '')), 1, 10)
      END AS effective_date,
      2 AS section_order
    FROM intentions i
    LEFT JOIN intentions p ON p.id = i.parent_id AND p.type = 'PROJECT'
    WHERE i.status = ?
      AND COALESCE(i.is_archived, 0) = 0
      AND i.type = 'TASK'
      AND i.parent_id IS NOT NULL
      AND trim(i.parent_id) != ''
      ${reserved}
      ${ctx}
      ${roadmap}
    UNION ALL
    SELECT
      i.id AS id,
      i.type AS type,
      i.status AS status,
      i.due_date AS due_date,
      i.created_at AS created_at,
      i.updated_at AS updated_at,
      i.is_dirty AS is_dirty,
      i.content_raw AS content_raw,
      i.parent_id AS parent_id,
      NULL AS project_title,
      i.title AS display_title,
      CASE WHEN i.type IN ('LIST', 'PROJECT') THEN 'LIST_CARD' ELSE 'NOTE_AUDIO' END AS section,
      COALESCE(i.is_synced_calendar, 0) AS is_synced_calendar,
      i.category_id AS category_id,
      i.suggested_tags AS suggested_tags,
      i.metadata_json AS metadata_json,
      COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
      i.transport_mode AS transport_mode,
      COALESCE(i.remind_to_leave, 0) AS remind_to_leave,
      COALESCE(i.is_pinned, 0) AS is_pinned,
      CASE
        WHEN COALESCE(i.is_pinned, 0) = 1 AND (i.due_date IS NULL OR trim(i.due_date) = '') THEN ?
        ELSE substr(trim(COALESCE(i.due_date, '')), 1, 10)
      END AS effective_date,
      3 AS section_order
    FROM intentions i
    WHERE i.status = ?
      AND COALESCE(i.is_archived, 0) = 0
      AND i.type IN ('NOTE', 'AUDIO', 'LIST', 'PROJECT')
      ${reserved}
      ${ctx}
      ${roadmap}
  ) z
  WHERE z.effective_date = ?
)
SELECT id, type, status, due_date, created_at, updated_at, is_dirty, content_raw, parent_id, project_title, display_title, section, is_synced_calendar, category_id, suggested_tags, metadata_json, is_pending_ai, transport_mode, remind_to_leave, is_pinned
FROM dated u
ORDER BY u.section_order ASC,
  CASE WHEN u.type = 'HABIT' THEN 0 ELSE 1 END,
  CASE
    WHEN u.type = 'TASK' AND (
      (length(trim(u.due_date)) = 10 AND u.due_date = ?)
      OR (length(trim(u.due_date)) = 8 AND u.due_date = ?)
    ) THEN 0
    ELSE 1
  END,
  (u.due_date IS NULL) ASC,
  u.due_date ASC,
  u.created_at DESC
LIMIT ? OFFSET ?`;
  return db.getAllAsync<TrankilV2TimelineItemRow>(sql, [
    selectedDateYmd,
    status,
    ...execParams,
    selectedDateYmd,
    status,
    ...execParams,
    selectedDateYmd,
    status,
    ...execParams,
    selectedDateYmd,
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
       COALESCE(i.is_pending_ai, 0) AS is_pending_ai,
       i.transport_mode AS transport_mode,
       COALESCE(i.remind_to_leave, 0) AS remind_to_leave
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

export async function rebuildTrankilV2IntentionsTableForDebug(): Promise<void> {
  const db = await getDb();
  await db.execAsync('BEGIN;');
  try {
    await db.execAsync(`DROP TABLE IF EXISTS intentions;`);
    await db.execAsync(`CREATE TABLE IF NOT EXISTS intentions (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT,
      content_raw TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      suggested_tags TEXT NOT NULL DEFAULT '[]',
      category_id TEXT,
      category TEXT,
      context_tag TEXT,
      parent_id TEXT,
      zoom_parent_jalon_uid TEXT,
      status TEXT NOT NULL DEFAULT 'TODO',
      is_organized INTEGER NOT NULL DEFAULT 0,
      is_local_processed INTEGER NOT NULL DEFAULT 0,
      complexity_level INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      calendar_event_id TEXT,
      calendar_name TEXT,
      is_synced_calendar INTEGER NOT NULL DEFAULT 0,
      alarm_enabled INTEGER NOT NULL DEFAULT 0,
      remind_at INTEGER,
      local_notification_id TEXT,
      recurrence_rrule TEXT,
      is_done INTEGER NOT NULL DEFAULT 0,
      done_at INTEGER,
      is_archived INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      is_pending_ai INTEGER NOT NULL DEFAULT 0,
      remind_to_leave INTEGER NOT NULL DEFAULT 0,
      location_address TEXT,
      ai_model_used TEXT,
      ai_latency_ms INTEGER,
      tokens_prompt INTEGER,
      tokens_completion INTEGER,
      tokens_total INTEGER,
      debug_tokens INTEGER,
      debug_latency_ms INTEGER,
      location_id INTEGER
    );`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_created_at ON intentions (created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_intentions_type_status ON intentions (type, status);`);
    await db.execAsync('COMMIT;');
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK;');
    } catch {}
    throw e;
  }
  const testId = `system_ready_${Date.now()}`;
  await db.runAsync(`INSERT OR REPLACE INTO intentions (id, type, title, created_at) VALUES (?, 'NOTE', 'System Ready', ?)`, [
    testId,
    Date.now(),
  ]);
  const check = await db.getFirstAsync<{ title: string }>(`SELECT title FROM intentions WHERE id = ? LIMIT 1`, [testId]);
  if (check?.title === 'System Ready') console.log('[DATABASE] ✨ Base de données reconstruite et fonctionnelle.');
}

/** Habitudes actives avec signaux de récurrence (Living Hub JIT + vue Routines). */
export async function listActiveHabitsForHub(opts?: {
  context?: TimelineSqlContext;
}): Promise<TrankilV2IntentionRow[]> {
  const ctx = timelineContextWhere(opts?.context ?? 'ALL', 'intentions');
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions i
     WHERE ${ROUTINE_HABIT_WHERE}
       ${ctx}
     ORDER BY i.created_at DESC
     LIMIT 200`,
  );
}

/** Compte les routines actives (carrousel). */
export async function countRoutineHabits(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions i WHERE ${ROUTINE_HABIT_WHERE}`,
  );
  return Number(row?.n ?? 0);
}

/** Jours locaux (YYYY-MM-DD) où une habitude a été cochée « Fait ». */
export async function getHabitCompletionDayKeysByIntentionIds(
  intentionIds: string[],
): Promise<Map<string, string[]>> {
  const idSet = new Set(intentionIds.map((id) => String(id || '').trim()).filter(Boolean));
  if (idSet.size === 0) return new Map();
  await initTrankilV2Schema();
  const db = await getDb();
  const rows = await db.getAllAsync<{ day_key: string; meta_json: string }>(
    `SELECT day_key, meta_json FROM user_activity_logs
     WHERE action_type = 'HABIT_DONE'
     ORDER BY day_key DESC
     LIMIT 4000`,
  );
  const acc = new Map<string, Set<string>>();
  for (const row of rows) {
    let intentionId = '';
    try {
      const meta = JSON.parse(String(row.meta_json ?? '{}')) as { intention_id?: string };
      intentionId = String(meta.intention_id ?? '').trim();
    } catch {
      continue;
    }
    if (!intentionId || !idSet.has(intentionId)) continue;
    const set = acc.get(intentionId) ?? new Set<string>();
    set.add(String(row.day_key ?? '').trim());
    acc.set(intentionId, set);
  }
  const out = new Map<string, string[]>();
  for (const [id, days] of acc) {
    out.set(
      id,
      [...days].sort((a, b) => b.localeCompare(a)),
    );
  }
  return out;
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
       AND trim(title) != 'System Ready'
       AND id NOT LIKE 'system_ready_%'
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
    row.type === 'LIST' || row.type === 'PROJECT'
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
    updated_at: row.updated_at,
    is_dirty: row.is_dirty,
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
    transport_mode: row.transport_mode ?? null,
    remind_to_leave: row.remind_to_leave ?? 0,
    is_pinned: row.is_pinned ?? 0,
  };
}

/** Nombre d’intentions actuellement épinglées (`is_pinned = 1`, non archivées). */
export async function countTrankilV2PinnedIntentions(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions
     WHERE COALESCE(is_pinned, 0) = 1
       AND COALESCE(is_archived, 0) = 0
       AND status != 'ARCHIVED'`,
  );
  return Number(row?.n ?? 0);
}

/** Intentions épinglées pour l’Espace Sacré (tri récent → ancien). */
export async function listTrankilV2PinnedIntentions(limit = 8): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  const cap = Math.max(1, Math.min(32, Math.floor(limit)));
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions
     WHERE COALESCE(is_pinned, 0) = 1
       AND COALESCE(is_archived, 0) = 0
       AND status != 'ARCHIVED'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
    [cap],
  );
}

/** Épingle ou désépingle une intention (respecte le plafond côté UI). */
export async function updateTrankilV2IntentionPinnedState(id: string, isPinned: boolean): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions SET is_pinned = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`,
    [isPinned ? 1 : 0, now, id],
  );
  await syncAfterIntentionWrite('updateTrankilV2IntentionPinnedState');
  notifyIntentionsChanged({ id, reason: isPinned ? 'pin' : 'unpin' });
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
  plan_type: 'FREE' | 'PREMIUM';
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
    `SELECT plan_type, daily_intentions_limit, current_day_intentions_count, daily_notes_limit, current_day_notes_count, trip_credits_balance, feature_flags_json
     FROM user_billing_state
     WHERE id = 1`,
  );
  return (
    row ?? {
      plan_type: 'FREE',
      daily_intentions_limit: 0,
      current_day_intentions_count: 0,
      daily_notes_limit: 0,
      current_day_notes_count: 0,
      trip_credits_balance: 0,
      feature_flags_json: '{}',
    }
  );
}

export async function updateBillingState(
  patch: Partial<TrankilV2BillingStateRow>,
  opts?: { fromSync?: boolean; force_downgrade?: boolean },
): Promise<void> {
  await initTrankilV2Schema();
  await withTrankilV2Database(async (db) => {
    sqliteExplicitTransactionDepth += 1;
    try {
      await db.execAsync('BEGIN IMMEDIATE;');
      try {
        const cur = await db.getFirstAsync<{ plan_type: string }>(
          `SELECT plan_type FROM user_billing_state WHERE id = 1 LIMIT 1`,
        );
        const currentPlan = String(cur?.plan_type ?? 'FREE').toUpperCase();
        const requestedPlan = patch.plan_type ? String(patch.plan_type).toUpperCase() : currentPlan;
        const nextPlan =
          currentPlan === 'PREMIUM' && requestedPlan !== 'PREMIUM' && opts?.force_downgrade !== true
            ? 'PREMIUM'
            : requestedPlan === 'PREMIUM'
              ? 'PREMIUM'
              : 'FREE';
        const now = Date.now();
        const isDirty = opts?.fromSync ? 0 : 1;
        await db.runAsync(
          `UPDATE user_billing_state SET
             plan_type = ?,
             daily_intentions_limit = COALESCE(?, daily_intentions_limit),
             current_day_intentions_count = COALESCE(?, current_day_intentions_count),
             daily_notes_limit = COALESCE(?, daily_notes_limit),
             current_day_notes_count = COALESCE(?, current_day_notes_count),
             trip_credits_balance = COALESCE(?, trip_credits_balance),
             feature_flags_json = COALESCE(?, feature_flags_json),
             updated_at = ?,
             is_dirty = ?
           WHERE id = 1`,
          [
            nextPlan,
            patch.daily_intentions_limit ?? null,
            patch.current_day_intentions_count ?? null,
            patch.daily_notes_limit ?? null,
            patch.current_day_notes_count ?? null,
            patch.trip_credits_balance ?? null,
            patch.feature_flags_json ?? null,
            now,
            isDirty,
          ],
        );
        await db.execAsync('COMMIT;');
      } catch (e) {
        try {
          await db.execAsync('ROLLBACK;');
        } catch {}
        throw e;
      }
    } finally {
      sqliteExplicitTransactionDepth -= 1;
    }
  });
}

export type TrankilV2KnowledgeNamespace = 'USER' | 'IA';

export type TrankilV2KnowledgeRow = {
  key: string;
  value_text: string;
  value_json: string;
  namespace: TrankilV2KnowledgeNamespace;
  confidence_score: number;
  updated_at: number;
};

export async function getKnowledge(
  key: string,
): Promise<(TrankilV2KnowledgeRow & { value: unknown }) | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  const k = String(key || '').trim();
  if (!k) return null;
  const row = await db.getFirstAsync<TrankilV2KnowledgeRow>(
    `SELECT key, value_text, value_json, namespace, confidence_score, updated_at
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
  opts?: { namespace?: TrankilV2KnowledgeNamespace; confidence_score?: number; updated_at?: number; fromSync?: boolean },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const k = String(key || '').trim();
  if (!k) return;
  const updatedAt =
    Number.isFinite(opts?.updated_at as number) ? Number(opts?.updated_at) : Date.now();
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
    `INSERT OR REPLACE INTO user_knowledge (key, value_text, value_json, namespace, confidence_score, updated_at, is_dirty, server_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [k, valueText, valueJson, namespace, confidence, updatedAt, opts?.fromSync ? 0 : 1],
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
  const now = Date.now();
  await db.runAsync(
    `INSERT OR REPLACE INTO user_context (key, value_json, updated_at, is_dirty, server_version) VALUES (?, ?, ?, 1, 0)`,
    [k, json, now],
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
          growth_score = ?,
          updated_at = ?,
          is_dirty = 1
      WHERE id = 1`,
    [stats.zen_points + 10, stats.zen_points + 10, nowMs],
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
  const now = Date.now();
  await db.runAsync(
    `UPDATE user_stats SET ia_credits = ?, updated_at = ?, is_dirty = 1 WHERE id = 1`,
    [nextRemaining, now],
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
  const now = Date.now();
  await db.runAsync(`UPDATE user_stats SET ia_credits = ?, updated_at = ?, is_dirty = 1 WHERE id = 1`, [
    nextRemaining,
    now,
  ]);
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
  const now = Date.now();
  await db.runAsync(`UPDATE user_stats SET ia_credits = ?, updated_at = ?, is_dirty = 1 WHERE id = 1`, [next, now]);
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

function resolveLocalTodayYmd(ymd?: string): string {
  const raw = String(ymd ?? '').trim();
  if (raw) return raw;
  return formatYmdLocalForQuota(new Date());
}

const INTENTION_SYSTEM_RESERVED_SQL = `
  AND trim(i.title) != 'System Ready'
  AND i.id NOT LIKE 'system_ready_%'`;

const INTENTION_NO_DUE_DATE_SQL = `(i.due_date IS NULL OR trim(i.due_date) = '')`;

const INTENTION_CATEGORY_ID_NORM_SQL = `UPPER(trim(COALESCE(i.category_id, i.category, '')))`;

/** Catégorie domaine SHOP (équivalent `categoryTag = 'SHOP'` côté IA). */
const INTENTION_IS_SHOP_SQL = `${INTENTION_CATEGORY_ID_NORM_SQL} = 'SHOP'`;

const INTENTION_NOT_SHOP_SQL = `${INTENTION_CATEGORY_ID_NORM_SQL} != 'SHOP'`;

/** Item trié / planifié (hors sas Inbox brut du jour). */
const INTENTION_IS_PROCESSED_SQL = `(
  COALESCE(i.is_organized, 0) = 1
  OR COALESCE(i.is_pinned, 0) = 1
  OR (i.due_date IS NOT NULL AND trim(i.due_date) != '')
)`;

const INTENTION_CREATED_ON_LOCAL_YMD_SQL = `date(datetime(i.created_at / 1000, 'unixepoch', 'localtime')) = ?`;

/** Encore dans l'Inbox du jour : capturé aujourd'hui, sans échéance, non épinglé. */
const INTENTION_INBOX_ONLY_TODAY_SQL = `(
  ${INTENTION_CREATED_ON_LOCAL_YMD_SQL}
  AND (i.due_date IS NULL OR trim(i.due_date) = '')
  AND COALESCE(i.is_pinned, 0) = 0
)`;

function intentionDueOnLocalYmdSql(alias = 'i'): string {
  return `(
    substr(trim(COALESCE(${alias}.due_date, '')), 1, 10) = ?
    OR replace(substr(trim(COALESCE(${alias}.due_date, '')), 1, 10), '-', '') = ?
  )`;
}

/** Feuille de route : échéance du jour ou épinglé, et item traité (hors Inbox brut). */
function intentionExecutionRoadmapSql(selectedDateYmd: string): string {
  const ymdCompact = selectedDateYmd.replace(/-/g, '');
  return `
    AND (
      COALESCE(i.is_pinned, 0) = 1
      OR ${intentionDueOnLocalYmdSql('i')}
    )
    AND ${INTENTION_IS_PROCESSED_SQL}
    AND NOT ${INTENTION_INBOX_ONLY_TODAY_SQL}`;
}

const INTENTION_ACTIVE_TODO_SQL = `
  i.status = 'TODO'
  AND COALESCE(i.is_archived, 0) = 0`;

const INBOX_TODAY_WHERE = `
  ${INTENTION_ACTIVE_TODO_SQL}
  ${INTENTION_SYSTEM_RESERVED_SQL}
  AND ${INTENTION_CREATED_ON_LOCAL_YMD_SQL}
  AND NOT ${INTENTION_IS_PROCESSED_SQL}`;

/** Raccourci « À acheter » : toutes les intentions SHOP actives. */
const SHOP_SHORTCUT_WHERE = `
  ${INTENTION_ACTIVE_TODO_SQL}
  ${INTENTION_SYSTEM_RESERVED_SQL}
  AND ${INTENTION_IS_SHOP_SQL}`;

/** Raccourci « Listes » : toutes les intentions LIST actives. */
const LIST_SHORTCUT_WHERE = `
  i.type = 'LIST'
  AND COALESCE(i.is_archived, 0) = 0
  AND i.status != 'ARCHIVED'
  ${INTENTION_SYSTEM_RESERVED_SQL}`;

/** Stock « Box » : TODO sans date, hors Inbox du jour, hors SHOP et hors HABIT (param : ymd local). */
const BOX_STOCK_WHERE = `
  ${INTENTION_ACTIVE_TODO_SQL}
  ${INTENTION_SYSTEM_RESERVED_SQL}
  AND i.type != 'HABIT'
  AND (i.due_date IS NULL OR trim(i.due_date) = '')
  AND NOT (
    ${INTENTION_CREATED_ON_LOCAL_YMD_SQL}
    AND NOT ${INTENTION_IS_PROCESSED_SQL}
  )
  AND NOT ${INTENTION_IS_SHOP_SQL}`;

/** Routines actives : habitudes racine avec signaux de récurrence. */
const ROUTINE_HABIT_WHERE = `
  ${INTENTION_ACTIVE_TODO_SQL}
  ${INTENTION_SYSTEM_RESERVED_SQL}
  AND i.type = 'HABIT'
  AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
  AND (
    i.metadata_json LIKE '%recurrence_rule%'
    OR i.metadata_json LIKE '%cadenceDescription%'
    OR i.metadata_json LIKE '%preferredTimeHm%'
  )`;

/** @deprecated Alias — préférer {@link countInboxToday}. */
export async function countNewIntentionsToday(todayYmd?: string): Promise<number> {
  return countInboxToday(todayYmd);
}

/** Compte l'Inbox du jour (toutes captures d'aujourd'hui). */
export async function countInboxToday(todayYmd?: string): Promise<number> {
  const ymd = resolveLocalTodayYmd(todayYmd);
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions i WHERE ${INBOX_TODAY_WHERE}`,
    [ymd],
  );
  return Number(row?.n ?? 0);
}

/** @deprecated Alias — préférer {@link listTrankilV2InboxToday}. */
export async function listTrankilV2NewInboxToday(todayYmd?: string): Promise<TrankilV2IntentionRow[]> {
  return listTrankilV2InboxToday(todayYmd);
}

/** Inbox : captures du jour encore à trier (tri récent → ancien). */
export async function listTrankilV2InboxToday(todayYmd?: string): Promise<TrankilV2IntentionRow[]> {
  const ymd = resolveLocalTodayYmd(todayYmd);
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions i
     WHERE ${INBOX_TODAY_WHERE}
     ORDER BY i.created_at DESC`,
    [ymd],
  );
}

/** Retire une intention de l'Inbox (marquée triée / traitée, sans suppression). */
export async function markTrankilV2IntentionRemovedFromInbox(id: string): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>(`SELECT id FROM intentions WHERE id = ? LIMIT 1`, [id]);
  if (!row) return;
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions SET is_organized = 1, is_local_processed = 1, updated_at = ?, is_dirty = 1 WHERE id = ?`,
    [now, id],
  );
  await syncAfterIntentionWrite('markTrankilV2IntentionRemovedFromInbox');
  notifyIntentionsChanged({ id, reason: 'inbox_remove' });
}

/** Retire en masse les intentions visibles de l'Inbox (marquées triées / traitées). */
export async function bulkMarkTrankilV2InboxRemoved(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (unique.length === 0) return;
  await initTrankilV2Schema();
  const db = await getDb();
  const now = Date.now();
  const placeholders = unique.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE intentions SET is_organized = 1, is_local_processed = 1, updated_at = ?, is_dirty = 1 WHERE id IN (${placeholders})`,
    [now, ...unique],
  );
  await syncAfterIntentionWrite('bulkMarkTrankilV2InboxRemoved');
  notifyIntentionsChanged({ reason: 'inbox_remove_all' });
}

/** Compte le raccourci « À acheter » (category SHOP). */
export async function countShopClusterIntentions(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions i WHERE ${SHOP_SHORTCUT_WHERE}`,
  );
  return Number(row?.n ?? 0);
}

/** Raccourci « À acheter » — toutes les intentions SHOP actives. */
export async function listTrankilV2ShopClusterIntentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions i
     WHERE ${SHOP_SHORTCUT_WHERE}
     ORDER BY i.created_at DESC`,
  );
}

/** Compte le stock « Box » (idées TODO sans date, hors Inbox / SHOP). */
export async function countBoxStockIntentions(todayYmd?: string): Promise<number> {
  const ymd = resolveLocalTodayYmd(todayYmd);
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions i WHERE ${BOX_STOCK_WHERE}`,
    [ymd],
  );
  return Number(row?.n ?? 0);
}

/** Stock « Box » — toutes les idées TODO sans date (hors Inbox du jour, hors SHOP). */
export async function listTrankilV2BoxStockIntentions(todayYmd?: string): Promise<TrankilV2IntentionRow[]> {
  const ymd = resolveLocalTodayYmd(todayYmd);
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions i
     WHERE ${BOX_STOCK_WHERE}
     ORDER BY i.created_at DESC
     LIMIT 500`,
    [ymd],
  );
}

/** Suppression bulk (purge Box). */
export async function bulkDeleteTrankilV2IntentionsByIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (unique.length === 0) return;
  await initTrankilV2Schema();
  const db = await getDb();
  const placeholders = unique.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM intentions WHERE id IN (${placeholders})`, unique);
  await syncAfterIntentionWrite('bulkDeleteTrankilV2IntentionsByIds');
  notifyIntentionsChanged({ reason: 'box_clear_all' });
}

/** Compte le raccourci « Listes » (type LIST). */
export async function countListClusterIntentions(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions i WHERE ${LIST_SHORTCUT_WHERE}`,
  );
  return Number(row?.n ?? 0);
}

/** Raccourci « Listes » — toutes les intentions LIST actives. */
export async function listTrankilV2ListClusterIntentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions i
     WHERE ${LIST_SHORTCUT_WHERE}
     ORDER BY COALESCE(NULLIF(i.updated_at, 0), i.created_at) DESC`,
  );
}

/** Projets touchés aujourd’hui (création ou mise à jour locale). */
export async function countActiveProjectsToday(todayYmd?: string): Promise<number> {
  const ymd = resolveLocalTodayYmd(todayYmd);
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM intentions i
     WHERE i.type = 'PROJECT'
       AND COALESCE(i.is_archived, 0) = 0
       AND i.status != 'ARCHIVED'
       ${INTENTION_SYSTEM_RESERVED_SQL}
       AND (
         date(datetime(i.created_at / 1000, 'unixepoch', 'localtime')) = ?
         OR date(datetime(COALESCE(NULLIF(i.updated_at, 0), i.created_at) / 1000, 'unixepoch', 'localtime')) = ?
       )`,
    [ymd, ymd],
  );
  return Number(row?.n ?? 0);
}

const ACTIVE_PROJECTS_TODAY_WHERE = `
  i.type = 'PROJECT'
  AND COALESCE(i.is_archived, 0) = 0
  AND i.status != 'ARCHIVED'
  ${INTENTION_SYSTEM_RESERVED_SQL}
  AND (
    date(datetime(i.created_at / 1000, 'unixepoch', 'localtime')) = ?
    OR date(datetime(COALESCE(NULLIF(i.updated_at, 0), i.created_at) / 1000, 'unixepoch', 'localtime')) = ?
  )`;

/** Projets touchés aujourd’hui — id + titre (debug carrousel / stress tests). */
export async function listActiveProjectsToday(
  todayYmd?: string,
): Promise<Array<{ id: string; title: string }>> {
  const ymd = resolveLocalTodayYmd(todayYmd);
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<{ id: string; title: string }>(
    `SELECT i.id AS id, i.title AS title FROM intentions i
     WHERE ${ACTIVE_PROJECTS_TODAY_WHERE}
     ORDER BY COALESCE(NULLIF(i.updated_at, 0), i.created_at) DESC`,
    [ymd, ymd],
  );
}

const ACTIVE_LISTS_TODAY_WHERE = `
  i.type = 'LIST'
  AND COALESCE(i.is_archived, 0) = 0
  AND i.status != 'ARCHIVED'
  ${INTENTION_SYSTEM_RESERVED_SQL}
  AND (
    date(datetime(i.created_at / 1000, 'unixepoch', 'localtime')) = ?
    OR date(datetime(COALESCE(NULLIF(i.updated_at, 0), i.created_at) / 1000, 'unixepoch', 'localtime')) = ?
  )`;

/** @deprecated Alias — préférer {@link listTrankilV2ListClusterIntentions}. */
export async function listActiveListsToday(
  todayYmd?: string,
): Promise<Array<{ id: string; title: string }>> {
  const rows = await listTrankilV2ListClusterIntentions();
  return rows.map((r) => ({ id: r.id, title: r.title }));
}

/** @deprecated Alias — préférer {@link countListClusterIntentions}. */
export async function countActiveListsToday(_todayYmd?: string): Promise<number> {
  return countListClusterIntentions();
}

export type TrankilV2SmartClusterCounts = {
  /** Inbox du jour (captures d'aujourd'hui). */
  inboxToday: number;
  /** @deprecated Alias — {@link inboxToday}. */
  newToday: number;
  shopCount: number;
  boxCount: number;
  routinesCount: number;
  projectsToday: number;
  listsToday: number;
};

/** Snapshot des compteurs carrousel Smart Clusters (1 round-trip SQL). */
export async function getTrankilV2SmartClusterCounts(todayYmd?: string): Promise<TrankilV2SmartClusterCounts> {
  const ymd = resolveLocalTodayYmd(todayYmd);
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{
    inbox_today: number;
    shop_count: number;
    box_count: number;
    routines_count: number;
    projects_today: number;
    lists_today: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM intentions i WHERE ${INBOX_TODAY_WHERE}) AS inbox_today,
       (SELECT COUNT(*) FROM intentions i WHERE ${SHOP_SHORTCUT_WHERE}) AS shop_count,
       (SELECT COUNT(*) FROM intentions i WHERE ${BOX_STOCK_WHERE}) AS box_count,
       (SELECT COUNT(*) FROM intentions i WHERE ${ROUTINE_HABIT_WHERE}) AS routines_count,
       (SELECT COUNT(*) FROM intentions i
        WHERE i.type = 'PROJECT'
          AND COALESCE(i.is_archived, 0) = 0
          AND i.status != 'ARCHIVED'
          ${INTENTION_SYSTEM_RESERVED_SQL}
          AND (
            date(datetime(i.created_at / 1000, 'unixepoch', 'localtime')) = ?
            OR date(datetime(COALESCE(NULLIF(i.updated_at, 0), i.created_at) / 1000, 'unixepoch', 'localtime')) = ?
          )) AS projects_today,
       (SELECT COUNT(*) FROM intentions i WHERE ${LIST_SHORTCUT_WHERE}) AS lists_today`,
    [ymd, ymd, ymd, ymd],
  );
  const inboxToday = Number(row?.inbox_today ?? 0);
  return {
    inboxToday,
    newToday: inboxToday,
    shopCount: Number(row?.shop_count ?? 0),
    boxCount: Number(row?.box_count ?? 0),
    routinesCount: Number(row?.routines_count ?? 0),
    projectsToday: Number(row?.projects_today ?? 0),
    listsToday: Number(row?.lists_today ?? 0),
  };
}

async function ensureFreeDailyCaptureResetForDb(db: SQLite.SQLiteDatabase): Promise<void> {
  const today = formatYmdLocalForQuota(new Date());
  const row = await db.getFirstAsync<{
    free_capture_day_ymd: string | null;
    free_capture_remaining: number | null;
  }>(`SELECT free_capture_day_ymd, free_capture_remaining FROM user_stats WHERE id = 1`);
  if (!row) return;
  if (row.free_capture_day_ymd !== today) {
    const now = Date.now();
    await db.runAsync(
      `UPDATE user_stats SET free_capture_day_ymd = ?, free_capture_remaining = ?, updated_at = ?, is_dirty = 1 WHERE id = 1`,
      [today, FREE_DAILY_CAPTURE_MAX, now],
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
  const now = Date.now();
  await db.runAsync(`UPDATE user_stats SET free_capture_remaining = ?, updated_at = ?, is_dirty = 1 WHERE id = 1`, [next, now]);
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
    const now = Date.now();
    await db.runAsync(
      `UPDATE user_stats SET list_free_day_ymd = ?, list_free_remaining = ?, updated_at = ?, is_dirty = 1 WHERE id = 1`,
      [today, FREE_DAILY_LIST_MAX, now],
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
  const now = Date.now();
  await db.runAsync(`UPDATE user_stats SET list_free_remaining = ?, updated_at = ?, is_dirty = 1 WHERE id = 1`, [next, now]);
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
  context_tag?: string | null;
  parent_id?: string | null;
  zoom_parent_jalon_uid?: string | null;
  status?: TrankilIntentStatus;
  is_organized?: number;
  is_local_processed?: number;
  complexity_level?: number;
  created_at?: number;
  updated_at?: number;
  is_dirty?: number;
  server_version?: number;
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
  cost?: number | null;
  debug_tokens?: number | null;
  debug_latency_ms?: number | null;
  location_id?: string | null;
  transport_mode?: string | null;
  is_pinned?: number;
};

/** Spec v34 : `category_id` jamais vide en insertion (fallback PERSO). */
function normalizeIntentionCategoryId(raw: string | null | undefined): string {
  const up = String(raw || '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) return up;
  return 'PERSO';
}

function normalizeIntentionContextTag(raw: string | null | undefined): string | null {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 48);
  return s || null;
}

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
  if (VERBOSE_DEBUG) console.log('[DEBUG_DB] Statut de l instance DB:', !!db);
  const createdAt = row.created_at ?? Date.now();
  const updatedAt = row.updated_at ?? createdAt;
  const isDirty = row.is_dirty ?? 1;
  const serverVersion = row.server_version ?? 0;
  const remindLeave = row.remind_to_leave ?? 0;
  const locAddr = row.location_address?.trim() ? row.location_address.trim() : null;
  let zoomUid = row.zoom_parent_jalon_uid?.trim() ? String(row.zoom_parent_jalon_uid).trim() : null;
  if (!zoomUid) {
    const initialMeta = typeof row.metadata_json === 'string' ? row.metadata_json.trim() : '';
    if (initialMeta) {
      const parsed = safeParseJsonRecord(initialMeta);
      const raw = parsed.zoom_parent_jalon_uid;
      const next = typeof raw === 'string' ? raw.trim() : '';
      if (next) zoomUid = next;
    }
  }
  const categoryId = normalizeIntentionCategoryId(row.category_id);
  const contextTag = normalizeIntentionContextTag(row.context_tag);
  const sql =
    `INSERT INTO intentions (
      id, type, title, due_date, content_raw, suggested_tags, category_id, category, context_tag, parent_id, zoom_parent_jalon_uid, status, is_organized, is_local_processed, complexity_level, created_at, updated_at, is_dirty, server_version, calendar_event_id, calendar_name, is_synced_calendar, alarm_enabled, remind_at, local_notification_id, recurrence_rrule,
      is_pending_ai,
      remind_to_leave, location_address,
      ai_model_used, ai_latency_ms, tokens_prompt, tokens_completion, tokens_total, cost, debug_tokens, debug_latency_ms, location_id,
      is_pinned,
      is_done, done_at, is_archived, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL)`;
  const args = [
    row.id,
    row.type,
    row.title,
    normalizeDueDate(row.due_date),
    row.content_raw,
    row.suggested_tags ?? '[]',
    categoryId,
    categoryId,
    contextTag,
    row.parent_id ?? null,
    zoomUid,
    row.status ?? 'TODO',
    row.is_organized ?? 0,
    row.is_local_processed ?? 0,
    row.complexity_level ?? 1,
    createdAt,
    updatedAt,
    isDirty ? 1 : 0,
    Math.max(0, Math.floor(Number(serverVersion) || 0)),
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
    Number.isFinite(row.cost as number) ? Number(row.cost) : null,
    Number.isFinite(row.debug_tokens as number) ? Number(row.debug_tokens) : null,
    Number.isFinite(row.debug_latency_ms as number) ? Number(row.debug_latency_ms) : null,
    row.location_id ?? null,
    row.is_pinned ?? 0,
  ];
  const placeholderCount = (sql.match(/\?/g) ?? []).length;
  if (placeholderCount !== args.length) {
    throw new Error(`sql_placeholder_mismatch:${placeholderCount}:${args.length}`);
  }
  try {
    const r = await db.runAsync(sql, args);
    if (VERBOSE_DEBUG) console.log('[DATABASE] rowsAffected:', (r as { changes?: unknown }).changes ?? '—');
    console.log(
      `[DATABASE] ✅ Intention sauvée avec succès | Category: ${categoryId} | Context: ${contextTag ?? '—'}`,
    );
  } catch (e) {
    if (!isNativePrepareAsyncRejected(e)) throw e;
    console.log('[DATABASE] ♻️ Re-open SQLite (prepareAsync rejected)');
    resetTrankilV2RuntimeState();
    const nextDb = await getDb();
    if (VERBOSE_DEBUG) console.log('[DEBUG_DB] Statut de l instance DB (reopen):', !!nextDb);
    const r = await nextDb.runAsync(sql, args);
    if (VERBOSE_DEBUG) console.log('[DATABASE] rowsAffected:', (r as { changes?: unknown }).changes ?? '—');
    console.log(
      `[DATABASE] ✅ Intention sauvée avec succès | Category: ${categoryId} | Context: ${contextTag ?? '—'}`,
    );
  }
  const stats = await getTrankilV2UserStats();
  void stats;
  const initialMeta = typeof row.metadata_json === 'string' ? row.metadata_json.trim() : '';
  if (initialMeta) {
    const parsed = safeParseJsonRecord(initialMeta);
    if (Object.keys(parsed).length > 0) {
      await patchMetadata(row.id, parsed, { silent: true, fromSync: !isDirty });
    }
  }
  void syncAfterIntentionWrite('insertTrankilV2Intention');
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
  const now = Date.now();
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
      suggested_tags = ?,
      category_id = ?,
      category = ?,
      context_tag = ?,
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
      cost = COALESCE(?, cost),
      debug_tokens = COALESCE(?, debug_tokens),
      debug_latency_ms = COALESCE(?, debug_latency_ms),
      location_id = COALESCE(?, location_id),
      updated_at = ?,
      is_dirty = 1
    WHERE id = ?`,
    [
      patch.type,
      patch.title,
      normalizeDueDate(patch.due_date ?? null),
      patch.content_raw,
      patch.suggested_tags ?? '[]',
      normalizeIntentionCategoryId(patch.category_id),
      normalizeIntentionCategoryId(patch.category_id),
      normalizeIntentionContextTag(patch.context_tag),
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
      Number.isFinite(patch.cost as number) ? Number(patch.cost) : null,
      Number.isFinite(patch.debug_tokens as number) ? Number(patch.debug_tokens) : null,
      Number.isFinite(patch.debug_latency_ms as number) ? Number(patch.debug_latency_ms) : null,
      patch.location_id ?? null,
      now,
      id,
    ],
  );
  const meta = typeof patch.metadata_json === 'string' ? patch.metadata_json.trim() : '';
  if (meta) {
    await patchMetadata(id, safeParseJsonRecord(meta), { silent: true });
  }
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
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions SET title = ?, category_id = ?, category = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`,
    [
      patch.title ?? current.title,
      patch.category_id ?? current.category_id,
      patch.category_id ?? current.category_id,
      now,
      id,
    ],
  );
}

export async function updateTrankilV2IntentionTitle(id: string, title: string): Promise<void> {
  await initTrankilV2Schema();
  const next = String(title ?? '').trim();
  if (!next) return;
  const now = Date.now();
  await withTrankilV2Database(async (db) => {
    await db.runAsync(`UPDATE intentions SET title = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`, [next, now, id]);
  });
  await syncAfterIntentionWrite('updateTrankilV2IntentionTitle');
  notifyIntentionsChanged({ id, reason: 'title' });
}

export async function updateIntention(id: string, patch: { content?: string | null }): Promise<void> {
  if (!patch) return;
  if (patch.content !== undefined && patch.content !== null) {
    await updateTrankilV2IntentionTitle(id, patch.content);
  }
}

export async function getProjectsAndLists(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions
     WHERE type IN ('LIST', 'PROJECT')
       AND COALESCE(is_archived, 0) = 0
     ORDER BY created_at DESC`,
  );
}

export async function updateTrankilV2IntentionTemporal(
  id: string,
  patch: { due_date?: string | null; category_id?: string | null; metadata_json?: string },
): Promise<void> {
  await initTrankilV2Schema();
  let didWrite = false;
  await withTrankilV2Database(async (db) => {
    const current = await db.getFirstAsync<TrankilV2IntentionRow>(
      `SELECT * FROM intentions WHERE id = ?`,
      [id],
    );
    if (!current) return;
    const now = Date.now();
    const nextCategory = patch.category_id ?? current.category_id;
    await db.runAsync(
      `UPDATE intentions
       SET due_date = ?,
           category_id = ?,
           category = ?,
           updated_at = ?,
           is_dirty = 1
       WHERE id = ?`,
      [
        normalizeDueDate(patch.due_date ?? current.due_date ?? null),
        nextCategory,
        nextCategory,
        now,
        id,
      ],
    );
    didWrite = true;
  });
  if (!didWrite) return;
  const meta = typeof patch.metadata_json === 'string' ? patch.metadata_json.trim() : '';
  if (meta) {
    await patchMetadata(id, safeParseJsonRecord(meta), { silent: true });
  }
  await syncAfterIntentionWrite('updateTrankilV2IntentionTemporal');
  notifyIntentionsChanged({ id, reason: 'temporal' });
}

export async function updateTrankilV2IntentionRemindToLeave(
  id: string,
  remindToLeave: boolean,
  opts?: { silent?: boolean },
): Promise<void> {
  await initTrankilV2Schema();
  const now = Date.now();
  const v = remindToLeave ? 1 : 0;
  await withTrankilV2Database(async (db) => {
    await db.runAsync(
      `UPDATE intentions
       SET remind_to_leave = ?,
           updated_at = ?,
           is_dirty = 1
       WHERE id = ?`,
      [v, now, id],
    );
  });
  if (opts?.silent) return;
  await syncAfterIntentionWrite('updateTrankilV2IntentionRemindToLeave');
  notifyIntentionsChanged({ id, reason: 'user_edit' });
}

export async function updateTrankilV2IntentionOrganization(
  id: string,
  patch: { is_organized: number; title?: string; category_id?: string | null },
): Promise<void> {
  await initTrankilV2Schema();
  let didWrite = false;
  await withTrankilV2Database(async (db) => {
    const current = await db.getFirstAsync<TrankilV2IntentionRow>(
      `SELECT * FROM intentions WHERE id = ?`,
      [id],
    );
    if (!current) return;
    const now = Date.now();
    await db.runAsync(
      `UPDATE intentions SET is_organized = ?, title = ?, category_id = ?, category = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`,
      [
        patch.is_organized,
        patch.title ?? current.title,
        patch.category_id ?? current.category_id,
        patch.category_id ?? current.category_id,
        now,
        id,
      ],
    );
    if (patch.is_organized === 1 && current.is_organized !== 1) {
      await db.runAsync(`UPDATE user_stats SET zen_points = zen_points + 0, updated_at = ?, is_dirty = 1 WHERE id = 1`, [now]);
    }
    didWrite = true;
  });
  if (!didWrite) return;
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
  let didWrite = false;
  let activityActionType: UserActivityLogActionType | null = null;
  await withTrankilV2Database(async (db) => {
    const current = await db.getFirstAsync<TrankilV2IntentionRow>(
      `SELECT * FROM intentions WHERE id = ?`,
      [id],
    );
    if (!current) return;
    const now = Date.now();
    const nextCategory = patch.category_id ?? current.category_id;
    const nextOrganized = patch.is_organized ?? current.is_organized;
    const nextStatus = patch.status ?? current.status;
    const nextType = patch.type ?? current.type;
    await db.runAsync(
      `UPDATE intentions
       SET type = ?,
           title = ?,
           category_id = ?,
           category = ?,
           status = ?,
           is_organized = ?,
           is_local_processed = ?,
           updated_at = ?,
           is_dirty = 1
       WHERE id = ?`,
      [
        nextType,
        patch.title ?? current.title,
        nextCategory,
        nextCategory,
        nextStatus,
        nextOrganized,
        patch.is_local_processed ?? current.is_local_processed,
        now,
        id,
      ],
    );
    if (nextOrganized === 1 && current.is_organized !== 1) {
      await db.runAsync(`UPDATE user_stats SET zen_points = zen_points + 0, updated_at = ?, is_dirty = 1 WHERE id = 1`, [now]);
    }
    if (current.status !== 'DONE' && nextStatus === 'DONE' && (nextType === 'TASK' || nextType === 'HABIT')) {
      activityActionType = nextType === 'TASK' ? 'TASK_DONE' : 'HABIT_DONE';
    }
    await db.runAsync(
      `UPDATE intentions SET
         is_done = CASE WHEN status = 'DONE' THEN 1 ELSE 0 END,
         is_archived = CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END
       WHERE id = ?`,
      [id],
    );
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
    didWrite = true;
  });
  if (!didWrite) return;
  if (activityActionType) {
    void insertUserActivityLog({
      action_type: activityActionType,
      points_delta: 0,
      meta_json: JSON.stringify({ intention_id: id, source: 'updateTrankilV2IntentionClassification' }),
    }).catch(() => undefined);
  }
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

export type Pass3CleanupBucket = 'overdue' | 'orphan';

/**
 * Intentions « sas » Pass 3 / Feuille de route : échéances passées non terminées + racines sans date.
 * Racines uniquement (`parent_id` vide), hors archivé, statut TODO.
 */
export async function listIntentionsForPass3Cleanup(): Promise<Array<{ row: TrankilV2IntentionRow; bucket: Pass3CleanupBucket }>> {
  await initTrankilV2Schema();
  const db = await getDb();
  const overdue = await db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT i.*
     FROM intentions i
     WHERE COALESCE(i.is_archived, 0) = 0
       AND i.status = 'TODO'
       AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
       AND trim(i.title) != 'System Ready'
       AND i.due_date IS NOT NULL
       AND trim(i.due_date) != ''
       AND date(
         CASE
           WHEN length(replace(trim(i.due_date), '-', '')) = 8 AND instr(trim(i.due_date), '-') = 0 THEN
             printf('%s-%s-%s', substr(trim(i.due_date), 1, 4), substr(trim(i.due_date), 5, 2), substr(trim(i.due_date), 7, 2))
           WHEN length(trim(i.due_date)) >= 10 THEN substr(trim(i.due_date), 1, 10)
           ELSE '9999-12-31'
         END
       ) < date('now', 'localtime')
     ORDER BY i.due_date ASC, i.created_at ASC`,
  );
  const orphans = await db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT i.*
     FROM intentions i
     WHERE COALESCE(i.is_archived, 0) = 0
       AND i.status = 'TODO'
       AND (i.parent_id IS NULL OR trim(i.parent_id) = '')
       AND trim(i.title) != 'System Ready'
       AND (i.due_date IS NULL OR trim(i.due_date) = '')
     ORDER BY i.created_at ASC`,
  );
  const out: Array<{ row: TrankilV2IntentionRow; bucket: Pass3CleanupBucket }> = [];
  for (const row of overdue) out.push({ row, bucket: 'overdue' });
  for (const row of orphans) out.push({ row, bucket: 'orphan' });
  return out;
}

export async function insertDailySummary(params: {
  summaryDateYmd: string;
  contentHtml: string;
}): Promise<string> {
  await initTrankilV2Schema();
  const db = await getDb();
  const id = newUuidV4();
  const now = Date.now();
  const d = String(params.summaryDateYmd || '').trim();
  await db.runAsync(`INSERT INTO daily_summaries (id, summary_date, content_html, created_at) VALUES (?, ?, ?, ?)`, [
    id,
    d,
    String(params.contentHtml ?? ''),
    now,
  ]);
  return id;
}

export async function getLatestDailySummaryForDate(
  summaryDateYmd: string,
): Promise<{ id: string; summary_date: string; content_html: string; created_at: number } | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  const d = String(summaryDateYmd || '').trim();
  if (!d) return null;
  return (
    (await db.getFirstAsync<{ id: string; summary_date: string; content_html: string; created_at: number }>(
      `SELECT id, summary_date, content_html, created_at FROM daily_summaries WHERE summary_date = ? ORDER BY created_at DESC LIMIT 1`,
      [d],
    )) ?? null
  );
}

export async function deleteTrankilV2IntentionById(id: string): Promise<void> {
  const trimmed = String(id || '').trim();
  if (trimmed) {
    const { cancelTripMission } = await import('../services/traffic/sentinelTripMission');
    await cancelTripMission(trimmed);
  }
  await initTrankilV2Schema();
  const db = await getDb();
  if (trimmed) {
    await db.runAsync(`DELETE FROM sentinel_trips WHERE id = ?`, [trimmed]);
  }
  await db.runAsync(`DELETE FROM intentions WHERE id = ?`, [id]);
  await syncAfterIntentionWrite('deleteTrankilV2IntentionById');
  notifyIntentionsChanged({ id, reason: 'delete' });
}

export async function getTrankilV2IntentionById(id: string): Promise<TrankilV2IntentionRow | null> {
  await initTrankilV2Schema();
  return withTrankilV2Database(async (db) => {
    return (
      (await db.getFirstAsync<TrankilV2IntentionRow>(`SELECT * FROM intentions WHERE id = ? LIMIT 1`, [id])) ??
      null
    );
  });
}

export async function countZoomChildrenForProjectMilestone(params: {
  projectId: string;
  parentJalonUid: string;
}): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const pid = String(params.projectId || '').trim();
  const uid = String(params.parentJalonUid || '').trim();
  if (!pid || !uid) return 0;
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
     FROM intentions
     WHERE parent_id = ?
       AND zoom_parent_jalon_uid = ?`,
    [pid, uid],
  );
  return Number(row?.n ?? 0);
}

export async function getZoomChildrenStatsForProjectMilestone(params: {
  projectId: string;
  parentJalonUid: string;
}): Promise<{ total: number; done: number }> {
  await initTrankilV2Schema();
  const db = await getDb();
  const pid = String(params.projectId || '').trim();
  const uid = String(params.parentJalonUid || '').trim();
  if (!pid || !uid) return { total: 0, done: 0 };
  const row = await db.getFirstAsync<{ total: number; done: number }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS done
     FROM intentions
     WHERE parent_id = ?
       AND zoom_parent_jalon_uid = ?`,
    [pid, uid],
  );
  return { total: Number(row?.total ?? 0), done: Number(row?.done ?? 0) };
}

export async function listZoomChildrenForProjectMilestone(params: {
  projectId: string;
  parentJalonUid: string;
}): Promise<Array<{ id: string; title: string; status: TrankilIntentStatus }>> {
  await initTrankilV2Schema();
  const db = await getDb();
  const pid = String(params.projectId || '').trim();
  const uid = String(params.parentJalonUid || '').trim();
  if (!pid || !uid) return [];
  const rows =
    (await db.getAllAsync<{ id: string; title: string; status: TrankilIntentStatus }>(
      `SELECT id, title, status
       FROM intentions
       WHERE parent_id = ?
         AND zoom_parent_jalon_uid = ?
       ORDER BY created_at ASC`,
      [pid, uid],
    )) ?? [];
  return rows
    .map((r) => ({
      id: String(r.id || '').trim(),
      title: String(r.title || '').trim(),
      status: (r.status as TrankilIntentStatus) ?? 'TODO',
    }))
    .filter((x) => x.id && x.title);
}

export async function updateTrankilV2IntentionPendingAiFlag(id: string, is_pending_ai: number): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(`UPDATE intentions SET is_pending_ai = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`, [
    is_pending_ai ? 1 : 0,
    now,
    id,
  ]);
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
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions SET
       type = 'HABIT',
       title = ?,
       due_date = ?,
       category_id = ?,
       category = ?,
       suggested_tags = ?,
       is_pending_ai = 0,
       is_local_processed = 1,
       complexity_level = 1,
       updated_at = ?,
       is_dirty = 1
     WHERE id = ?`,
    [
      fields.title,
      normalizeDueDate(fields.due_date),
      fields.category_id,
      fields.category_id,
      fields.suggested_tags,
      now,
      id,
    ],
  );
  const meta = String(fields.metadata_json || '').trim();
  if (meta) {
    await patchMetadata(id, safeParseJsonRecord(meta), { silent: true });
  }
  await syncAfterIntentionWrite('finalizeOfflineFirstHabitFromShell');
  notifyIntentionsChanged({ id, reason: 'offline_first_habit' });
}

function deepMergeObjects(a: unknown, b: unknown): unknown {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const base = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
  const patch = b as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'list_scalable_v1') {
      out[k] = v as unknown;
      continue;
    }
    const cur = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = deepMergeObjects(cur, v) as Record<string, unknown>;
    } else {
      out[k] = v as unknown;
    }
  }
  return out;
}

function safeParseJsonRecord(input: string | null | undefined): Record<string, unknown> {
  try {
    const p = JSON.parse(String(input || '{}'));
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch {}
  return {};
}

async function applyMetadataJsonPatchOnDb(
  db: SQLite.SQLiteDatabase,
  key: string,
  partialObject: Record<string, unknown>,
  opts?: { fromSync?: boolean; silent?: boolean },
): Promise<void> {
  const row = await db.getFirstAsync<{ metadata_json: string; zoom_parent_jalon_uid: string | null }>(
    `SELECT metadata_json, zoom_parent_jalon_uid FROM intentions WHERE id = ? LIMIT 1`,
    [key],
  );
  if (!row) return;

  let base: unknown = {};
  try {
    base = JSON.parse(row.metadata_json || '{}');
  } catch {
    base = {};
  }
  const merged = deepMergeObjects(base, partialObject);
  const rawZoom = (partialObject as Record<string, unknown>).zoom_parent_jalon_uid;
  const nextZoom =
    rawZoom === undefined ? row.zoom_parent_jalon_uid : typeof rawZoom === 'string' ? rawZoom.trim() || null : null;
  const now = Date.now();
  const isDirty = opts?.fromSync ? 0 : 1;
  await db.runAsync(
    `UPDATE intentions SET metadata_json = ?, zoom_parent_jalon_uid = ?, updated_at = ?, is_dirty = ? WHERE id = ?`,
    [JSON.stringify(merged ?? {}, null, 2), nextZoom, now, isDirty, key],
  );
  if (VERBOSE_DEBUG) {
    const keys = Object.keys(partialObject ?? {}).join(',');
    console.log('[SQL_TRACE] ✅ patchMetadata', { id: key, isDirty, updated_at: now, keys });
  }
}

async function runMetadataPatchInSqliteTransaction(
  db: SQLite.SQLiteDatabase,
  key: string,
  partialObject: Record<string, unknown>,
  opts?: { fromSync?: boolean; silent?: boolean },
): Promise<void> {
  // Réentrance depuis un patchMetadata parent déjà en transaction — pas de SAVEPOINT imbriqué.
  if (sqliteMetadataPatchInProgress > 0) {
    await applyMetadataJsonPatchOnDb(db, key, partialObject, opts);
    return;
  }

  if (sqliteExplicitTransactionDepth > 0) {
    sqliteMetadataPatchSavepointDepth += 1;
    const savepoint = `trankil_pm_${sqliteMetadataPatchSavepointDepth}`;
    let savepointActive = false;
    try {
      try {
        await db.execAsync(`SAVEPOINT ${savepoint};`);
        savepointActive = true;
      } catch (savepointErr) {
        if (VERBOSE_DEBUG) {
          console.warn(
            `[SQL_TRACE] patchMetadata SAVEPOINT ${savepoint} unavailable — direct apply`,
            savepointErr,
          );
        }
        await applyMetadataJsonPatchOnDb(db, key, partialObject, opts);
        return;
      }
      try {
        await applyMetadataJsonPatchOnDb(db, key, partialObject, opts);
        if (savepointActive) {
          try {
            await db.execAsync(`RELEASE SAVEPOINT ${savepoint};`);
          } catch (releaseErr) {
            if (VERBOSE_DEBUG) {
              console.warn(
                `[SQL_TRACE] patchMetadata RELEASE ${savepoint} skipped after apply`,
                releaseErr,
              );
            }
          }
        }
      } catch (e) {
        if (savepointActive) {
          try {
            await db.execAsync(`ROLLBACK TO SAVEPOINT ${savepoint};`);
          } catch {}
        }
        throw e;
      }
    } finally {
      sqliteMetadataPatchSavepointDepth -= 1;
    }
    return;
  }

  sqliteMetadataPatchInProgress += 1;
  sqliteExplicitTransactionDepth += 1;
  try {
    await db.execAsync('BEGIN IMMEDIATE;');
    try {
      await applyMetadataJsonPatchOnDb(db, key, partialObject, opts);
      await db.execAsync('COMMIT;');
    } catch (e) {
      try {
        await db.execAsync('ROLLBACK;');
      } catch {}
      throw e;
    }
  } finally {
    sqliteExplicitTransactionDepth -= 1;
    sqliteMetadataPatchInProgress -= 1;
  }
}

/**
 * Merge transactionnel de `metadata_json` pour une intention (deep merge), `BEGIN IMMEDIATE`,
 * puis sync hardware / event `INTENTIONS_CHANGED` sauf `opts.silent`.
 */
export async function patchMetadata(
  id: string,
  partialObject: Record<string, unknown>,
  opts?: { fromSync?: boolean; silent?: boolean },
): Promise<void> {
  await initTrankilV2Schema();
  const key = String(id || '').trim();
  if (!key) return;
  await withTrankilV2Database(async (db) => {
    await runMetadataPatchInSqliteTransaction(db, key, partialObject, opts);
  });
  if (opts?.silent) return;
  await syncAfterIntentionWrite('patchMetadata');
  notifyIntentionsChanged({ id, reason: 'metadata_patch' });
}

async function updateTrankilV2IntentionMetadataJson(
  id: string,
  metadata_json: string,
  opts?: { silent?: boolean },
): Promise<void> {
  const obj = safeParseJsonRecord(metadata_json);
  await patchMetadata(id, obj, { silent: opts?.silent });
}

export async function updateTrankilV2IntentionTransportMode(
  id: string,
  patch: { transport_mode?: string | null },
  opts?: { silent?: boolean },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await db.getFirstAsync<TrankilV2IntentionRow>(`SELECT * FROM intentions WHERE id = ?`, [id]);
  if (!current) return;
  const now = Date.now();
  await db.runAsync(`UPDATE intentions SET transport_mode = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`, [
    patch.transport_mode === undefined ? current.transport_mode ?? null : patch.transport_mode,
    now,
    id,
  ]);
  if (opts?.silent) return;
  await syncAfterIntentionWrite('updateTrankilV2IntentionTransportMode');
  notifyIntentionsChanged({ id, reason: 'transport_mode' });
}

export async function updateTrankilV2IntentionLocationAddress(
  id: string,
  patch: { location_address?: string | null },
  opts?: { silent?: boolean },
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await db.getFirstAsync<TrankilV2IntentionRow>(`SELECT * FROM intentions WHERE id = ?`, [id]);
  if (!current) return;
  const now = Date.now();
  await db.runAsync(`UPDATE intentions SET location_address = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`, [
    patch.location_address === undefined ? current.location_address ?? null : patch.location_address,
    now,
    id,
  ]);
  if (opts?.silent) return;
  await syncAfterIntentionWrite('updateTrankilV2IntentionLocationAddress');
  notifyIntentionsChanged({ id, reason: 'location_address' });
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
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions
     SET calendar_event_id = ?,
         calendar_name = ?,
         is_synced_calendar = ?,
         updated_at = ?,
         is_dirty = 1
     WHERE id = ?`,
    [
      patch.calendar_event_id ?? current.calendar_event_id ?? null,
      patch.calendar_name ?? current.calendar_name ?? null,
      patch.is_synced_calendar ?? current.is_synced_calendar ?? 0,
      now,
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
  const now = Date.now();
  await db.runAsync(
    `UPDATE intentions
     SET alarm_enabled = ?,
         remind_at = ?,
         local_notification_id = ?,
         recurrence_rrule = ?,
         updated_at = ?,
         is_dirty = 1
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
      now,
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
    `UPDATE intentions SET status = 'DONE', is_done = 1, done_at = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`,
    [now, now, id],
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

/**
 * Historise une occurrence d'habitude pour un jour local (sans clôturer l'intention).
 * Idempotent : ignore si déjà enregistré pour ce jour.
 */
export async function logTrankilV2HabitOccurrence(
  intentionId: string,
  opts?: { dayKey?: string; source?: string },
): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ type: TrankilIntentType; status: TrankilIntentStatus }>(
    `SELECT type, status FROM intentions WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row || row.type !== 'HABIT' || row.status === 'ARCHIVED') return;

  const now = Date.now();
  const dayKey = String(opts?.dayKey || localDayKeyFromMs(now)).trim();
  const existingDays = await getHabitCompletionDayKeysByIntentionIds([id]);
  if (existingDays.get(id)?.includes(dayKey)) return;

  void insertUserActivityLog({
    action_type: 'HABIT_DONE',
    points_delta: 0,
    day_key: dayKey,
    created_at: now,
    meta_json: JSON.stringify({
      intention_id: id,
      source: opts?.source ?? 'logTrankilV2HabitOccurrence',
    }),
  }).catch(() => undefined);
  notifyIntentionsChanged({ id, reason: 'habit_occurrence' });
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
      `UPDATE intentions SET status = 'TODO', is_done = 0, done_at = NULL, updated_at = ?, is_dirty = 1 WHERE id = ?`,
      [now, id],
    );
  } else {
    await db.runAsync(
      `UPDATE intentions SET status = 'DONE', is_done = 1, done_at = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`,
      [now, now, id],
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
           archived_at = COALESCE(archived_at, ?),
           updated_at = ?,
           is_dirty = 1
       WHERE id = ?`,
      [now, now, id],
    );
  } else {
    await db.runAsync(
      `UPDATE intentions
       SET status = 'TODO',
           is_organized = 0,
           is_archived = 0,
           archived_at = NULL,
           updated_at = ?,
           is_dirty = 1
       WHERE id = ?`,
      [now, id],
    );
  }
  await syncAfterIntentionWrite('updateTrankilV2IntentionArchiveState');
  notifyIntentionsChanged({ id, reason: 'archive_state' });
}

/** Archive l’intention (alias menu — voir {@link updateTrankilV2IntentionArchiveState}). */
export async function archiveIntention(id: string): Promise<void> {
  await updateTrankilV2IntentionArchiveState(id, true);
}

/** DEPRECATED — nudge disponibilité retiré. Voir `nettoyage-code-mort.md` (§3). */
export async function pickAvailabilityTask(): Promise<TrankilV2IntentionRow | null> {
  return null;
}

/* pickAvailabilityTask — implémentation d’origine :
export async function pickAvailabilityTask(): Promise<TrankilV2IntentionRow | null> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE status = 'TODO' AND type = 'TASK'
     AND (LOWER(title) LIKE '%2 min%' OR LOWER(metadata_json) LIKE '%2 min%'
          OR LOWER(metadata_json) LIKE '%simple_task%')
     ORDER BY created_at ASC LIMIT 1`,
  );
  if (row) return row;
  return db.getFirstAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE status = 'TODO' AND type = 'TASK'
     ORDER BY created_at ASC LIMIT 1`,
  );
}
*/

/** DEPRECATED — jamais appelé en prod ; doublon de BonusEngine. Voir `nettoyage-code-mort.md` (§3). */
export async function applyAvailabilityReward(): Promise<{
  ia_credits: number;
  zen_points: number;
  rewardType: 'rescue_credit' | 'zen_points';
}> {
  const current = await getTrankilV2UserStats();
  return {
    ia_credits: current.ia_credits,
    zen_points: current.zen_points,
    rewardType: 'zen_points',
  };
}

/* applyAvailabilityReward — implémentation d’origine :
export async function applyAvailabilityReward(): Promise<{ ... }> {
  // +2 ia_credits si reservoir vide, sinon +5 zen_points
}
*/

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
  const id = String(input.id || '').trim() || newUuidV4();
  await db.runAsync(
    `INSERT INTO user_activity_logs (
      id, created_at, updated_at, is_dirty, server_version, day_key, action_type, points_delta, meta_json
    ) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    [id, createdAt, createdAt, dayKey, input.action_type, pointsDelta, input.meta_json ?? '{}'],
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
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO emergency_logs (id, error_message, stack, intentions_json, created_at, updated_at, is_dirty, server_version)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      newUuidV4(),
      errorMessage.slice(0, 400),
      (stack || '').slice(0, 2000),
      JSON.stringify(intentions),
      now,
      now,
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
