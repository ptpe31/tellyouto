import type { SentinelTripComfortSnapshot } from '../services/traffic/sentinelTripComfort';
import {
  hasNewtonFirstScanRecorded,
  realTravelDurationSec,
  standardTravelDurationSec,
} from '../services/traffic/sentinelTripComfort';

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

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseArrivalMs(meta: Record<string, unknown> | null, trip: Record<string, unknown> | null, dueDate: string | null): number | null {
  const iso =
    str(trip, 'arrivalDue') ??
    str(trip, 'dueDateTime') ??
    str(meta, 'dueDateTime') ??
    (dueDate ? String(dueDate).trim() : null);
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function formatHmFromMs(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

export type TripTimelineFooter =
  | { kind: 'setup' }
  | { kind: 'trafficLive'; minutes: number }
  | { kind: 'trafficConfigured' }
  | { kind: 'estimatedDeparture'; label: string };

export function resolveTripTimelineFooter(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
  sentinel: SentinelTripComfortSnapshot | null;
  locale: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): TripTimelineFooter | null {
  const { meta, trip, dueDate, sentinel, locale, t } = input;
  if (!trip) return null;

  if (!isPass2UnlockedMeta(meta)) {
    return { kind: 'setup' };
  }

  const metaTraffic = Number(trip.last_traffic_duration);
  const metaTrafficSec = Number.isFinite(metaTraffic) && metaTraffic > 0 ? metaTraffic : null;
  const liveSec = realTravelDurationSec(sentinel) ?? metaTrafficSec;

  if (hasNewtonFirstScanRecorded(sentinel)) {
    if (liveSec != null && liveSec > 0) {
      return { kind: 'trafficLive', minutes: Math.max(1, Math.round(liveSec / 60)) };
    }
    return { kind: 'trafficConfigured' };
  }

  const tOpt = sentinel?.displayedTOptimisteMs;
  const tPess = sentinel?.displayedTPessimisteMs;
  if (
    tOpt != null &&
    tPess != null &&
    Number.isFinite(tOpt) &&
    Number.isFinite(tPess) &&
    tOpt > 0 &&
    tPess >= tOpt
  ) {
    const start = formatHmFromMs(tOpt, locale);
    const end = formatHmFromMs(tPess, locale);
    return {
      kind: 'estimatedDeparture',
      label: t('timeline.estimatedDepartureWindow', { start, end }),
    };
  }

  const arrivalMs = parseArrivalMs(meta, trip, dueDate);
  const standardSec = standardTravelDurationSec(sentinel);
  if (arrivalMs != null && standardSec != null && standardSec > 0) {
    const depMs = arrivalMs - standardSec * 1000;
    if (Number.isFinite(depMs)) {
      const time = formatHmFromMs(depMs, locale);
      return {
        kind: 'estimatedDeparture',
        label: t('timeline.estimatedDepartureSingle', { time }),
      };
    }
  }

  return { kind: 'estimatedDeparture', label: t('timeline.estimatedDeparturePending') };
}
