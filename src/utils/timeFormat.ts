import type { TFunction } from 'i18next';

import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';

export function createdYmdFromMs(createdAtMs: number): string | null {
  const createdAt = new Date(createdAtMs);
  if (!Number.isFinite(createdAt.getTime())) return null;
  return formatYmdLocal(createdAt);
}

/** Orpheline sans échéance : visible dans la section « Aujourd'hui » uniquement si créée ce jour-là. */
export function shouldShowUndatedOrphanInTodayView(createdAtMs: number, todayYmd: string): boolean {
  const createdYmd = createdYmdFromMs(createdAtMs);
  if (!createdYmd || !todayYmd) return false;
  return createdYmd === todayYmd;
}

export function formatCreationSubtitle(
  createdAtMs: number,
  t: TFunction,
  locale: string,
  now: Date = new Date(),
): string {
  const createdAt = new Date(createdAtMs);
  if (!Number.isFinite(createdAt.getTime())) return '';

  const loc = locale || Intl.DateTimeFormat().resolvedOptions().locale;
  const todayYmd = formatYmdLocal(now);
  const yesterdayYmd = addDaysYmd(now, -1);
  const createdYmd = formatYmdLocal(createdAt);

  const time = new Intl.DateTimeFormat(loc, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(createdAt);

  if (createdYmd === todayYmd) {
    return t('timeline.createdTodayAt', { time });
  }
  if (createdYmd === yesterdayYmd) {
    return t('timeline.createdYesterdayAt', { time });
  }

  const date = new Intl.DateTimeFormat(loc, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(createdAt);

  return t('timeline.createdOn', { date, time });
}
