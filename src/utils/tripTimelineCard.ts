import {
  hasTripStandardDurationMin,
  isTripAllDay,
  resolveElasticSlotDisplay,
} from './tripElasticDisplay';
import { resolveProbeScheduleLabel } from './tripProbeScheduleDisplay';
import { isTripMissionActive } from './tripTripReadiness';

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
  | { kind: 'lockedSetup' }
  | { kind: 'scanScheduled'; label: string }
  | { kind: 'elasticDeparture'; label: string; approximate?: boolean; shifted?: boolean };

export function resolveTripTimelineFooter(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
  locale: string;
  isProUser: boolean;
  remindToLeave: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Horloge locale pour basculer futur → « Scan en cours… ». */
  nowMs?: number;
}): TripTimelineFooter | null {
  const { meta, trip, dueDate, locale, isProUser, remindToLeave, t, nowMs } = input;
  if (!trip) return null;

  if (isTripAllDay(meta, trip, dueDate)) {
    return null;
  }

  if (!isProUser) {
    return { kind: 'lockedSetup' };
  }

  const missionActive = isTripMissionActive({ remindToLeave, meta, trip, dueDate });
  const probe1Done = hasTripStandardDurationMin(trip);

  if (probe1Done) {
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
  }

  if (missionActive && !probe1Done) {
    const nextProbeAtMs = Number(trip.next_probe_at_ms);
    const label = resolveProbeScheduleLabel({
      nextProbeAtMs: Number.isFinite(nextProbeAtMs) && nextProbeAtMs > 0 ? nextProbeAtMs : null,
      locale,
      nowMs,
      t,
    });
    return { kind: 'scanScheduled', label };
  }

  return { kind: 'setup' };
}
