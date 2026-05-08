import { getTrankilV2IntentionById, withTrankilV2Database } from '../../api/trankilV2Db';
import { consumeSentinelQuotaOnTripValidation } from '../QuotaManager';
import { activateSentinelTrip, ensureSentinelTripsSchema, kickSentinelAfterActivation } from './sentinelActivation';
import { getSentinelScheduler, startSentinelRuntime } from './sentinelRuntime';

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

export async function reconcileSentinelForIntentionId(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  const row = await getTrankilV2IntentionById(id);
  if (!row) return;

  const meta = safeParseJsonObject(row.metadata_json);
  const trip = meta.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip) ? (meta.trip as Record<string, unknown>) : null;
  if (!trip) return;

  const newtonEnabled = Boolean(trip.newtonEnabled);
  const destLat = typeof trip.location_lat === 'number' ? Number(trip.location_lat) : NaN;
  const destLng = typeof trip.location_lng === 'number' ? Number(trip.location_lng) : NaN;
  const placeId = typeof trip.location_place_id === 'string' ? String(trip.location_place_id) : '';
  const destination = String(trip.location_address || row.location_address || '').trim();
  const arrivalMs =
    msFromUnknown(trip.arrivalDue) ??
    msFromUnknown(trip.dueDateTime) ??
    msFromUnknown(meta.dueDateTime) ??
    null;
  const transportMode = row.transport_mode == null ? null : String(row.transport_mode || '').trim() || null;

  await ensureSentinelTripsSchema();

  if (!newtonEnabled) {
    await withTrankilV2Database(async (db) => {
      await db.runAsync(`UPDATE sentinel_trips SET status = 'PAUSED' WHERE id = ?`, [id]);
    });
    const scheduler = getSentinelScheduler();
    if (scheduler) await scheduler.cancelTask(id);
    return;
  }

  if (!destination || !Number.isFinite(destLat) || !Number.isFinite(destLng) || !placeId || !arrivalMs) {
    return;
  }

  const quota = await consumeSentinelQuotaOnTripValidation();
  const sentinelMode = quota.mode === 'STATIC' ? 'STATIC' : 'SENTINEL';

  await activateSentinelTrip({
    tripTaskId: id,
    formattedAddress: destination,
    targetArrivalMs: arrivalMs,
    lat: destLat,
    lng: destLng,
    sentinelMode,
    transportMode,
  });

  await kickSentinelAfterActivation(id);
}
