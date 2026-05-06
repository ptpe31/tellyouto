import * as SQLite from 'expo-sqlite';

import { initTrankilV2Schema } from '../api/trankilV2Db';
import i18n from '../locales';

const TRANKIL_V2_DB_NAME = 'talkndone.db';
const LOOKBACK_DAYS = 14;
const LOOKBACK_MS = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

export type UserVAE = {
  lookbackDays: number;
  volume: number;
  actionRatio: number;
  engagementRatio: number;
  doneCount: number;
  archivedCount: number;
  archivedRatio: number;
  activeDays: number;
};

export type UserProfile = {
  id: number;
  label: string;
  description: string;
};

export type KindnessBones = {
  insight: string;
  action_tip: string;
};

type AggregatedIntentionStats = {
  volume: number;
  done_count: number;
  archived_count: number;
};

type AggregatedActivityDays = {
  active_days: number;
};

type ActivityDayRow = {
  day_key: string;
};

function dayKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Chronological local day keys from oldest to newest (inclusive). */
export function buildTrendDayKeys(daysCount: number, nowMs: number = Date.now()): string[] {
  const safeDays = Number.isFinite(daysCount) ? Math.max(1, Math.round(daysCount)) : LOOKBACK_DAYS;
  const now = new Date(nowMs);
  return Array.from({ length: safeDays }).map((_, idx) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (safeDays - 1 - idx));
    return dayKeyLocal(d);
  });
}

const PROFILE_FALLBACKS: Record<number, { label: string; description: string }> = {
  1: {
    label: 'LE REVEUR',
    description: "Capture beaucoup d'intentions mais passe peu a l'action.",
  },
  2: {
    label: 'LE DECONNECTE',
    description: "Usage en baisse avec peu d'actions finalisees et faible engagement.",
  },
  3: {
    label: 'LE SPRINTEUR',
    description: 'Tres efficace sur les actions, mais rythme encore irregulier.',
  },
  4: {
    label: "LE CHEF D'ORCHESTRE",
    description: 'Oriente export et orchestration, avec une forte part archivee.',
  },
  5: {
    label: "L'ASSIDU ZEN",
    description: 'Equilibre solide entre execution et regularite.',
  },
};

const KINDNESS_FALLBACKS: Record<number, KindnessBones> = {
  1: {
    insight: 'Tu as beaucoup de clarte a capturer des intentions.',
    action_tip: 'Choisis une seule intention et verrouille-la aujourd hui.',
  },
  2: {
    insight: 'Le rail est plus calme en ce moment, c est normal.',
    action_tip: 'Reprends avec une micro-action de 2 minutes.',
  },
  3: {
    insight: 'Ton execution est puissante quand tu enclenches.',
    action_tip: 'Ajoute un mini-rituel quotidien pour stabiliser ton rythme.',
  },
  4: {
    insight: 'Tu pilotes bien la circulation vers le calendrier.',
    action_tip: 'Garde 1 intention active locale pour maintenir le lien quotidien.',
  },
  5: {
    insight: 'Ton equilibre action-regularite est tres solide.',
    action_tip: 'Maintiens cette cadence avec une revue hebdo legere.',
  },
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(TRANKIL_V2_DB_NAME);
  }
  return dbPromise;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

export async function calculateUserVAE(nowMs: number = Date.now()): Promise<UserVAE> {
  await initTrankilV2Schema();
  const db = await getDb();
  const startMs = nowMs - LOOKBACK_MS;

  const intentionStats = await db.getFirstAsync<AggregatedIntentionStats>(
    `SELECT
       COUNT(*) AS volume,
       SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS done_count,
       SUM(CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived_count
     FROM intentions
     WHERE created_at >= ?`,
    [startMs],
  );

  const activityDays = await db.getFirstAsync<AggregatedActivityDays>(
    `SELECT
       COUNT(DISTINCT day_key) AS active_days
     FROM user_activity_logs
     WHERE created_at >= ?`,
    [startMs],
  );

  const volume = Number(intentionStats?.volume ?? 0);
  const doneCount = Number(intentionStats?.done_count ?? 0);
  const archivedCount = Number(intentionStats?.archived_count ?? 0);
  const activeDays = Number(activityDays?.active_days ?? 0);

  /** Action (A) : intentions terminées ou archivées (export / passerelle) / volume — les ARCHIVED comptent comme « traitées ». */
  const actionRatio = volume > 0 ? (doneCount + archivedCount) / volume : 0;
  const archivedRatio = volume > 0 ? archivedCount / volume : 0;
  const engagementRatio = activeDays / LOOKBACK_DAYS;

  return {
    lookbackDays: LOOKBACK_DAYS,
    volume,
    actionRatio: round4(clamp01(actionRatio)),
    engagementRatio: round4(clamp01(engagementRatio)),
    doneCount,
    archivedCount,
    archivedRatio: round4(clamp01(archivedRatio)),
    activeDays: Math.max(0, Math.min(LOOKBACK_DAYS, activeDays)),
  };
}

/** Seuil d’accès à l’écran Statistiques : volume d’intentions (V) et jours actifs (E) sur la fenêtre courante. */
export async function canShowStats(nowMs: number = Date.now()): Promise<boolean> {
  const vae = await calculateUserVAE(nowMs);
  return vae.volume >= 5 && vae.activeDays >= 2;
}

export async function listActiveDayKeys(daysCount: number = LOOKBACK_DAYS, nowMs: number = Date.now()): Promise<string[]> {
  await initTrankilV2Schema();
  const db = await getDb();
  const safeDays = Number.isFinite(daysCount) ? Math.max(1, Math.round(daysCount)) : LOOKBACK_DAYS;
  const startMs = nowMs - safeDays * 24 * 60 * 60 * 1000;
  const rows = await db.getAllAsync<ActivityDayRow>(
    `SELECT DISTINCT day_key
     FROM user_activity_logs
     WHERE created_at >= ?
     ORDER BY day_key ASC`,
    [startMs],
  );
  return rows.map((row) => String(row.day_key || '').trim()).filter(Boolean);
}

/** One value per day: total logged actions that day (aligned with `buildTrendDayKeys`). */
export async function getDailyActivityCountsSeries(
  daysCount: number = LOOKBACK_DAYS,
  nowMs: number = Date.now(),
): Promise<number[]> {
  const keys = buildTrendDayKeys(daysCount, nowMs);
  if (keys.length === 0) return [];
  await initTrankilV2Schema();
  const db = await getDb();
  const startKey = keys[0];
  const rows = await db.getAllAsync<{ day_key: string; cnt: number }>(
    `SELECT day_key, COUNT(*) AS cnt
     FROM user_activity_logs
     WHERE day_key >= ?
     GROUP BY day_key`,
    [startKey],
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    const k = String(row.day_key || '').trim();
    if (k) map.set(k, Number(row.cnt) || 0);
  }
  return keys.map((k) => map.get(k) ?? 0);
}

export async function getUserProfile(nowMs: number = Date.now()): Promise<UserProfile> {
  const vae = await calculateUserVAE(nowMs);
  const { actionRatio: A, engagementRatio: E, archivedRatio } = vae;

  // Priority rule: orchestration/export behavior should override other clusters.
  let id = 5;
  if (archivedRatio > 0.5) {
    id = 4;
  } else if (A < 0.3 && E > 0.6) {
    id = 1;
  } else if (A < 0.3 && E < 0.4) {
    id = 2;
  } else if (A > 0.7 && E < 0.5) {
    id = 3;
  } else if (A > 0.6 && E > 0.7) {
    id = 5;
  }

  const fallback = PROFILE_FALLBACKS[id];
  const label = i18n.t(`profiling.profiles.${id}.label`, {
    defaultValue: fallback.label,
  });
  const description = i18n.t(`profiling.profiles.${id}.description`, {
    defaultValue: fallback.description,
  });
  return { id, label, description };
}

export function getKindnessBones(profileId: number, language: string, name?: string): KindnessBones {
  const safeId = PROFILE_FALLBACKS[profileId] ? profileId : 5;
  const fallback = KINDNESS_FALLBACKS[safeId];
  const lng = String(language || '').trim() || i18n.language || 'en';
  const variantIndex = Math.floor(Math.random() * 3);
  const safeName = String(name || '').trim() || i18n.t('profiling.kindness.defaultName', {
    lng,
    defaultValue: lng.startsWith('fr') ? 'toi' : 'you',
  });

  const insight = i18n.t(`profiling.kindness.${safeId}.insight.${variantIndex}`, {
    lng,
    name: safeName,
    defaultValue: fallback.insight,
  });
  const action_tip = i18n.t(`profiling.kindness.${safeId}.action_tip.${variantIndex}`, {
    lng,
    name: safeName,
    defaultValue: fallback.action_tip,
  });
  return { insight, action_tip };
}
