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

export type TrankilV2UserStatsRow = {
  remaining_intents: number;
  flower_boosts: number;
  last_nudge_at: number | null;
  growth_score: number;
  morning_focus_item_id: string | null;
  morning_focus_date_key: string | null;
  evening_ritual_date_key: string | null;
  local_action_streak: number;
  pshitt_sprays: number;
  magic_shake_passes: number;
  weather_mode: 'CLOUDY' | 'SUNNY';
  vibrancy_mode: number;
  ad_last_reward_at: number | null;
  ad_video_streak: number;
  last_organize_at: number | null;
  aesthetic_score: number;
  utility_score: number;
  local_affinity: number;
  local_validated_count: number;
  expert_validated_count: number;
  current_flower_type: string;
  current_flower_started_at: number;
  ad_videos_watched: number;
  intentions_created_total: number;
  debug_spawn_flies: number;
  last_share_bonus_at: number | null;
  notifications_quiet_until_at: number | null;
};

export type HerbierRow = {
  id: string;
  flower_type: string;
  final_score: number;
  achievements_json: string;
  harvested_at: number;
};

export type EmergencyLogRow = {
  id: string;
  error_message: string;
  stack: string;
  intentions_json: string;
  created_at: number;
};

export type BonusEventType =
  | 'utility_credits'
  | 'utility_magic_shake'
  | 'aesthetic_flower_boost'
  | 'aesthetic_pshitt'
  | 'super_bonus_local_streak';

const DB_NAME = 'trankil_v2.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

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

    CREATE TABLE IF NOT EXISTS user_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      remaining_intents INTEGER NOT NULL DEFAULT 10,
      flower_boosts INTEGER NOT NULL DEFAULT 0,
      last_nudge_at INTEGER,
      growth_score INTEGER NOT NULL DEFAULT 0,
      morning_focus_item_id TEXT,
      morning_focus_date_key TEXT,
      evening_ritual_date_key TEXT,
      local_action_streak INTEGER NOT NULL DEFAULT 0,
      pshitt_sprays INTEGER NOT NULL DEFAULT 0,
      magic_shake_passes INTEGER NOT NULL DEFAULT 0,
      weather_mode TEXT NOT NULL DEFAULT 'CLOUDY',
      vibrancy_mode REAL NOT NULL DEFAULT 0.8,
      ad_last_reward_at INTEGER,
      ad_video_streak INTEGER NOT NULL DEFAULT 0,
      last_organize_at INTEGER,
      aesthetic_score REAL NOT NULL DEFAULT 0,
      utility_score REAL NOT NULL DEFAULT 0,
      local_affinity REAL NOT NULL DEFAULT 0.5,
      local_validated_count INTEGER NOT NULL DEFAULT 0,
      expert_validated_count INTEGER NOT NULL DEFAULT 0,
      current_flower_type TEXT NOT NULL DEFAULT 'perce_neige',
      current_flower_started_at INTEGER NOT NULL DEFAULT 0,
      ad_videos_watched INTEGER NOT NULL DEFAULT 0,
      intentions_created_total INTEGER NOT NULL DEFAULT 0,
      debug_spawn_flies INTEGER NOT NULL DEFAULT 0,
      last_share_bonus_at INTEGER,
      notifications_quiet_until_at INTEGER
    );

    INSERT OR IGNORE INTO user_stats (id, remaining_intents, flower_boosts, last_nudge_at, growth_score, morning_focus_item_id, morning_focus_date_key, evening_ritual_date_key, local_action_streak, pshitt_sprays, magic_shake_passes, weather_mode, vibrancy_mode, ad_last_reward_at, ad_video_streak, last_organize_at, aesthetic_score, utility_score, local_affinity, local_validated_count, expert_validated_count)
    VALUES (1, 10, 0, NULL, 0, NULL, NULL, NULL, 0, 0, 0, 'CLOUDY', 0.8, NULL, 0, NULL, 0, 0, 0.5, 0, 0);

    CREATE TABLE IF NOT EXISTS bonus_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bonus_type TEXT NOT NULL,
      is_accepted INTEGER NOT NULL DEFAULT 0,
      triggered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS herbier (
      id TEXT PRIMARY KEY NOT NULL,
      flower_type TEXT NOT NULL,
      final_score INTEGER NOT NULL DEFAULT 100,
      achievements_json TEXT NOT NULL DEFAULT '{}',
      harvested_at INTEGER NOT NULL
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
  const userStatsCols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(user_stats)`,
  );
  const hasGrowthScore = userStatsCols.some((c) => c.name === 'growth_score');
  if (!hasGrowthScore) {
    await db.execAsync(
      `ALTER TABLE user_stats ADD COLUMN growth_score INTEGER NOT NULL DEFAULT 0;`,
    );
  }
  const hasMorningFocusItem = userStatsCols.some((c) => c.name === 'morning_focus_item_id');
  if (!hasMorningFocusItem) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN morning_focus_item_id TEXT;`);
  }
  const hasMorningFocusDate = userStatsCols.some((c) => c.name === 'morning_focus_date_key');
  if (!hasMorningFocusDate) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN morning_focus_date_key TEXT;`);
  }
  const hasEveningDate = userStatsCols.some((c) => c.name === 'evening_ritual_date_key');
  if (!hasEveningDate) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN evening_ritual_date_key TEXT;`);
  }
  const hasLocalStreak = userStatsCols.some((c) => c.name === 'local_action_streak');
  if (!hasLocalStreak) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN local_action_streak INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasPshitt = userStatsCols.some((c) => c.name === 'pshitt_sprays');
  if (!hasPshitt) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN pshitt_sprays INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasMagicPasses = userStatsCols.some((c) => c.name === 'magic_shake_passes');
  if (!hasMagicPasses) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN magic_shake_passes INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasWeather = userStatsCols.some((c) => c.name === 'weather_mode');
  if (!hasWeather) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN weather_mode TEXT NOT NULL DEFAULT 'CLOUDY';`);
  }
  const hasVibrancy = userStatsCols.some((c) => c.name === 'vibrancy_mode');
  if (!hasVibrancy) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN vibrancy_mode REAL NOT NULL DEFAULT 0.8;`);
  }
  const hasAdLast = userStatsCols.some((c) => c.name === 'ad_last_reward_at');
  if (!hasAdLast) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN ad_last_reward_at INTEGER;`);
  }
  const hasAdStreak = userStatsCols.some((c) => c.name === 'ad_video_streak');
  if (!hasAdStreak) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN ad_video_streak INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasLastOrganizeAt = userStatsCols.some((c) => c.name === 'last_organize_at');
  if (!hasLastOrganizeAt) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN last_organize_at INTEGER;`);
  }
  const hasAestheticScore = userStatsCols.some((c) => c.name === 'aesthetic_score');
  if (!hasAestheticScore) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN aesthetic_score REAL NOT NULL DEFAULT 0;`);
  }
  const hasUtilityScore = userStatsCols.some((c) => c.name === 'utility_score');
  if (!hasUtilityScore) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN utility_score REAL NOT NULL DEFAULT 0;`);
  }
  const hasLocalAffinity = userStatsCols.some((c) => c.name === 'local_affinity');
  if (!hasLocalAffinity) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN local_affinity REAL NOT NULL DEFAULT 0.5;`);
  }
  const hasLocalValidated = userStatsCols.some((c) => c.name === 'local_validated_count');
  if (!hasLocalValidated) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN local_validated_count INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasExpertValidated = userStatsCols.some((c) => c.name === 'expert_validated_count');
  if (!hasExpertValidated) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN expert_validated_count INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasFlowerType = userStatsCols.some((c) => c.name === 'current_flower_type');
  if (!hasFlowerType) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN current_flower_type TEXT NOT NULL DEFAULT 'perce_neige';`);
  }
  const hasFlowerStartedAt = userStatsCols.some((c) => c.name === 'current_flower_started_at');
  if (!hasFlowerStartedAt) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN current_flower_started_at INTEGER NOT NULL DEFAULT 0;`);
    await db.runAsync(`UPDATE user_stats SET current_flower_started_at = ? WHERE id = 1`, [Date.now()]);
  }
  const hasAdVideosWatched = userStatsCols.some((c) => c.name === 'ad_videos_watched');
  if (!hasAdVideosWatched) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN ad_videos_watched INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasIntentionsCreatedTotal = userStatsCols.some((c) => c.name === 'intentions_created_total');
  if (!hasIntentionsCreatedTotal) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN intentions_created_total INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasDebugSpawnFlies = userStatsCols.some((c) => c.name === 'debug_spawn_flies');
  if (!hasDebugSpawnFlies) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN debug_spawn_flies INTEGER NOT NULL DEFAULT 0;`);
  }
  const hasLastShareBonus = userStatsCols.some((c) => c.name === 'last_share_bonus_at');
  if (!hasLastShareBonus) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN last_share_bonus_at INTEGER;`);
  }
  const hasQuietUntil = userStatsCols.some((c) => c.name === 'notifications_quiet_until_at');
  if (!hasQuietUntil) {
    await db.execAsync(`ALTER TABLE user_stats ADD COLUMN notifications_quiet_until_at INTEGER;`);
  }
}

export async function listTrankilV2Intentions(): Promise<TrankilV2IntentionRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<TrankilV2IntentionRow>(
    `SELECT * FROM intentions ORDER BY created_at DESC`,
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
    `SELECT remaining_intents, flower_boosts, last_nudge_at, growth_score, morning_focus_item_id, morning_focus_date_key, evening_ritual_date_key, local_action_streak, pshitt_sprays, magic_shake_passes, weather_mode, vibrancy_mode, ad_last_reward_at, ad_video_streak, last_organize_at, aesthetic_score, utility_score, local_affinity, local_validated_count, expert_validated_count, current_flower_type, current_flower_started_at, ad_videos_watched, intentions_created_total, debug_spawn_flies, last_share_bonus_at, notifications_quiet_until_at FROM user_stats WHERE id = 1`,
  );
  return (
    row ?? {
      remaining_intents: 10,
      flower_boosts: 0,
      last_nudge_at: null,
      growth_score: 0,
      morning_focus_item_id: null,
      morning_focus_date_key: null,
      evening_ritual_date_key: null,
      local_action_streak: 0,
      pshitt_sprays: 0,
      magic_shake_passes: 0,
      weather_mode: 'CLOUDY',
      vibrancy_mode: 0.8,
      ad_last_reward_at: null,
      ad_video_streak: 0,
      last_organize_at: null,
      aesthetic_score: 0,
      utility_score: 0,
      local_affinity: 0.5,
      local_validated_count: 0,
      expert_validated_count: 0,
      current_flower_type: 'perce_neige',
      current_flower_started_at: Date.now(),
      ad_videos_watched: 0,
      intentions_created_total: 0,
      debug_spawn_flies: 0,
      last_share_bonus_at: null,
      notifications_quiet_until_at: null,
    }
  );
}

const VIRAL_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function grantViralBonus(nowMs: number = Date.now()): Promise<{
  granted: boolean;
  nextEligibleAt: number;
}> {
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const last = stats.last_share_bonus_at ?? 0;
  const cooldownUntil = last + VIRAL_BONUS_COOLDOWN_MS;
  if (last > 0 && nowMs < cooldownUntil) {
    return { granted: false, nextEligibleAt: cooldownUntil };
  }
  await db.runAsync(
    `UPDATE user_stats
      SET flower_boosts = ?,
          pshitt_sprays = ?,
          last_share_bonus_at = ?
      WHERE id = 1`,
    [stats.flower_boosts + 3, stats.pshitt_sprays + 1, nowMs],
  );
  return { granted: true, nextEligibleAt: nowMs + VIRAL_BONUS_COOLDOWN_MS };
}

export async function setNotificationsQuietUntil(timestamp: number | null): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(`UPDATE user_stats SET notifications_quiet_until_at = ? WHERE id = 1`, [
    timestamp,
  ]);
}

export async function listHerbierEntries(): Promise<HerbierRow[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  return db.getAllAsync<HerbierRow>(
    `SELECT id, flower_type, final_score, achievements_json, harvested_at
     FROM herbier
     ORDER BY harvested_at DESC`,
  );
}

export async function getHerbierCount(): Promise<number> {
  await initTrankilV2Schema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM herbier`,
  );
  return Number(row?.total ?? 0);
}

export async function harvestCurrentFlower(
  nextFlowerType: string,
  harvestedFlowerType?: string,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const doneRow = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM intentions WHERE is_organized = 1`,
  );
  const achievements = {
    organized_count: Number(doneRow?.total ?? 0),
    local_affinity: stats.local_affinity,
  };
  await db.runAsync(
    `INSERT INTO herbier (id, flower_type, final_score, achievements_json, harvested_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      `herbier_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      harvestedFlowerType ?? stats.current_flower_type,
      100,
      JSON.stringify(achievements),
      Date.now(),
    ],
  );
  await db.runAsync(
    `UPDATE user_stats
      SET growth_score = 0,
          current_flower_type = ?,
          current_flower_started_at = ?
      WHERE id = 1`,
    [nextFlowerType, Date.now()],
  );
}

export async function consumeTrankilV2IntentCredit(): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const nextRemaining = Math.max(0, current.remaining_intents - 1);
  await db.runAsync(
    `UPDATE user_stats SET remaining_intents = ? WHERE id = 1`,
    [nextRemaining],
  );
  return {
    ...current,
    remaining_intents: nextRemaining,
  };
}

export async function addRemainingIntents(count: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  const next = current.remaining_intents + safe;
  await db.runAsync(`UPDATE user_stats SET remaining_intents = ? WHERE id = 1`, [next]);
  return { ...current, remaining_intents: next };
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
      row.due_date ?? null,
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
  await db.runAsync(
    `UPDATE user_stats SET intentions_created_total = ? WHERE id = 1`,
    [stats.intentions_created_total + 1],
  );
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
      patch.due_date ?? current.due_date ?? null,
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
    await db.runAsync(`UPDATE user_stats SET last_organize_at = ? WHERE id = 1`, [
      Date.now(),
    ]);
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
    await db.runAsync(`UPDATE user_stats SET last_organize_at = ? WHERE id = 1`, [Date.now()]);
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
  remaining_intents: number;
  flower_boosts: number;
  rewardType: 'rescue_credit' | 'flower_boost';
}> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  if (current.remaining_intents <= 0) {
    const nextCredits = current.remaining_intents + 2;
    await db.runAsync(`UPDATE user_stats SET remaining_intents = ? WHERE id = 1`, [
      nextCredits,
    ]);
    return {
      remaining_intents: nextCredits,
      flower_boosts: current.flower_boosts,
      rewardType: 'rescue_credit',
    };
  }
  const nextBoosts = current.flower_boosts + 1;
  await db.runAsync(`UPDATE user_stats SET flower_boosts = ? WHERE id = 1`, [
    nextBoosts,
  ]);
  return {
    remaining_intents: current.remaining_intents,
    flower_boosts: nextBoosts,
    rewardType: 'flower_boost',
  };
}

const GROWTH_MIN = 0;
const GROWTH_MAX = 100;
const GROWTH_DECAY_AFTER_MS = 24 * 60 * 60 * 1000;

export function growthPointsForType(type: TrankilIntentType): number {
  if (type === 'HABIT') return 5;
  if (type === 'PROJECT') return 15;
  if (type === 'TASK') return 2;
  return 0;
}

export async function applyGrowthDecayIfNeeded(
  nowMs: number = Date.now(),
): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const last = current.last_nudge_at ?? 0;
  if (last > 0 && nowMs - last <= GROWTH_DECAY_AFTER_MS) {
    return current;
  }
  if (last <= 0) {
    return current;
  }
  const nextScore = Math.max(GROWTH_MIN, current.growth_score - 5);
  await db.runAsync(
    `UPDATE user_stats SET growth_score = ?, last_nudge_at = ? WHERE id = 1`,
    [nextScore, nowMs],
  );
  return { ...current, growth_score: nextScore, last_nudge_at: nowMs };
}

export async function updateGrowth(points: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const decayed = await applyGrowthDecayIfNeeded();
  const safePoints = Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0;
  const nextScore = Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, decayed.growth_score + safePoints));
  const now = Date.now();
  await db.runAsync(
    `UPDATE user_stats SET growth_score = ?, last_nudge_at = ? WHERE id = 1`,
    [nextScore, now],
  );
  return { ...decayed, growth_score: nextScore, last_nudge_at: now };
}

export async function setMorningFocusSelection(
  itemId: string,
  dateKey: string,
): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(
    `UPDATE user_stats SET morning_focus_item_id = ?, morning_focus_date_key = ? WHERE id = 1`,
    [itemId, dateKey],
  );
}

export async function setEveningRitualDateKey(dateKey: string): Promise<void> {
  await initTrankilV2Schema();
  const db = await getDb();
  await db.runAsync(
    `UPDATE user_stats SET evening_ritual_date_key = ? WHERE id = 1`,
    [dateKey],
  );
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
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  const next = current.magic_shake_passes + safe;
  const nextUtility = current.utility_score + (safe > 0 ? 1 : 0);
  await db.runAsync(
    `UPDATE user_stats SET magic_shake_passes = ?, utility_score = ? WHERE id = 1`,
    [next, nextUtility],
  );
  return { ...current, magic_shake_passes: next, utility_score: nextUtility };
}

export async function addPshittSprays(count: number): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  const next = current.pshitt_sprays + safe;
  await db.runAsync(`UPDATE user_stats SET pshitt_sprays = ? WHERE id = 1`, [next]);
  return { ...current, pshitt_sprays: next };
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
  remaining_intents?: number;
  flower_boosts?: number;
  weather_mode?: 'CLOUDY' | 'SUNNY';
  vibrancy_mode?: number;
  ad_last_reward_at?: number | null;
  ad_video_streak?: number;
}): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const next: TrankilV2UserStatsRow = {
    ...current,
    remaining_intents: patch.remaining_intents ?? current.remaining_intents,
    flower_boosts: patch.flower_boosts ?? current.flower_boosts,
    weather_mode: patch.weather_mode ?? current.weather_mode,
    vibrancy_mode: patch.vibrancy_mode ?? current.vibrancy_mode,
    ad_last_reward_at:
      patch.ad_last_reward_at === undefined
        ? current.ad_last_reward_at
        : patch.ad_last_reward_at,
    ad_video_streak: patch.ad_video_streak ?? current.ad_video_streak,
  };
  await db.runAsync(
    `UPDATE user_stats
      SET remaining_intents = ?,
          flower_boosts = ?,
          weather_mode = ?,
          vibrancy_mode = ?,
          ad_last_reward_at = ?,
          ad_video_streak = ?
      WHERE id = 1`,
    [
      next.remaining_intents,
      next.flower_boosts,
      next.weather_mode,
      next.vibrancy_mode,
      next.ad_last_reward_at,
      next.ad_video_streak,
    ],
  );
  return next;
}

export async function incrementBehaviorScores(patch: {
  aestheticDelta?: number;
  utilityDelta?: number;
}): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const aestheticDelta = Number.isFinite(patch.aestheticDelta)
    ? Number(patch.aestheticDelta)
    : 0;
  const utilityDelta = Number.isFinite(patch.utilityDelta) ? Number(patch.utilityDelta) : 0;
  const nextAesthetic = Math.max(0, current.aesthetic_score + aestheticDelta);
  const nextUtility = Math.max(0, current.utility_score + utilityDelta);
  await db.runAsync(
    `UPDATE user_stats SET aesthetic_score = ?, utility_score = ? WHERE id = 1`,
    [nextAesthetic, nextUtility],
  );
  return { ...current, aesthetic_score: nextAesthetic, utility_score: nextUtility };
}

export async function recordLocalAffinityEvent(isLocal: boolean): Promise<TrankilV2UserStatsRow> {
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const nextLocal = current.local_validated_count + (isLocal ? 1 : 0);
  const nextExpert = current.expert_validated_count + (isLocal ? 0 : 1);
  const total = nextLocal + nextExpert;
  const ratio = total > 0 ? nextLocal / total : 0.5;
  await db.runAsync(
    `UPDATE user_stats
      SET local_validated_count = ?,
          expert_validated_count = ?,
          local_affinity = ?
      WHERE id = 1`,
    [nextLocal, nextExpert, ratio],
  );
  return {
    ...current,
    local_validated_count: nextLocal,
    expert_validated_count: nextExpert,
    local_affinity: ratio,
  };
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
  await initTrankilV2Schema();
  const db = await getDb();
  const stats = await getTrankilV2UserStats();
  const next = Math.max(0, Math.round(count));
  await db.runAsync(`UPDATE user_stats SET debug_spawn_flies = ? WHERE id = 1`, [next]);
  return { ...stats, debug_spawn_flies: next };
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
  await initTrankilV2Schema();
  const db = await getDb();
  const current = await getTrankilV2UserStats();
  const safe = Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0;
  const nextBoosts = current.flower_boosts + safe;
  const nextAesthetic = current.aesthetic_score + (safe > 0 ? 1 : 0);
  await db.runAsync(`UPDATE user_stats SET flower_boosts = ?, aesthetic_score = ? WHERE id = 1`, [
    nextBoosts,
    nextAesthetic,
  ]);
  return { ...current, flower_boosts: nextBoosts, aesthetic_score: nextAesthetic };
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
