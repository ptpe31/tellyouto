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
  /** Trajet éligible au micro-dashboard (promesse P1 + fenêtre capsule), non expiré. */
  microDashboardTrip: TrankilV2TimelineItemRow | null;
  /** Premier candidat suggestion trouvé par la cascade glissante chronologique. */
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

/** Trajet déjà traité (surveillance ON ou promesse P1) — exclu de la cascade suggestion. */
export function isSentinelTripConfigured(row: TrankilV2TimelineItemRow): boolean {
  const { trip } = readTripContext(row);
  return Boolean(row.remind_to_leave) || Boolean(trip && hasTripPromiseValidated(trip));
}

/** Tri chronologique strict : arrivée souhaitée la plus ancienne en premier. */
export function sortTodayTripsByArrivalChronology(
  rows: TrankilV2TimelineItemRow[],
  todayYmd: string,
): TrankilV2TimelineItemRow[] {
  const todayTrips = rows.filter((r) => isTripTimelineRow(r) && isRowDueOnYmd(r, todayYmd));
  return [...todayTrips].sort((a, b) => {
    const ma = resolveTripArrivalDueMs(a);
    const mb = resolveTripArrivalDueMs(b);
    const aKey = ma ?? Number.POSITIVE_INFINITY;
    const bKey = mb ?? Number.POSITIVE_INFINITY;
    if (aKey !== bKey) return aKey - bKey;
    return hubItemSortKey(a).localeCompare(hubItemSortKey(b));
  });
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

/** Candidat suggestion (hors fraîcheur temporelle et hors cascade). */
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

/** Trajet du jour éligible à la suggestion (cascade glissante, une ligne). */
export function isSentinelFocusUnconfiguredTrip(input: {
  row: TrankilV2TimelineItemRow;
  todayYmd: string;
  isProUser: boolean;
  nowMs: number;
}): boolean {
  const { row, todayYmd, nowMs } = input;
  if (!isSentinelSuggestionFresh(row, nowMs)) return false;
  if (isSentinelTripConfigured(row)) return false;
  return isSentinelFocusSuggestionCandidate({ row, todayYmd });
}

function microUrgencyEndMs(row: TrankilV2TimelineItemRow, locale: string, isProUser: boolean): number {
  const bundle = resolveSentinelMicroDashboardBundle(row, locale, isProUser);
  return bundle?.endMs ?? Number.POSITIVE_INFINITY;
}

/**
 * Priorité 1 — scan actif non expiré.
 * Parmi les micros valides, le plus urgent = plus petite `endMs`.
 */
function pickActiveMicroDashboardTrip(
  sortedTodayTrips: TrankilV2TimelineItemRow[],
  options: { isProUser: boolean; locale: string; nowMs: number },
): TrankilV2TimelineItemRow | null {
  const { isProUser, locale, nowMs } = options;
  const active = sortedTodayTrips
    .filter((r) => isSentinelMicroDashboardCandidate({ row: r, isProUser, locale }))
    .filter((r) => {
      const bundle = resolveSentinelMicroDashboardBundle(r, locale, isProUser);
      return bundle != null && isSentinelMicroDashboardEphemeral(nowMs, bundle);
    })
    .sort((a, b) => microUrgencyEndMs(a, locale, isProUser) - microUrgencyEndMs(b, locale, isProUser));

  return active[0] ?? null;
}

/**
 * Priorité 2 — cascade glissante chronologique (État B).
 * Parcourt la liste triée ; élimine passé, configuré ; premier prêt au scan gagne.
 */
function pickSlidingSuggestionTrip(
  sortedTodayTrips: TrankilV2TimelineItemRow[],
  options: { todayYmd: string; nowMs: number },
): TrankilV2TimelineItemRow | null {
  const { todayYmd, nowMs } = options;

  for (const row of sortedTodayTrips) {
    if (!isSentinelSuggestionFresh(row, nowMs)) continue;
    if (isSentinelTripConfigured(row)) continue;
    if (!isSentinelFocusSuggestionCandidate({ row, todayYmd })) continue;
    return row;
  }

  return null;
}

/** Slot visible Timeline — miroir exact du pick séquentiel. */
export function isSentinelFocusSlotVisible(
  pick: SentinelFocusPick,
  options: { locale: string; isProUser: boolean; nowMs: number; todayYmd: string },
): boolean {
  const micro = pick.microDashboardTrip;
  if (micro) {
    const bundle = resolveSentinelMicroDashboardBundle(micro, options.locale, options.isProUser);
    if (bundle && isSentinelMicroDashboardEphemeral(options.nowMs, bundle)) return true;
  }
  if (pick.unconfiguredTrip) {
    return isSentinelSuggestionFresh(pick.unconfiguredTrip, options.nowMs);
  }
  return false;
}

/** Au moins un trajet du jour peut alimenter le badge (horloge / recompute). */
export function hasSentinelFocusClockInterest(
  rows: TrankilV2TimelineItemRow[],
  options: { todayYmd: string; isProUser: boolean; locale: string },
): boolean {
  const sorted = sortTodayTripsByArrivalChronology(rows, options.todayYmd);
  const nowMs = Date.now();

  if (pickActiveMicroDashboardTrip(sorted, { ...options, nowMs })) return true;

  if (pickSlidingSuggestionTrip(sorted, { todayYmd: options.todayYmd, nowMs })) return true;

  return sorted.some((r) => {
    if (isSentinelMicroDashboardCandidate({ row: r, isProUser: options.isProUser, locale: options.locale })) {
      return true;
    }
    const arrivalMs = resolveTripArrivalDueMs(r);
    return (
      isSentinelFocusSuggestionCandidate({ row: r, todayYmd: options.todayYmd }) &&
      arrivalMs != null &&
      nowMs < arrivalMs
    );
  });
}

/**
 * Séquenceur glissant : micro actif (Priorité 1) sinon cascade suggestion (Priorité 2).
 * Les micros expirés (`nowMs >= endMs`) ne bloquent plus la suggestion suivante.
 */
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
  const sortedTodayTrips = sortTodayTripsByArrivalChronology(rows, todayYmd);

  const microDashboardTrip = pickActiveMicroDashboardTrip(sortedTodayTrips, { isProUser, locale, nowMs });

  const unconfiguredTrip = microDashboardTrip
    ? null
    : pickSlidingSuggestionTrip(sortedTodayTrips, { todayYmd, nowMs });

  return {
    microDashboardTrip,
    unconfiguredTrip,
  };
}

/** Heure d’affichage pour la carte suggestion (HH:MM). */
export function resolveSentinelFocusPromptTimeHm(row: TrankilV2TimelineItemRow): string | null {
  const temporal = parseRowTemporalMeta(row);
  return temporal.dueTimeHm;
}
