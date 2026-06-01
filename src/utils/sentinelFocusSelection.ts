import type { TrankilV2TimelineItemRow } from '../api';
import { hubItemSortKey } from '../features/livingHub/formatHubItemLine';
import { parseRowTemporalMeta } from '../features/livingHub/parseRowTemporalMeta';
import { hasTripPromiseValidated } from '../services/traffic/sentinelElasticTripMetadata';
import { isTripAllDay } from './tripElasticDisplay';
import { resolveTripTimelineCapsuleBundle } from './tripElasticCapsuleModel';
import { getTripMetaFromRoot } from './tripTimelineCard';
import { isTripMissionActive, isTripReadyForScan } from './tripTripReadiness';

export type SentinelFocusPick = {
  activeTrip: TrankilV2TimelineItemRow | null;
  unconfiguredTrip: TrankilV2TimelineItemRow | null;
};

function safeParseMeta(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeDueYmd(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function isTripTimelineRow(row: TrankilV2TimelineItemRow): boolean {
  const meta = safeParseMeta(row.metadata_json);
  if (getTripMetaFromRoot(meta)) return true;
  return String(row.type ?? '').trim().toUpperCase() === 'TRIP';
}

export function isRowDueOnYmd(row: TrankilV2TimelineItemRow, ymd: string): boolean {
  const fromDue = normalizeDueYmd(row.due_date);
  if (fromDue === ymd) return true;
  const meta = safeParseMeta(row.metadata_json);
  const trip = getTripMetaFromRoot(meta);
  const tripYmd = normalizeDueYmd(str(trip, 'dueDateYmd')) ?? normalizeDueYmd(str(meta, 'dueDateYmd'));
  if (tripYmd === ymd) return true;
  const iso = str(trip, 'arrivalDue') ?? str(trip, 'dueDateTime') ?? str(meta, 'dueDateTime');
  return normalizeDueYmd(iso) === ymd;
}

function readTripContext(row: TrankilV2TimelineItemRow) {
  const meta = safeParseMeta(row.metadata_json);
  const trip = getTripMetaFromRoot(meta);
  return { meta, trip };
}

/** Scan Sentinel actif : capsule visible ou promesse P1 validée avec mission ON. */
export function isSentinelFocusActiveTrip(input: {
  row: TrankilV2TimelineItemRow;
  isProUser: boolean;
  locale: string;
}): boolean {
  const { row, isProUser, locale } = input;
  if (!isProUser || !isTripTimelineRow(row)) return false;
  const { meta, trip } = readTripContext(row);
  if (!trip || isTripAllDay(meta, trip, row.due_date)) return false;
  if (!Boolean(row.remind_to_leave)) return false;
  if (!isTripMissionActive({ remindToLeave: true, meta, trip, dueDate: row.due_date })) return false;

  if (resolveTripTimelineCapsuleBundle({
    meta,
    trip,
    dueDate: row.due_date,
    locale,
    remindToLeave: true,
    isProUser: true,
  })) {
    return true;
  }

  return hasTripPromiseValidated(trip);
}

/** Trajet du jour éligible à l’incitation « Me prévenir quand partir » (rappel pas encore activé). */
export function isSentinelFocusUnconfiguredTrip(input: {
  row: TrankilV2TimelineItemRow;
  todayYmd: string;
  isProUser: boolean;
}): boolean {
  const { row, todayYmd, isProUser } = input;
  if (!isTripTimelineRow(row) || !isRowDueOnYmd(row, todayYmd)) return false;
  const { meta, trip } = readTripContext(row);
  if (!trip || isTripAllDay(meta, trip, row.due_date)) return false;
  if (Boolean(row.remind_to_leave)) return false;
  if (!isTripReadyForScan({ meta, trip, dueDate: row.due_date })) return false;
  if (!isProUser) return true;
  return true;
}

function activeUrgencyMs(row: TrankilV2TimelineItemRow, locale: string): number {
  const { meta, trip } = readTripContext(row);
  if (!trip) return Number.POSITIVE_INFINITY;
  const bundle = resolveTripTimelineCapsuleBundle({
    meta,
    trip,
    dueDate: row.due_date,
    locale,
    remindToLeave: true,
    isProUser: true,
  });
  if (bundle) return bundle.endMs;
  const validated = Number(trip.promise_validated_at);
  if (Number.isFinite(validated) && validated > 0) return validated;
  return Number.POSITIVE_INFINITY;
}

/** Sélection unique : un trajet actif, sinon une suggestion de configuration. */
export function pickSentinelFocus(
  rows: TrankilV2TimelineItemRow[],
  options: {
    todayYmd: string;
    isProUser: boolean;
    locale: string;
  },
): SentinelFocusPick {
  const { todayYmd, isProUser, locale } = options;
  const todayTrips = rows.filter((r) => isTripTimelineRow(r) && isRowDueOnYmd(r, todayYmd));

  const activeCandidates = todayTrips.filter((r) =>
    isSentinelFocusActiveTrip({ row: r, isProUser, locale }),
  );
  if (activeCandidates.length > 0) {
    const activeTrip = [...activeCandidates].sort(
      (a, b) => activeUrgencyMs(a, locale) - activeUrgencyMs(b, locale),
    )[0];
    return { activeTrip, unconfiguredTrip: null };
  }

  const unconfiguredCandidates = todayTrips
    .filter((r) => isSentinelFocusUnconfiguredTrip({ row: r, todayYmd, isProUser }))
    .sort((a, b) => hubItemSortKey(a).localeCompare(hubItemSortKey(b)));

  return {
    activeTrip: null,
    unconfiguredTrip: unconfiguredCandidates[0] ?? null,
  };
}

/** Heure d’affichage pour la carte suggestion (HH:MM). */
export function resolveSentinelFocusPromptTimeHm(row: TrankilV2TimelineItemRow): string | null {
  const temporal = parseRowTemporalMeta(row);
  return temporal.dueTimeHm;
}
