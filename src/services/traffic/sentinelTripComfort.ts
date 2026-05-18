import { withTrankilV2Database } from '../../api/trankilV2Db';
import { ensureSentinelTripsSchema } from './sentinelActivation';

export type SentinelTripComfortSnapshot = {
  scanCount: number;
  scan1AtMs: number | null;
  scan1DurationSec: number | null;
  lastTrafficDurationSec: number;
  targetDurationSec: number;
};

export async function getSentinelTripComfortSnapshot(
  tripTaskId: string,
): Promise<SentinelTripComfortSnapshot | null> {
  const id = String(tripTaskId || '').trim();
  if (!id) return null;
  await ensureSentinelTripsSchema();
  return withTrankilV2Database(async (db) => {
    const row = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT scan_count, scan1_at_ms, scan1_duration_sec, last_traffic_duration, target_duration_sec
       FROM sentinel_trips WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    return {
      scanCount: Math.max(0, Math.round(Number(row.scan_count ?? 0))),
      scan1AtMs: row.scan1_at_ms == null ? null : Number(row.scan1_at_ms),
      scan1DurationSec: row.scan1_duration_sec == null ? null : Number(row.scan1_duration_sec),
      lastTrafficDurationSec: Math.max(0, Number(row.last_traffic_duration ?? 0)),
      targetDurationSec: Math.max(0, Number(row.target_duration_sec ?? 0)),
    };
  });
}

export function hasNewtonFirstScanRecorded(snapshot: SentinelTripComfortSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.scanCount >= 1) return true;
  return snapshot.scan1AtMs != null && Number.isFinite(snapshot.scan1AtMs);
}

/** Durée « standard » : premier scan réel, sinon dernière estimation stockée avant scan. */
export function standardTravelDurationSec(snapshot: SentinelTripComfortSnapshot | null): number | null {
  if (!snapshot) return null;
  const scan1 = snapshot.scan1DurationSec;
  if (scan1 != null && Number.isFinite(scan1) && scan1 > 0) return scan1;
  if (snapshot.scanCount < 1 && snapshot.lastTrafficDurationSec > 0) return snapshot.lastTrafficDurationSec;
  if (snapshot.targetDurationSec > 0) return snapshot.targetDurationSec;
  return null;
}

/** Durée « réelle » : dernière mesure trafic après au moins un scan. */
export function realTravelDurationSec(snapshot: SentinelTripComfortSnapshot | null): number | null {
  if (!snapshot || !hasNewtonFirstScanRecorded(snapshot)) return null;
  const sec = snapshot.lastTrafficDurationSec;
  return sec > 0 && Number.isFinite(sec) ? sec : null;
}
