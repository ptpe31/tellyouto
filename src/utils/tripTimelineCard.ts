import { isTripAllDay, resolveElasticSlotDisplay } from './tripElasticDisplay';

const PASS2_UNLOCKED = 1;

export function isPass2UnlockedMeta(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const v = meta.pass2_unlocked;
  return v === PASS2_UNLOCKED || v === true;
}

export function getTripMetaFromRoot(meta: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!meta) return null;
  const t = meta.trip;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  return t as Record<string, unknown>;
}

export type TripTimelineFooter =
  | { kind: 'setup' }
  | { kind: 'allDay'; label: string }
  | { kind: 'elasticDeparture'; label: string; approximate?: boolean; shifted?: boolean };

export function resolveTripTimelineFooter(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
  locale: string;
  isProUser: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): TripTimelineFooter | null {
  const { meta, trip, dueDate, locale, isProUser, t } = input;
  if (!trip) return null;

  if (!isPass2UnlockedMeta(meta)) {
    return { kind: 'setup' };
  }

  if (isTripAllDay(meta, trip, dueDate)) {
    return { kind: 'allDay', label: t('timeline.tripAllDay') };
  }

  if (!isProUser) {
    return null;
  }

  const slot = resolveElasticSlotDisplay({ meta, trip, dueDate, locale });
  if (slot.windowLabel) {
    let labelKey = 'timeline.elasticDepartureWindow';
    if (slot.shifted) {
      labelKey = 'timeline.elasticDepartureShifted';
    } else if (slot.approximate) {
      labelKey = 'timeline.elasticDepartureApprox';
    }
    return {
      kind: 'elasticDeparture',
      label: t(labelKey, { window: slot.windowLabel }),
      approximate: slot.approximate,
      shifted: slot.shifted,
    };
  }

  return { kind: 'elasticDeparture', label: t('timeline.elasticDeparturePending') };
}
