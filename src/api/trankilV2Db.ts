import * as SQLite from 'expo-sqlite';

export type TrankilIntentType = 'TASK' | 'HABIT' | 'NOTE' | 'AUDIO' | 'PROJECT';
export type TrankilIntentStatus = 'TODO' | 'DONE';

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
  section: 'TASK_HABIT' | 'PROJECT_SUBTASK' | 'NOTE_AUDIO';
};

export type TrankilV2TimelineDateMode = 'DAY' | 'WEEK';

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

export type BonusEventType =
  | 'ia_credits'
  | 'zen_points'
  | 'super_bonus_local_streak';

const DB_NAME = 'trankil_v2.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

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

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

/**
 * Schéma SQLite de base Trankil-v2.
 */
export async function initTrankilV2Schema(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS intentions (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('TASK', 'HABIT', 'NOTE', 'AUDIO', 'PROJECT')),
      title TEXT NOT NULL,
      due_date TEXT,
      content_raw TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      suggested_tags TEXT NOT NULL DEFAULT '[]',
      category_id TEXT,
      category TEXT,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'DONE')),
      is_organized INTEGER NOT NULL DEFAULT 0 CHECK (is_organized IN (0, 1)),
      is_local_processed INTEGER NOT NULL DEFAULT 0 CHECK (is_local_processed IN (0, 1)),
      complexity_level INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_intentions_type_status
      ON intentions (type, status);
    CREATE INDEX IF NOT EXISTS idx_intentions_created_at
      ON intentions (created_at DESC);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
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
  await db.execAsync(`UPDATE user_stats SET growth_score = COALESCE(growth_score, zen_points, 0) WHERE id = 1;`);
  await db.execAsync(`UPDATE user_stats SET zen_points = growth_score WHERE id = 1;`);
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
        recharge_last_video_at INTEGER
      );
      INSERT OR REPLACE INTO user_stats_compact (
        id, ia_credits, zen_points, growth_score, local_action_streak, ad_last_reward_at, ad_videos_watched, pending_sync_ia_credits, recharge_window_started_at, recharge_videos_in_window, recharge_last_video_at
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
        NULL
      FROM user_stats
      WHERE id = 1;
      DROP TABLE user_stats;
      ALTER TABLE user_stats_compact RENAME TO user_stats;
    `);
  }
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
): Promise<TrankilV2TimelineItemRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2TimelineItemRow>(
    `
    SELECT id, type, status, due_date, created_at, content_raw, parent_id, project_title, display_title, section
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
        i.due_date AS effective_date,
        1 AS section_order
      FROM intentions i
      WHERE i.status = ?
        AND i.type IN ('TASK', 'HABIT')
        AND (i.parent_id IS NULL OR trim(i.parent_id) = '')

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
        i.due_date AS effective_date,
        2 AS section_order
      FROM intentions i
      LEFT JOIN intentions p ON p.id = i.parent_id AND p.type = 'PROJECT'
      WHERE i.status = ?
        AND i.type = 'TASK'
        AND i.parent_id IS NOT NULL
        AND trim(i.parent_id) != ''

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
        'NOTE_AUDIO' AS section,
        COALESCE(i.due_date, date(datetime(i.created_at / 1000, 'unixepoch', 'localtime'))) AS effective_date,
        3 AS section_order
      FROM intentions i
      WHERE i.status = ?
        AND i.type IN ('NOTE', 'AUDIO')
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
    ORDER BY section_order ASC, created_at DESC
    `,
    [status, status, status, mode, selectedDateYmd, mode, selectedDateYmd, selectedDateYmd],
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

export async function listTrankilV2UnorganizedIntentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE is_organized = 0 ORDER BY created_at DESC`,
  );
}

export async function listTrankilV2OrganizedIntentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions WHERE is_organized = 1 ORDER BY created_at DESC`,
  );
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
};

export async function insertTrankilV2Intention(
  row: TrankilV2IntentionInsert,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO intentions (
      id, type, title, due_date, content_raw, metadata_json, suggested_tags, category_id, category, parent_id, status, is_organized, is_local_processed, complexity_level, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  );
  const stats = await getTrankilV2UserStats();
  void stats;
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
}

export async function getTrankilV2UnorganizedCount(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM intentions WHERE is_organized = 0`,
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
}

export async function markTrankilV2IntentionDone(id: string): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(`UPDATE intentions SET status = 'DONE' WHERE id = ?`, [id]);
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
  return { ...current, zen_points: nextScore, growth_score: nextScore };
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
