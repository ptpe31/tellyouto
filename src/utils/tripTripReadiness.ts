import { isTripAllDay, parseTripArrivalIso } from './tripElasticDisplay';

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export type TripReadinessBlocker = 'destination' | 'arrival_time';

/** Coordonnée TRIP valide : finie, non nulle (évite Number(null) === 0). */
export function isValidTripCoord(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

export function readValidTripCoords(
  trip: Record<string, unknown> | null | undefined,
  latKey: string,
  lngKey: string,
): { lat: number | null; lng: number | null } {
  if (!trip) return { lat: null, lng: null };
  const lat = Number(trip[latKey]);
  const lng = Number(trip[lngKey]);
  if (!isValidTripCoord(lat) || !isValidTripCoord(lng)) return { lat: null, lng: null };
  return { lat, lng };
}

export function getTripReadinessBlockers(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
}): TripReadinessBlocker[] {
  const { meta, trip, dueDate } = input;
  const blockers: TripReadinessBlocker[] = [];
  if (!trip) return blockers;

  if (isTripAllDay(meta, trip, dueDate)) {
    blockers.push('arrival_time');
    return blockers;
  }

  const arrivalIso = parseTripArrivalIso(meta, trip, dueDate);
  if (!arrivalIso || !Number.isFinite(Date.parse(arrivalIso))) {
    blockers.push('arrival_time');
  }

  const placeId = str(trip, 'location_place_id');
  const address = str(trip, 'location_address') ?? str(meta, 'location_address');
  const { lat, lng } = readValidTripCoords(trip, 'location_lat', 'location_lng');
  if (!placeId || !address || lat == null || lng == null) {
    blockers.push('destination');
  }

  return blockers;
}

export function isTripReadyForScan(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
}): boolean {
  return getTripReadinessBlockers(input).length === 0;
}

/** Mission Sentinel active : remind ON + prérequis scan remplis. */
export function isTripMissionActive(input: {
  remindToLeave: boolean;
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
}): boolean {
  if (!input.remindToLeave) return false;
  return isTripReadyForScan(input);
}
