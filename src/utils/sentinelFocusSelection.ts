import type { TrankilV2TimelineItemRow } from '../api';
import { hubItemSortKey } from '../features/livingHub/formatHubItemLine';
import { parseRowTemporalMeta } from '../features/livingHub/parseRowTemporalMeta';
import { hasTripPromiseValidated } from '../services/traffic/sentinelElasticTripMetadata';
import { isTripAllDay, parseTripArrivalIso } from './tripElasticDisplay';
import {
  resolveTripTimelineCapsuleBundle,
  type TripElasticCapsuleModel,
} from './tripElasticCapsuleModel';
import { getTripMetaFromRoot } from './tripTimelineCard';
import { isTripMissionActive, isTripReadyForScan } from './tripTripReadiness';

export type SentinelFocusPick = {
  /** Trajet éligible au micro-dashboard (promesse P1 + fenêtre capsule). */
  microDashboardTrip: TrankilV2TimelineItemRow | null;
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

function normalizeHm(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function extractHmFromIso(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
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

export function readTripContext(row: TrankilV2TimelineItemRow) {
  const meta = safeParseMeta(row.metadata_json);
  const trip = getTripMetaFromRoot(meta);
  return { meta, trip };
}

/** Candidat micro-dashboard : promesse P1 validée + bundle capsule (fenêtre élastique). */
export function isSentinelMicroDashboardCandidate(input: {
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
  if (!hasTripPromiseValidated(trip)) return false;
  return Boolean(
    resolveTripTimelineCapsuleBundle({
      meta,
      trip,
      dueDate: row.due_date,
      locale,
      remindToLeave: true,
      isProUser: true,
    }),
  );
}

export function resolveSentinelMicroDashboardBundle(
  row: TrankilV2TimelineItemRow,
  locale: string,
  isProUser: boolean,
): TripElasticCapsuleModel | null {
  const { meta, trip } = readTripContext(row);
  if (!trip) return null;
  return resolveTripTimelineCapsuleBundle({
    meta,
    trip,
    dueDate: row.due_date,
    locale,
    remindToLeave: Boolean(row.remind_to_leave),
    isProUser,
  });
}

/** Éphémère strict : visible uniquement tant que `nowMs < endMs`. */
export function isSentinelMicroDashboardEphemeral(nowMs: number, bundle: TripElasticCapsuleModel): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(bundle.endMs)) return false;
  return nowMs < bundle.endMs;
}

/** Heure d’arrivée affichée (ex. `12h30`). */
export function resolveSentinelTripArrivalDisplayHm(row: TrankilV2TimelineItemRow): string | null {
  const temporal = parseRowTemporalMeta(row);
  const hm = temporal.dueTimeHm;
  if (hm) {
    const [h, m] = hm.split(':');
    return `${h}h${m}`;
  }
  const { meta, trip } = readTripContext(row);
  const isoHm =
    extractHmFromIso(str(trip, 'arrivalDue')) ??
    extractHmFromIso(str(trip, 'dueDateTime')) ??
    extractHmFromIso(str(meta, 'dueDateTime')) ??
    extractHmFromIso(row.due_date);
  if (!isoHm) return null;
  const [h, m] = isoHm.split(':');
  return `${h}h${m}`;
}

/** Timestamp ms de l’heure d’arrivée souhaitée (`arrivalDue` / équivalents). */
export function resolveTripArrivalDueMs(row: TrankilV2TimelineItemRow): number | null {
  const { meta, trip } = readTripContext(row);
  const iso = parseTripArrivalIso(meta, trip, row.due_date);
  if (iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  const temporal = parseRowTemporalMeta(row);
  const hm = temporal.dueTimeHm;
  if (!hm) return null;
  const ymd =
    normalizeDueYmd(row.due_date) ??
    normalizeDueYmd(str(trip, 'dueDateYmd')) ??
    normalizeDueYmd(str(meta, 'dueDateYmd')) ??
    normalizeDueYmd(iso ?? undefined);
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  const [hh, mm] = hm.split(':').map((n) => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

/** Suggestion encore pertinente : l’anticipation n’est possible qu’avant l’heure d’arrivée. */
export function isSentinelSuggestionFresh(row: TrankilV2TimelineItemRow, nowMs: number): boolean {
  const arrivalMs = resolveTripArrivalDueMs(row);
  if (arrivalMs == null || !Number.isFinite(nowMs)) return false;
  return nowMs < arrivalMs;
}

/** Candidat suggestion (hors fraîcheur temporelle). */
export function isSentinelFocusSuggestionCandidate(input: {
  row: TrankilV2TimelineItemRow;
  todayYmd: string;
}): boolean {
  const { row, todayYmd } = input;
  if (!isTripTimelineRow(row) || !isRowDueOnYmd(row, todayYmd)) return false;
  const { meta, trip } = readTripContext(row);
  if (!trip || isTripAllDay(meta, trip, row.due_date)) return false;
  if (Boolean(row.remind_to_leave)) return false;
  if (hasTripPromiseValidated(trip)) return false;
  if (!isTripReadyForScan({ meta, trip, dueDate: row.due_date })) return false;
  return true;
}

/** Trajet du jour éligible à la suggestion (non configuré + arrivée encore dans le futur). */
export function isSentinelFocusUnconfiguredTrip(input: {
  row: TrankilV2TimelineItemRow;
  todayYmd: string;
  isProUser: boolean;
  nowMs: number;
}): boolean {
  const { row, todayYmd, nowMs } = input;
  if (!isSentinelFocusSuggestionCandidate({ row, todayYmd })) return false;
  return isSentinelSuggestionFresh(row, nowMs);
}

function microUrgencyEndMs(row: TrankilV2TimelineItemRow, locale: string): number {
  const bundle = resolveSentinelMicroDashboardBundle(row, locale, true);
  return bundle?.endMs ?? Number.POSITIVE_INFINITY;
}

/** Slot visible Timeline : micro éphémère OU suggestion encore fraîche. */
export function isSentinelFocusSlotVisible(
  pick: SentinelFocusPick,
  options: { locale: string; isProUser: boolean; nowMs: number; todayYmd: string },
): boolean {
  if (
    pick.unconfiguredTrip &&
    isSentinelSuggestionFresh(pick.unconfiguredTrip, options.nowMs)
  ) {
    return true;
  }
  const row = pick.microDashboardTrip;
  if (!row) return false;
  const bundle = resolveSentinelMicroDashboardBundle(row, options.locale, options.isProUser);
  if (!bundle) return false;
  return isSentinelMicroDashboardEphemeral(options.nowMs, bundle);
}

/** Au moins un trajet du jour peut alimenter le badge (horloge / recompute). */
export function hasSentinelFocusClockInterest(
  rows: TrankilV2TimelineItemRow[],
  options: { todayYmd: string; isProUser: boolean; locale: string },
): boolean {
  const todayTrips = rows.filter((r) => isTripTimelineRow(r) && isRowDueOnYmd(r, options.todayYmd));
  return todayTrips.some(
    (r) =>
      isSentinelMicroDashboardCandidate({ row: r, isProUser: options.isProUser, locale: options.locale }) ||
      isSentinelFocusSuggestionCandidate({ row: r, todayYmd: options.todayYmd }),
  );
}

/** Sélection unique : micro-dashboard éphémère, sinon suggestion. */
export function pickSentinelFocus(
  rows: TrankilV2TimelineItemRow[],
  options: {
    todayYmd: string;
    isProUser: boolean;
    locale: string;
    nowMs: number;
  },
): SentinelFocusPick {
  const { todayYmd, isProUser, locale, nowMs } = options;
  const todayTrips = rows.filter((r) => isTripTimelineRow(r) && isRowDueOnYmd(r, todayYmd));

  const microCandidates = todayTrips.filter((r) =>
    isSentinelMicroDashboardCandidate({ row: r, isProUser, locale }),
  );
  const microDashboardTrip =
    microCandidates.length > 0
      ? [...microCandidates].sort((a, b) => microUrgencyEndMs(a, locale) - microUrgencyEndMs(b, locale))[0]
      : null;

  const unconfiguredCandidates = todayTrips
    .filter((r) => isSentinelFocusUnconfiguredTrip({ row: r, todayYmd, isProUser, nowMs }))
    .sort((a, b) => hubItemSortKey(a).localeCompare(hubItemSortKey(b)));

  return {
    microDashboardTrip,
    unconfiguredTrip: unconfiguredCandidates[0] ?? null,
  };
}

/** Heure d’affichage pour la carte suggestion (HH:MM). */
export function resolveSentinelFocusPromptTimeHm(row: TrankilV2TimelineItemRow): string | null {
  const temporal = parseRowTemporalMeta(row);
  return temporal.dueTimeHm;
}
