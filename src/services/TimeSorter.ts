import type { TrankilV2IntentionRow } from '../api/trankilV2Db';

export type TimeHorizonKey =
  | 'REARBITRATE'
  | 'TODAY'
  | 'TOMORROW'
  | 'WEEK'
  | 'NO_PRESSURE';

export const TIME_HORIZON_META: Record<TimeHorizonKey, { labelKey: string; emoji: string }> = {
  REARBITRATE: { labelKey: 'horizons.rearbitrate', emoji: '⌛' },
  TODAY: { labelKey: 'horizons.today', emoji: '☀️' },
  TOMORROW: { labelKey: 'horizons.tomorrow', emoji: '📅' },
  WEEK: { labelKey: 'horizons.thisWeek', emoji: '🗓️' },
  NO_PRESSURE: { labelKey: 'horizons.noPressure', emoji: '🌊' },
};

export function formatYmdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysYmd(base: Date, days: number): string {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return formatYmdLocal(next);
}

function isYmd(raw: string | null | undefined): raw is string {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{8}$/.test(value);
}

function normalizeYmd(raw: string): string {
  const value = raw.trim();
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value;
}

export function computeTimeHorizonFromDueDate(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): TimeHorizonKey {
  const today = formatYmdLocal(now);
  const tomorrow = addDaysYmd(now, 1);
  const weekLimit = addDaysYmd(now, 7);
  if (!isYmd(dueDate)) return 'NO_PRESSURE';
  const dd = normalizeYmd(dueDate);
  if (dd < today) return 'REARBITRATE';
  if (dd === today) return 'TODAY';
  if (dd === tomorrow) return 'TOMORROW';
  if (dd <= weekLimit) return 'WEEK';
  return 'NO_PRESSURE';
}

export function groupIntentionsByTimeHorizon(
  rows: TrankilV2IntentionRow[],
  now: Date = new Date(),
): Record<TimeHorizonKey, TrankilV2IntentionRow[]> {
  const out: Record<TimeHorizonKey, TrankilV2IntentionRow[]> = {
    REARBITRATE: [],
    TODAY: [],
    TOMORROW: [],
    WEEK: [],
    NO_PRESSURE: [],
  };
  for (const row of rows) {
    const horizon = computeTimeHorizonFromDueDate(row.due_date ?? null, now);
    out[horizon].push(row);
  }
  return out;
}
