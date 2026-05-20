import { getTrankilV2IntentionById, patchMetadata } from '../../api/trankilV2Db';
import { withSentinelDbRetry } from './sentinelDbRetry';
import {
  computeElasticBufferMin,
  computeElasticDepartureWindow,
  computeShiftedElasticWindow,
  ELASTIC_BUFFER_BASE_MIN,
  type ElasticDepartureWindow,
} from '../../utils/elasticSlotEngine';

export type TripElasticMetadataPatch = {
  standard_duration_min?: number;
  elastic_approximate?: boolean;
  elastic_shifted?: boolean;
  elastic_start_ms?: number;
  elastic_end_ms?: number;
  elastic_buffer_min?: number;
  origin_lat?: number;
  origin_lng?: number;
  origin_address?: string;
  last_traffic_duration?: number;
  next_probe_at_ms?: number | null;
  next_probe_reason?: string | null;
};

function safeParseTrip(metaJson: string | null | undefined): Record<string, unknown> | null {
  if (!metaJson) return null;
  try {
    const meta = JSON.parse(metaJson) as Record<string, unknown>;
    const trip = meta.trip;
    if (!trip || typeof trip !== 'object' || Array.isArray(trip)) return null;
    return trip as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function loadTripMetaForIntention(intentionId: string): Promise<Record<string, unknown> | null> {
  const row = await getTrankilV2IntentionById(intentionId);
  if (!row) return null;
  return safeParseTrip(row.metadata_json);
}

import { hasTripStandardDurationMin } from '../../utils/tripElasticDisplay';

export { hasTripStandardDurationMin };

export function readTripOriginCoords(trip: Record<string, unknown> | null | undefined): {
  lat: number | null;
  lng: number | null;
} {
  if (!trip) return { lat: null, lng: null };
  const lat = Number(trip.origin_lat);
  const lng = Number(trip.origin_lng);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

export function tripMetadataNeedsGpsCatchup(trip: Record<string, unknown> | null | undefined): boolean {
  const { lat, lng } = readTripOriginCoords(trip);
  return lat == null || lng == null;
}

export function elasticWindowToTripPatch(
  window: ElasticDepartureWindow,
  opts?: { approximate?: boolean; shifted?: boolean },
): TripElasticMetadataPatch {
  return {
    standard_duration_min: window.dStdMin,
    elastic_approximate: opts?.approximate ?? false,
    elastic_shifted: opts?.shifted ?? false,
    elastic_start_ms: window.startDate.getTime(),
    elastic_end_ms: window.endDate.getTime(),
    elastic_buffer_min: window.bufferMin,
  };
}

export function buildShiftedTripPatch(
  arrivalMs: number,
  dLiveMin: number,
  bufferMin: number,
  lastTrafficDurationSec: number,
): TripElasticMetadataPatch | null {
  const shifted = computeShiftedElasticWindow(arrivalMs, dLiveMin, bufferMin);
  if (!shifted) return null;
  return {
    ...elasticWindowToTripPatch(shifted, { approximate: false, shifted: true }),
    last_traffic_duration: lastTrafficDurationSec,
  };
}

export function computeTripElasticWindowFromMeta(
  arrivalMs: number,
  trip: Record<string, unknown> | null | undefined,
): ElasticDepartureWindow | null {
  if (!trip) return null;
  const storedStart = Number(trip.elastic_start_ms);
  const storedEnd = Number(trip.elastic_end_ms);
  const dStd = Number(trip.standard_duration_min);
  const buffer = Number(trip.elastic_buffer_min);
  if (
    Number.isFinite(storedStart) &&
    Number.isFinite(storedEnd) &&
    storedStart <= storedEnd &&
    Number.isFinite(dStd) &&
    dStd > 0
  ) {
    return {
      startDate: new Date(storedStart),
      endDate: new Date(storedEnd),
      bufferMin: Number.isFinite(buffer) && buffer > 0 ? buffer : computeElasticBufferMin(dStd) ?? ELASTIC_BUFFER_BASE_MIN,
      dStdMin: dStd,
    };
  }
  const dStdMin = hasTripStandardDurationMin(trip) ? dStd : null;
  if (dStdMin == null) return null;
  return computeElasticDepartureWindow(arrivalMs, dStdMin);
}

export async function syncTripProbeScheduleMetadata(
  intentionId: string,
  nextAtMs: number | null | undefined,
  reason: string | null | undefined,
): Promise<void> {
  const patch: TripElasticMetadataPatch = {
    next_probe_at_ms: nextAtMs ?? null,
    next_probe_reason: reason ?? null,
  };
  await withSentinelDbRetry(
    'syncTripProbeScheduleMetadata',
    intentionId,
    () => patchTripElasticMetadata(intentionId, patch),
  );
}

export async function patchTripElasticMetadata(
  intentionId: string,
  patch: TripElasticMetadataPatch,
): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  const tripPatch: Record<string, unknown> = {};
  if (patch.standard_duration_min != null) tripPatch.standard_duration_min = patch.standard_duration_min;
  if (patch.elastic_approximate != null) tripPatch.elastic_approximate = patch.elastic_approximate;
  if (patch.elastic_shifted != null) tripPatch.elastic_shifted = patch.elastic_shifted;
  if (patch.elastic_start_ms != null) tripPatch.elastic_start_ms = patch.elastic_start_ms;
  if (patch.elastic_end_ms != null) tripPatch.elastic_end_ms = patch.elastic_end_ms;
  if (patch.elastic_buffer_min != null) tripPatch.elastic_buffer_min = patch.elastic_buffer_min;
  if (patch.origin_lat != null) tripPatch.origin_lat = patch.origin_lat;
  if (patch.origin_lng != null) tripPatch.origin_lng = patch.origin_lng;
  if (patch.origin_address != null) tripPatch.origin_address = patch.origin_address;
  if (patch.last_traffic_duration != null) tripPatch.last_traffic_duration = patch.last_traffic_duration;
  if (patch.next_probe_at_ms !== undefined) tripPatch.next_probe_at_ms = patch.next_probe_at_ms;
  if (patch.next_probe_reason !== undefined) tripPatch.next_probe_reason = patch.next_probe_reason;
  if (Object.keys(tripPatch).length === 0) return;
  console.log(`[TRIP-SENTINEL] 📝 Elastic metadata patch for ${id}:`, Object.keys(tripPatch).join(', '));
  await patchMetadata(id, { trip: tripPatch }, { silent: true });
}
