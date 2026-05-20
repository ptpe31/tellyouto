import { withTrankilV2Database } from '../../api/trankilV2Db';
import {
  computeElasticDepartureWindow,
  DEFAULT_ELASTIC_D_STD_MIN,
  normalizeElasticTransportMode,
  scheduleElasticProbes,
  skipsElasticProbe2,
} from '../../utils/elasticSlotEngine';
import { syncTripProbeScheduleMetadata } from './sentinelElasticTripMetadata';
import { startSentinelRuntime } from './sentinelRuntime';

async function tryAddColumn(db: { execAsync: (sql: string) => Promise<void> }, sql: string) {
  try {
    await db.execAsync(sql);
  } catch {}
}

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
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN fingerprint TEXT;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan_count INTEGER NOT NULL DEFAULT 0;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN flow_calibrated INTEGER NOT NULL DEFAULT 0;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN v_flow_sec_per_min REAL NOT NULL DEFAULT 10;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN last_real_scan_at_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan1_at_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan1_duration_sec REAL;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan2_at_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan2_duration_sec REAL;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN base_t_optimiste_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN base_t_pessimiste_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN internal_t_pessimiste_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN displayed_t_optimiste_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN displayed_t_pessimiste_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN last_ui_update_at_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN mode_safety INTEGER NOT NULL DEFAULT 0;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN next_real_scan_at_ms INTEGER;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN next_real_scan_reason TEXT;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN api_calls_total INTEGER NOT NULL DEFAULT 0;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN api_calls_avoided_cache INTEGER NOT NULL DEFAULT 0;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN api_calls_avoided_extrapolation INTEGER NOT NULL DEFAULT 0;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN origin_lat REAL;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN origin_lng REAL;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN dest_lat REAL;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN dest_lng REAL;`);
    await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN transport_mode TEXT;`);
  });
}

export async function activateSentinelTrip(input: {
  tripTaskId: string;
  formattedAddress: string;
  targetArrivalMs: number;
  lat?: number;
  lng?: number;
  originLat?: number | null;
  originLng?: number | null;
  sentinelMode?: 'SENTINEL' | 'STATIC';
  transportMode?: string | null;
  standardDurationMin?: number;
  needsGpsCatchup?: boolean;
}): Promise<void> {
  const nowMs = Date.now();
  const dStdMin = Math.max(1, Number(input.standardDurationMin ?? DEFAULT_ELASTIC_D_STD_MIN) || DEFAULT_ELASTIC_D_STD_MIN);
  const elasticMode = normalizeElasticTransportMode(input.transportMode);
  const window = computeElasticDepartureWindow(input.targetArrivalMs, dStdMin, elasticMode);
  const windowStartMs = window?.startDate.getTime() ?? input.targetArrivalMs - dStdMin * 60_000;
  const windowEndMs = window?.endDate.getTime() ?? input.targetArrivalMs;
  const hasProbe1Done = input.standardDurationMin != null && Number.isFinite(Number(input.standardDurationMin));
  const scanCount = hasProbe1Done ? 1 : 0;
  const probes = scheduleElasticProbes({
    windowStartMs,
    dStdMin,
    nowMs,
    skipProbe2: skipsElasticProbe2(input.transportMode),
  });
  const skipProbe2 = skipsElasticProbe2(input.transportMode);
  const nextProbeReason = hasProbe1Done
    ? skipProbe2
      ? 'PROBE3_GONOGO'
      : probes?.probe2AtMs != null
        ? 'PROBE2_TREND'
        : 'PROBE3_GONOGO'
    : 'PROBE1_CONFIG';
  const nextProbeAtMs = hasProbe1Done
    ? skipProbe2
      ? probes?.probe3AtMs ?? null
      : probes?.probe2AtMs ?? probes?.probe3AtMs ?? null
    : nowMs;
  const sentinelMode = input.sentinelMode ?? 'SENTINEL';
  const vigilanceStatus = nowMs >= input.targetArrivalMs ? 'FINISHED' : 'VIGILANCE_BLUE';

  await ensureSentinelTripsSchema();
  await withTrankilV2Database(async (db) => {
    const lat = typeof input.lat === 'number' && Number.isFinite(input.lat) ? input.lat : null;
    const lng = typeof input.lng === 'number' && Number.isFinite(input.lng) ? input.lng : null;
    const oLat =
      typeof input.originLat === 'number' && Number.isFinite(input.originLat) ? input.originLat : null;
    const oLng =
      typeof input.originLng === 'number' && Number.isFinite(input.originLng) ? input.originLng : null;
    const mode = input.transportMode == null ? null : String(input.transportMode || '').trim() || null;
    const fp =
      lat != null && lng != null
        ? `${Math.round(lat * 10_000) / 10_000},${Math.round(lng * 10_000) / 10_000}|${Math.round(
            input.targetArrivalMs,
          )}|${mode || 'driving'}`
        : `na,na|${Math.round(input.targetArrivalMs)}|${mode || 'driving'}`;
    const durationSec = Math.round(dStdMin * 60);
    await db.runAsync(
      `INSERT OR REPLACE INTO sentinel_trips (
        id, destination, arrival_at_ms, status, sentinel_mode, target_duration_sec, last_traffic_duration,
        internal_scan_count, next_check_at, gate_prompted_at, last_error_at,
        t_optimiste_ms, t_pessimiste_ms, vigilance_status,
        updated_at, is_dirty, server_version,
        state_version, fingerprint, scan_count, flow_calibrated, v_flow_sec_per_min,
        last_real_scan_at_ms, scan1_at_ms, scan1_duration_sec, scan2_at_ms, scan2_duration_sec,
        base_t_optimiste_ms, base_t_pessimiste_ms, internal_t_pessimiste_ms,
        displayed_t_optimiste_ms, displayed_t_pessimiste_ms, last_ui_update_at_ms,
        mode_safety, next_real_scan_at_ms, next_real_scan_reason,
        api_calls_total, api_calls_avoided_cache, api_calls_avoided_extrapolation,
        origin_lat, origin_lng, dest_lat, dest_lng, transport_mode
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, NULL, NULL, NULL,
        ?, ?, ?, ?,
        ?, 1, 0,
        ?, ?, ?, ?, ?,
        NULL, ?, ?, NULL, NULL,
        ?, ?, NULL,
        ?, ?, ?,
        0, ?, ?, ?,
        0, 0, 0,
        ?, ?, ?, ?, ?
      )`,
      [
        input.tripTaskId,
        input.formattedAddress.trim(),
        input.targetArrivalMs,
        vigilanceStatus === 'FINISHED' ? 'DONE' : 'ACTIVE',
        sentinelMode,
        durationSec,
        durationSec,
        0,
        windowStartMs,
        windowEndMs,
        vigilanceStatus,
        nowMs,
        1,
        fp,
        scanCount,
        0,
        0,
        hasProbe1Done ? nowMs : null,
        hasProbe1Done ? durationSec : null,
        windowStartMs,
        windowEndMs,
        windowStartMs,
        windowEndMs,
        nowMs,
        vigilanceStatus === 'FINISHED' ? null : nextProbeAtMs,
        vigilanceStatus === 'FINISHED' ? null : nextProbeReason,
        oLat,
        oLng,
        lat,
        lng,
        mode,
      ],
    );
  });

  if (input.needsGpsCatchup) {
    console.log(`[TRIP-SENTINEL] 📍 GPS catch-up scheduled on PROBE1 for ${input.tripTaskId}`);
  }

  if (vigilanceStatus !== 'FINISHED') {
    await syncTripProbeScheduleMetadata(input.tripTaskId, nextProbeAtMs, nextProbeReason);
  }
}

export async function kickSentinelAfterActivation(tripTaskId: string): Promise<void> {
  try {
    const scheduler = await startSentinelRuntime();
    await scheduler.refreshTask(tripTaskId);
    await scheduler.tickNow(tripTaskId);
  } catch {}
}
