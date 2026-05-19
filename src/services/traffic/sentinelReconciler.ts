import AsyncStorage from '@react-native-async-storage/async-storage';

import { getTrankilV2IntentionById } from '../../api/trankilV2Db';
import { consumeSentinelQuotaOnTripValidation } from '../QuotaManager';
import { USER_SPECTRUM_STORAGE_KEY } from '../../context/UserSpectrumContext';
import { normalizeTripTransportMode } from '../../utils/tripTransportMode';
import {
  hasTripStandardDurationMin,
  readTripOriginCoords,
  tripMetadataNeedsGpsCatchup,
} from './sentinelElasticTripMetadata';
import { activateSentinelTrip, ensureSentinelTripsSchema, kickSentinelAfterActivation } from './sentinelActivation';
import { cancelTripMission, clearTripElasticProbeMetadata } from './sentinelTripMission';

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v as Record<string, unknown>;
  } catch {
    return {};
  }
}

function msFromUnknown(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = typeof v === 'string' ? v : '';
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  return null;
}

async function readIsProUserLocal(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(USER_SPECTRUM_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { isProUser?: unknown } | null;
    return Boolean(parsed && parsed.isProUser === true);
  } catch {
    return false;
  }
}

export async function reconcileSentinelForIntentionId(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  const row = await getTrankilV2IntentionById(id);
  if (!row) return;

  const remindToLeave = Boolean(row.remind_to_leave);
  const meta = safeParseJsonObject(row.metadata_json);
  const trip = meta.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip) ? (meta.trip as Record<string, unknown>) : null;
  if (!trip) return;

  const destLat = typeof trip.location_lat === 'number' ? Number(trip.location_lat) : NaN;
  const destLng = typeof trip.location_lng === 'number' ? Number(trip.location_lng) : NaN;
  const placeId = typeof trip.location_place_id === 'string' ? String(trip.location_place_id) : '';
  const destination = String(trip.location_address || row.location_address || '').trim();
  const arrivalMs =
    msFromUnknown(trip.arrivalDue) ??
    msFromUnknown(trip.dueDateTime) ??
    msFromUnknown(meta.dueDateTime) ??
    null;
  const transportModeRaw = row.transport_mode == null ? null : String(row.transport_mode || '').trim() || null;
  const transportMode = transportModeRaw ? normalizeTripTransportMode(transportModeRaw) : null;

  await ensureSentinelTripsSchema();

  const isProUser = await readIsProUserLocal();

  if (!remindToLeave || !isProUser) {
    await cancelTripMission(id);
    return;
  }

  if (!destination || !Number.isFinite(destLat) || !Number.isFinite(destLng) || !placeId || !arrivalMs) {
    await cancelTripMission(id);
    return;
  }

  const quota = await consumeSentinelQuotaOnTripValidation({ isProUser });
  const sentinelMode = quota.mode === 'STATIC' ? 'STATIC' : 'SENTINEL';
  const origin = readTripOriginCoords(trip);
  const needsGpsCatchup = tripMetadataNeedsGpsCatchup(trip);
  const hasStandardDuration = hasTripStandardDurationMin(trip);
  const standardDurationMin = hasStandardDuration ? Number(trip.standard_duration_min) : undefined;

  console.log(
    `[TRIP-SENTINEL] 📡 Reconciling elastic task for ID: ${id} | GPS catch-up: ${needsGpsCatchup ? 'yes' : 'no'} | D_std: ${hasStandardDuration ? standardDurationMin : 'pending'}`,
  );

  await activateSentinelTrip({
    tripTaskId: id,
    formattedAddress: destination,
    targetArrivalMs: arrivalMs,
    lat: destLat,
    lng: destLng,
    sentinelMode,
    transportMode,
    originLat: origin.lat,
    originLng: origin.lng,
    standardDurationMin,
    needsGpsCatchup,
  });

  await kickSentinelAfterActivation(id);
}

/** Reset complet après changement de destination : annule sondes + relance PROBE1. */
export async function resetTripMissionAndRelaunchProbe1(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  await cancelTripMission(id);
  await clearTripElasticProbeMetadata(id);
  await reconcileSentinelForIntentionId(id);
}
