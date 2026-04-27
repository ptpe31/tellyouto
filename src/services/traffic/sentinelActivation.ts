import { withLocalDatabase } from '../../api/localDb';
import { computeNewtonWindow } from './TrafficEngine';
import { SentinelNotificationManager } from './TrafficNotificationService';

export async function ensureSentinelTripsSchema(): Promise<void> {
  await withLocalDatabase(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sentinel_trips (
        id TEXT PRIMARY KEY NOT NULL,
        destination TEXT NOT NULL,
        arrival_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        target_duration_sec INTEGER NOT NULL DEFAULT 0,
        last_traffic_duration INTEGER NOT NULL DEFAULT 0,
        internal_scan_count INTEGER NOT NULL DEFAULT 0,
        next_check_at INTEGER,
        gate_prompted_at INTEGER,
        last_error_at INTEGER,
        t_optimiste_ms INTEGER,
        t_pessimiste_ms INTEGER,
        vigilance_status TEXT
      );
    `);
  });
}

export async function activateSentinelTrip(input: {
  tripTaskId: string;
  formattedAddress: string;
  targetArrivalMs: number;
  initialDurationSec?: number;
  lat?: number;
  lng?: number;
}): Promise<{ tOptimisteMs: number; tPessimisteMs: number }> {
  const nowMs = Date.now();
  const durationSec = Math.max(0, Number(input.initialDurationSec ?? 25 * 60) || 0);
  const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(input.targetArrivalMs, durationSec);
  const vigilanceStatus =
    nowMs >= input.targetArrivalMs
      ? 'FINISHED'
      : nowMs >= tPessimisteMs
        ? 'VIGILANCE_RED'
        : nowMs >= tOptimisteMs
          ? 'VIGILANCE_ORANGE'
          : 'VIGILANCE_BLUE';

  await ensureSentinelTripsSchema();
  await withLocalDatabase(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO sentinel_trips (
        id, destination, arrival_at_ms, status, target_duration_sec, last_traffic_duration,
        internal_scan_count, next_check_at, gate_prompted_at, last_error_at,
        t_optimiste_ms, t_pessimiste_ms, vigilance_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
      [
        input.tripTaskId,
        input.formattedAddress.trim(),
        input.targetArrivalMs,
        vigilanceStatus === 'FINISHED' ? 'DONE' : 'ACTIVE',
        0,
        durationSec,
        0,
        tOptimisteMs,
        tPessimisteMs,
        vigilanceStatus,
      ]
    );
  });

  const manager = new SentinelNotificationManager();
  if (vigilanceStatus === 'FINISHED') {
    await manager.cancel(input.tripTaskId);
  } else {
    await manager.update({
      tripTaskId: input.tripTaskId,
      destination: input.formattedAddress.trim(),
      targetArrivalMs: input.targetArrivalMs,
      nowMs,
      tOptimisteMs,
      vigilanceStatus,
      lat: typeof input.lat === 'number' ? input.lat : undefined,
      lng: typeof input.lng === 'number' ? input.lng : undefined,
      trafficLabel:
        vigilanceStatus === 'VIGILANCE_BLUE'
          ? 'Trafic surveillé'
          : vigilanceStatus === 'VIGILANCE_ORANGE'
            ? 'Fenêtre ouverte'
            : vigilanceStatus === 'VIGILANCE_RED'
              ? 'Départ critique'
              : 'Terminé',
    });
  }

  return { tOptimisteMs, tPessimisteMs };
}
