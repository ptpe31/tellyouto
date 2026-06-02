import {
  hasTripStandardDurationMin,
  isTripAllDay,
  resolveElasticSlotDisplay,
  type ElasticSlotDisplay,
} from './tripElasticDisplay';
import { isTripMissionActive } from './tripTripReadiness';

export type TripElasticCapsuleModel = {
  startMs: number;
  endMs: number;
  ratioD: number;
};

/** Marge avant la borne max de la barre : alarme prédéfinie à 20 % de la fenêtre avant `endMs`. */
export const ELASTIC_DEPARTURE_ALARM_LEAD_RATIO = 0.2;

/** Horodatage ms de l’alarme prédéfinie (80 % de la fenêtre start→end, soit 20 % avant `endMs`). */
export function resolveElasticDepartureAlarmMs(startMs: number, endMs: number): number | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;
  return Math.round(endMs - ELASTIC_DEPARTURE_ALARM_LEAD_RATIO * (endMs - startMs));
}

/** Timestamp Unix (s) pour `AlarmService.openAlarmSelection`. */
export function resolveElasticDepartureAlarmUnixSec(startMs: number, endMs: number): number | null {
  const ms = resolveElasticDepartureAlarmMs(startMs, endMs);
  if (ms == null || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Métadonnées du contrat de départ persistées (PROBE1+). */
export function hasElasticContractMetadata(trip: Record<string, unknown> | null | undefined): boolean {
  if (!trip || !hasTripStandardDurationMin(trip)) return false;
  const start = Number(trip.elastic_anchor_start_ms ?? trip.elastic_start_ms);
  const end = Number(trip.elastic_anchor_end_ms ?? trip.elastic_end_ms);
  return Number.isFinite(start) && Number.isFinite(end) && start < end;
}

export function readTripSentinelMode(trip: Record<string, unknown> | null | undefined): 'SENTINEL' | 'STATIC' {
  const raw = String(trip?.sentinel_mode ?? trip?.sentinelMode ?? 'SENTINEL').trim().toUpperCase();
  return raw === 'STATIC' ? 'STATIC' : 'SENTINEL';
}

/** Surveillance active + mode Sentinel ou contrat élastique en base. */
export function isTripTimelineCapsuleEligible(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
  remindToLeave: boolean;
  isProUser: boolean;
}): boolean {
  const { meta, trip, dueDate, remindToLeave, isProUser } = input;
  if (!isProUser || !trip || isTripAllDay(meta, trip, dueDate)) return false;
  if (!remindToLeave) return false;
  if (!isTripMissionActive({ remindToLeave, meta, trip, dueDate })) return false;
  if (readTripSentinelMode(trip) === 'SENTINEL') return true;
  return hasElasticContractMetadata(trip);
}

export function resolveTripElasticCapsuleModel(input: {
  trip: Record<string, unknown> | null;
  elasticSlotDisplay: ElasticSlotDisplay | null;
}): TripElasticCapsuleModel | null {
  const { trip, elasticSlotDisplay } = input;
  const window = elasticSlotDisplay?.window;
  if (!trip || !window) return null;

  const anchorStart = Number(
    trip.elastic_anchor_start_ms ?? trip.displayedTOptimisteMs ?? trip.displayed_t_optimiste_ms,
  );
  const anchorEnd = Number(
    trip.elastic_anchor_end_ms ?? trip.displayedTPessimisteMs ?? trip.displayed_t_pessimiste_ms,
  );
  const startMs =
    Number.isFinite(anchorStart) && anchorStart > 0 ? anchorStart : window.startDate.getTime();
  const endMs = Number.isFinite(anchorEnd) && anchorEnd > 0 ? anchorEnd : window.endDate.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;

  const ratioRaw = Number(trip.elastic_degradation_ratio);
  const ratioD = Number.isFinite(ratioRaw) && ratioRaw > 0 ? ratioRaw : 1;

  return { startMs, endMs, ratioD };
}

export function resolveTripTimelineCapsuleBundle(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
  locale: string;
  remindToLeave: boolean;
  isProUser: boolean;
}): TripElasticCapsuleModel | null {
  if (!isTripTimelineCapsuleEligible(input)) return null;
  const slot = resolveElasticSlotDisplay({
    meta: input.meta,
    trip: input.trip,
    dueDate: input.dueDate,
    locale: input.locale,
  });
  if (!slot.window) return null;
  return resolveTripElasticCapsuleModel({ trip: input.trip, elasticSlotDisplay: slot });
}

export function resolveTripNavigationDestination(
  trip: Record<string, unknown> | null,
  meta: Record<string, unknown> | null,
  displayTitle?: string | null,
): string {
  const fromTrip =
    str(trip, 'location_address') ??
    str(trip, 'destination_name') ??
    str(trip, 'destination') ??
    str(trip, 'destinationName');
  if (fromTrip) return fromTrip;
  const fromMeta = str(meta, 'location_address');
  if (fromMeta) return fromMeta;
  return String(displayTitle ?? '').trim();
}

/** Libellé lieu pour l’alarme réveil (alias destination, pas l’adresse complète). */
export function resolveTripAlarmPlaceLabel(
  trip: Record<string, unknown> | null,
  displayTitle?: string | null,
  fallback = '',
): string {
  const fromTrip =
    str(trip, 'destination') ?? str(trip, 'destination_name') ?? str(trip, 'destinationName');
  if (fromTrip) return fromTrip;
  const title = String(displayTitle ?? '').trim();
  return title || fallback;
}
