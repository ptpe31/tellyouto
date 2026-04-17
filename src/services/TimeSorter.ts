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

export function computeDueDateForHorizon(
  horizon: TimeHorizonKey,
  now: Date = new Date(),
): string | null {
  if (horizon === 'TODAY') return formatYmdLocal(now);
  if (horizon === 'TOMORROW') return addDaysYmd(now, 1);
  return null;
}

function safeDate(year: number, month1to12: number, day: number): Date {
  const month = Math.max(1, Math.min(12, month1to12)) - 1;
  const maxDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.max(1, Math.min(maxDay, day));
  return new Date(year, month, safeDay, 12, 0, 0, 0);
}

export function extractMonthDay(value: string | null | undefined): { month: number; day: number } | null {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

export function computeNextYearlyDueDateFromNativeDate(
  nativeDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const md = extractMonthDay(nativeDate);
  if (!md) return null;
  const thisYearDate = safeDate(now.getFullYear(), md.month, md.day);
  const currentRef = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  if (thisYearDate >= currentRef) {
    return formatYmdLocal(thisYearDate);
  }
  const nextYearDate = safeDate(now.getFullYear() + 1, md.month, md.day);
  return formatYmdLocal(nextYearDate);
}

export function hasAnniversaryKeyword(text: string): boolean {
  const raw = String(text || '');
  return /\b(birthday|anniversary|cumplea(?:n|ñ)os|aniversario|anniversaire)\b/iu.test(raw);
}

export function isAnniversaryPreparationText(text: string): boolean {
  const raw = String(text || '');
  return /\b(prepar(?:e|er|ing|ar)\w*|plan\w*|organ(?:ize|iser|izar)\w*)\b/iu.test(raw);
}

export function computePreparationDueDateFromText(text: string, now: Date = new Date()): string | null {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  if (/\b(next\s+month|mois\s+prochain|mes\s+que\s+viene)\b/iu.test(raw)) {
    const y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const m = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    return formatYmdLocal(new Date(y, m, 1, 12, 0, 0, 0));
  }
  return null;
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
