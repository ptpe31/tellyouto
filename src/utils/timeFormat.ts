import type { TFunction } from 'i18next';

import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';

function capitalizeFirst(value: string, locale?: string): string {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
}

/**
 * Libellé jour pour une échéance : Aujourd'hui / Demain / « mardi 16 juin » (locale).
 * Point unique pour Inbox L2, cartes Timeline et chip Studio.
 */
export function formatDueDayLabel(
  dueDate: Date,
  locale: string,
  t: TFunction,
  now: Date = new Date(),
): string {
  const loc = locale || Intl.DateTimeFormat().resolvedOptions().locale;
  const todayKey = formatYmdLocal(now);
  const tomorrowKey = addDaysYmd(now, 1);
  const dueKey = formatYmdLocal(dueDate);

  if (dueKey === todayKey) return t('horizons.today');
  if (dueKey === tomorrowKey) return t('horizons.tomorrow');

  return capitalizeFirst(
    new Intl.DateTimeFormat(loc, { weekday: 'long', month: 'short', day: '2-digit' }).format(dueDate),
    loc,
  );
}

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
