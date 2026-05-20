import { getTrankilV2IntentionById, patchMetadata } from '../../api/trankilV2Db';
import { withSentinelDbRetry } from './sentinelDbRetry';
import {
  ELASTIC_BUFFER_BASE_MIN,
  anchorToDepartureWindow,
  readElasticWindowAnchor,
  type WindowAnchor,
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
  elastic_predicted_duration_min?: number;
  elastic_degradation_ratio?: number;
  elastic_prudence_alpha?: number;
  elastic_anchor_start_ms?: number;
  elastic_anchor_end_ms?: number;
  elastic_anchor_duration_min?: number;
  probe3_skipped?: boolean;
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

export function buildContractTripPatch(input: {
  anchor: WindowAnchor;
  bufferMin: number;
  tIdealMin: number;
  tPredMin: number;
  ratioD: number;
  alpha: number;
  approximate?: boolean;
  shifted?: boolean;
  probe3Skipped?: boolean;
}): TripElasticMetadataPatch {
  const window = anchorToDepartureWindow(input.anchor, input.bufferMin, input.tIdealMin);
  return {
    standard_duration_min: input.tIdealMin,
    elastic_predicted_duration_min: input.tPredMin,
    elastic_degradation_ratio: input.ratioD,
    elastic_prudence_alpha: input.alpha,
    elastic_anchor_start_ms: input.anchor.startMs,
    elastic_anchor_end_ms: input.anchor.endMs,
    elastic_anchor_duration_min: input.anchor.durationMin,
    elastic_start_ms: window.startDate.getTime(),
    elastic_end_ms: window.endDate.getTime(),
    elastic_buffer_min: input.bufferMin,
    elastic_approximate: input.approximate ?? false,
    elastic_shifted: input.shifted ?? false,
    probe3_skipped: input.probe3Skipped,
  };
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
  if (patch.elastic_predicted_duration_min != null) {
    tripPatch.elastic_predicted_duration_min = patch.elastic_predicted_duration_min;
  }
  if (patch.elastic_degradation_ratio != null) {
    tripPatch.elastic_degradation_ratio = patch.elastic_degradation_ratio;
  }
  if (patch.elastic_prudence_alpha != null) tripPatch.elastic_prudence_alpha = patch.elastic_prudence_alpha;
  if (patch.elastic_anchor_start_ms != null) tripPatch.elastic_anchor_start_ms = patch.elastic_anchor_start_ms;
  if (patch.elastic_anchor_end_ms != null) tripPatch.elastic_anchor_end_ms = patch.elastic_anchor_end_ms;
  if (patch.elastic_anchor_duration_min != null) {
    tripPatch.elastic_anchor_duration_min = patch.elastic_anchor_duration_min;
  }
  if (patch.probe3_skipped != null) tripPatch.probe3_skipped = patch.probe3_skipped;
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
