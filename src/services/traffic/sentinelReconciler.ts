import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getTrankilV2IntentionById,
  trankilV2SqliteBarrier,
  waitForTrankilV2SqliteIdle,
  withTrankilV2Database,
} from '../../api/trankilV2Db';
import { consumeSentinelQuotaOnTripValidation } from '../QuotaManager';
import { USER_SPECTRUM_STORAGE_KEY } from '../../context/UserSpectrumContext';
import { normalizeTripTransportMode } from '../../utils/tripTransportMode';
import { isTripAllDay } from '../../utils/tripElasticDisplay';
import {
  hasTripStandardDurationMin,
  readTripOriginCoords,
  tripMetadataNeedsGpsCatchup,
} from './sentinelElasticTripMetadata';
import { activateSentinelTrip, kickSentinelAfterActivation, syncSentinelTripProbeScheduleAfterActivation } from './sentinelActivation';
import { cancelTripMission, clearTripElasticProbeMetadata, suspendTripMissionForAllDay } from './sentinelTripMission';

const RECONCILE_DEBOUNCE_MS = 500;

async function readSentinelTripStatus(intentionId: string): Promise<string | null> {
  const id = String(intentionId || '').trim();
  if (!id) return null;
  const row = await withTrankilV2Database(async (db) =>
    db.getFirstAsync<{ status: string }>(`SELECT status FROM sentinel_trips WHERE id = ? LIMIT 1`, [id]),
  );
  return row?.status ?? null;
}

async function cancelSentinelIfActive(intentionId: string): Promise<void> {
  const status = await readSentinelTripStatus(intentionId);
  if (status !== 'ACTIVE') return;
  await cancelTripMission(intentionId);
}

const reconcileDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const missionActivations = new Map<string, Promise<void>>();

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

/** Attend la fin d'une activation Sentinel en cours (évite cancel/reconcile concurrent). */
export async function waitForSentinelMissionActivation(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  const inflight = missionActivations.get(id);
  if (inflight) {
    try {
      await inflight;
    } catch {
      // ignore — l'appelant gère son propre flux
    }
  }
}

async function reconcileSentinelForIntentionIdInner(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;

  const existing = missionActivations.get(id);
  if (existing) {
    await existing;
    return;
  }

  const run = (async () => {
    await waitForTrankilV2SqliteIdle();

    const row = await getTrankilV2IntentionById(id);
    if (!row) return;

    if (Number(row.remind_to_leave) !== 1) {
      await cancelSentinelIfActive(id);
      return;
    }

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

    if (isTripAllDay(meta, trip, row.due_date ?? null)) {
      await suspendTripMissionForAllDay(id);
      return;
    }

    const isProUser = await readIsProUserLocal();

    if (!remindToLeave || !isProUser) {
      await cancelSentinelIfActive(id);
      return;
    }

    if (!destination || !Number.isFinite(destLat) || !Number.isFinite(destLng) || !arrivalMs) {
      await cancelSentinelIfActive(id);
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

    const activation = await activateSentinelTrip({
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

    await trankilV2SqliteBarrier();

    await kickSentinelAfterActivation(id);

    await trankilV2SqliteBarrier();

    await syncSentinelTripProbeScheduleAfterActivation({
      tripTaskId: id,
      nextProbeAtMs: activation.nextProbeAtMs,
      nextProbeReason: activation.nextProbeReason,
      vigilanceStatus: activation.vigilanceStatus,
    });
  })();

  missionActivations.set(id, run);
  try {
    await run;
  } finally {
    missionActivations.delete(id);
  }
}

/** Reconcile immédiat — sans debounce ni setTimeout (Big Button / barrière UI). */
export async function reconcileSentinelForIntentionIdImmediate(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  await waitForSentinelMissionActivation(id);
  await reconcileSentinelForIntentionIdInner(id);
}

export function reconcileSentinelForIntentionId(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return Promise.resolve();

  return new Promise((resolve) => {
    const existingTimer = reconcileDebounceTimers.get(id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      reconcileDebounceTimers.delete(id);
      void reconcileSentinelForIntentionIdInner(id).finally(resolve);
    }, RECONCILE_DEBOUNCE_MS);

    reconcileDebounceTimers.set(id, timer);
  });
}

/** Reset complet après changement de destination : annule sondes + relance PROBE1. */
export async function resetTripMissionAndRelaunchProbe1(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  await waitForSentinelMissionActivation(id);
  await cancelTripMission(id);
  await clearTripElasticProbeMetadata(id);
  await trankilV2SqliteBarrier();
  await reconcileSentinelForIntentionIdImmediate(id);
}

/** Réveil après retour à un horaire précis — relance PROBE1 si remind ON et metadata élastique vide. */
export async function wakeTripMissionAfterTimedRestore(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  const row = await getTrankilV2IntentionById(id);
  if (!row) return;

  const meta = safeParseJsonObject(row.metadata_json);
  const trip =
    meta.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip)
      ? (meta.trip as Record<string, unknown>)
      : null;
  if (!trip || isTripAllDay(meta, trip, row.due_date ?? null)) return;
  if (!Boolean(row.remind_to_leave)) return;

  const isProUser = await readIsProUserLocal();
  if (!isProUser) return;

  if (!hasTripStandardDurationMin(trip)) {
    await resetTripMissionAndRelaunchProbe1(id);
    return;
  }

  await trankilV2SqliteBarrier();
  await reconcileSentinelForIntentionIdImmediate(id);
}

/** Changement destination / coords — relance PROBE1 uniquement si surveillance active en DB. */
export async function syncSentinelAfterDestinationChange(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  const row = await getTrankilV2IntentionById(id);
  if (!row || Number(row.remind_to_leave) !== 1) return;
  await resetTripMissionAndRelaunchProbe1(id);
}
