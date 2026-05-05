import { withTrankilV2Database } from '../../api/trankilV2Db';
import { computeNewtonWindow } from './TrafficEngine';
import { SentinelNotificationManager } from './TrafficNotificationService';
import i18n from '../../locales/i18n';

export async function ensureSentinelTripsSchema(): Promise<void> {
  await withTrankilV2Database(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sentinel_trips (
        id TEXT PRIMARY KEY NOT NULL,
        destination TEXT NOT NULL,
        arrival_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        sentinel_mode TEXT NOT NULL DEFAULT 'SENTINEL',
        target_duration_sec INTEGER NOT NULL DEFAULT 0,
        last_traffic_duration INTEGER NOT NULL DEFAULT 0,
        internal_scan_count INTEGER NOT NULL DEFAULT 0,
        next_check_at INTEGER,
        gate_prompted_at INTEGER,
        last_error_at INTEGER,
        t_optimiste_ms INTEGER,
        t_pessimiste_ms INTEGER,
        vigilance_status TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
        server_version INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sentinel_trips_status
        ON sentinel_trips (status);
      CREATE INDEX IF NOT EXISTS idx_sentinel_trips_dirty_updated
        ON sentinel_trips (is_dirty, updated_at DESC);
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
  sentinelMode?: 'SENTINEL' | 'STATIC';
}): Promise<{ tOptimisteMs: number; tPessimisteMs: number }> {
  const nowMs = Date.now();
  const durationSec = Math.max(0, Number(input.initialDurationSec ?? 25 * 60) || 0);
  const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(input.targetArrivalMs, durationSec);
  const sentinelMode = input.sentinelMode ?? 'SENTINEL';
  const vigilanceStatus =
    nowMs >= input.targetArrivalMs
      ? 'FINISHED'
      : nowMs >= tPessimisteMs
        ? 'VIGILANCE_RED'
        : nowMs >= tOptimisteMs
          ? 'VIGILANCE_ORANGE'
          : 'VIGILANCE_BLUE';

  await ensureSentinelTripsSchema();
  await withTrankilV2Database(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO sentinel_trips (
        id, destination, arrival_at_ms, status, sentinel_mode, target_duration_sec, last_traffic_duration,
        internal_scan_count, next_check_at, gate_prompted_at, last_error_at,
        t_optimiste_ms, t_pessimiste_ms, vigilance_status,
        updated_at, is_dirty, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, 1, 0)`,
      [
        input.tripTaskId,
        input.formattedAddress.trim(),
        input.targetArrivalMs,
        vigilanceStatus === 'FINISHED' ? 'DONE' : 'ACTIVE',
        sentinelMode,
        0,
        durationSec,
        0,
        tOptimisteMs,
        tPessimisteMs,
        vigilanceStatus,
        nowMs,
      ]
    );
  });

  const manager = new SentinelNotificationManager();
  if (vigilanceStatus === 'FINISHED') {
    await manager.cancel(input.tripTaskId);
  } else {
    const trafficLabel =
      sentinelMode === 'STATIC'
        ? i18n.t('sentinel.notifStatusStatic')
        : vigilanceStatus === 'VIGILANCE_BLUE'
          ? i18n.t('sentinel.notifStatusBlue')
          : vigilanceStatus === 'VIGILANCE_ORANGE'
            ? i18n.t('sentinel.notifStatusOrange')
            : vigilanceStatus === 'VIGILANCE_RED'
              ? i18n.t('sentinel.notifStatusRed')
              : String(vigilanceStatus);
    await manager.update({
      tripTaskId: input.tripTaskId,
      destination: input.formattedAddress.trim(),
      targetArrivalMs: input.targetArrivalMs,
      nowMs,
      tOptimisteMs,
      vigilanceStatus,
      lat: typeof input.lat === 'number' ? input.lat : undefined,
      lng: typeof input.lng === 'number' ? input.lng : undefined,
      staticDepartureAtMs: sentinelMode === 'STATIC' ? tPessimisteMs : undefined,
      trafficLabel,
    });
  }

  return { tOptimisteMs, tPessimisteMs };
}
