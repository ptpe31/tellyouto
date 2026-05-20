import { getTrankilV2IntentionById } from '../../api/trankilV2Db';
import {
  computeElasticDepartureWindow,
  computeShiftedElasticWindow,
  normalizeElasticTransportMode,
  skipsElasticProbe2,
} from '../../utils/elasticSlotEngine';
import { logTripMath, resolveTripMathAlias } from '../../utils/tripMathLogger';
import { isTripAllDay, parseTripArrivalIso } from '../../utils/tripElasticDisplay';
import { getForegroundOriginSnapshot } from './SentinelLocationService';
import {
  buildShiftedTripPatch,
  elasticWindowToTripPatch,
  hasTripStandardDurationMin,
  patchTripElasticMetadata,
} from './sentinelElasticTripMetadata';
import {
  computeBufferForTask,
  computeDepartInMinutes,
  computeTrafficTrendProjection,
  evaluateProbe2Overflow,
  PROBE1_GPS_RETRY_MS,
  buildProbeFailureRecovery,
  releaseElasticProbeLock,
  resolveDueElasticProbe,
  resolveDStdMin,
  resolveProbe1BaselineAtMs,
  resolveProbe1BaselineDurationSec,
  scheduleNextElasticProbe,
  tryAcquireElasticProbeLock,
  type ElasticProbeReason,
} from './sentinelElasticProbes';
import type { MapsService, TripTaskRowV4 } from './TrafficSchedulerV4';

type FlowMode = 'REAL' | 'SCHEDULED';

export type ElasticTickResult = {
  patch: Partial<TripTaskRowV4>;
  goNoGo: { variant: 'smooth' | 'leave_now'; departInMin: number } | null;
  probe3Unavailable: { destination: string } | null;
  trace: {
    displayedStartMs: number | null;
    displayedEndMs: number | null;
    internalStartMs: number;
    internalEndMs: number;
    flowMode: FlowMode;
    vFlowSecPerMin: number;
    nextRealScanAtMs: number | null;
    nextRealScanReason: string | null;
    apiCallsTotal: number;
    apiCallsAvoidedCache: number;
    apiCallsAvoidedExtrapolation: number;
  };
  traceForce: boolean;
  done: boolean;
};

function computeFingerprint(task: TripTaskRowV4): string {
  const dLat = task.destLat == null ? 'na' : String(Math.round(task.destLat * 10_000) / 10_000);
  const dLng = task.destLng == null ? 'na' : String(Math.round(task.destLng * 10_000) / 10_000);
  const mode = String(task.transportMode || 'driving');
  return `${dLat},${dLng}|${Math.round(task.arrivalAtMs)}|${mode}`;
}

function baseTrace(task: TripTaskRowV4, startMs: number, endMs: number, flowMode: FlowMode): ElasticTickResult['trace'] {
  return {
    displayedStartMs: startMs,
    displayedEndMs: endMs,
    internalStartMs: startMs,
    internalEndMs: endMs,
    flowMode,
    vFlowSecPerMin: task.vFlowSecPerMin,
    nextRealScanAtMs: task.nextRealScanAtMs,
    nextRealScanReason: task.nextRealScanReason,
    apiCallsTotal: task.apiCallsTotal,
    apiCallsAvoidedCache: task.apiCallsAvoidedCache,
    apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
  };
}

function applyElasticWindowPatch(
  patch: Partial<TripTaskRowV4>,
  window: NonNullable<ReturnType<typeof computeElasticDepartureWindow>>,
): void {
  const startMs = window.startDate.getTime();
  const endMs = window.endDate.getTime();
  patch.tOptimisteMs = startMs;
  patch.tPessimisteMs = endMs;
  patch.baseTOptimisteMs = startMs;
  patch.baseTPessimisteMs = endMs;
  patch.displayedTOptimisteMs = startMs;
  patch.displayedTPessimisteMs = endMs;
  patch.lastUiUpdateAtMs = Date.now();
}

async function resolveOriginCoords(
  task: TripTaskRowV4,
  tripMeta: Record<string, unknown> | null,
  reason: ElasticProbeReason,
): Promise<{ lat: number; lng: number } | null> {
  let lat = task.originLat;
  let lng = task.originLng;
  if (tripMeta) {
    const mLat = Number(tripMeta.origin_lat);
    const mLng = Number(tripMeta.origin_lng);
    if (Number.isFinite(mLat) && Number.isFinite(mLng)) {
      lat = mLat;
      lng = mLng;
    }
  }
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  if (reason === 'PROBE1_CONFIG' || reason === 'PROBE1_RETRY') {
    try {
      const pos = await getForegroundOriginSnapshot({ maxAgeMs: 120_000 });
      return { lat: pos.lat, lng: pos.lng };
    } catch {
      return null;
    }
  }
  try {
    const pos = await getForegroundOriginSnapshot({ maxAgeMs: 120_000 });
    return { lat: pos.lat, lng: pos.lng };
  } catch {
    return null;
  }
}

async function executeElasticProbe(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  nowMs: number;
  reason: ElasticProbeReason;
  mapsService: MapsService;
}): Promise<ElasticTickResult> {
  const { task, tripMeta, nowMs, reason, mapsService } = input;
  const intentionId = String(task.id || '').trim();

  if (!tryAcquireElasticProbeLock(intentionId)) {
    console.warn(`[TRIP-SENTINEL] ⚠️ Probe already running for ${intentionId}, aborting duplicate.`);
    const startMs = task.tOptimisteMs ?? nowMs;
    const endMs = task.tPessimisteMs ?? nowMs;
    return {
      patch: {},
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(task, startMs, endMs, 'SCHEDULED'),
      traceForce: false,
      done: false,
    };
  }

  try {
    return await executeElasticProbeBody({ task, tripMeta, nowMs, reason, mapsService });
  } finally {
    releaseElasticProbeLock(intentionId);
  }
}

async function executeElasticProbeBody(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  nowMs: number;
  reason: ElasticProbeReason;
  mapsService: MapsService;
}): Promise<ElasticTickResult> {
  const { task, tripMeta, nowMs, reason, mapsService } = input;
  const patch: Partial<TripTaskRowV4> = {};
  console.log(`[TRIP-SENTINEL] 🔭 ${reason} for ${task.id}`);

  const origin = await resolveOriginCoords(task, tripMeta, reason);
  if (!origin) {
    patch.lastErrorAt = nowMs;
    patch.status = 'ACTIVE';
    patch.modeSafety = false;
    patch.nextRealScanAtMs = nowMs + PROBE1_GPS_RETRY_MS;
    patch.nextRealScanReason = 'PROBE1_RETRY';
    patch.stateVersion = task.stateVersion + 1;
    const startMs = task.tOptimisteMs ?? nowMs;
    const endMs = task.tPessimisteMs ?? nowMs;
    return {
      patch,
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(task, startMs, endMs, 'SCHEDULED'),
      traceForce: true,
      done: false,
    };
  }

  patch.originLat = origin.lat;
  patch.originLng = origin.lng;

  if (
    task.destLat == null ||
    task.destLng == null ||
    !Number.isFinite(task.destLat) ||
    !Number.isFinite(task.destLng)
  ) {
    patch.lastErrorAt = nowMs;
    patch.status = 'ACTIVE';
    patch.nextRealScanAtMs = nowMs + PROBE1_GPS_RETRY_MS;
    patch.nextRealScanReason = 'PROBE1_RETRY';
    return {
      patch,
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'REAL'),
      traceForce: true,
      done: false,
    };
  }

  try {
    const sample = await mapsService.fetchTrafficSample({
      ...task,
      originLat: origin.lat,
      originLng: origin.lng,
    });
    const fromCache = sample.fromCache === true;
    patch.apiCallsAvoidedCache = task.apiCallsAvoidedCache + (fromCache ? 1 : 0);
    patch.apiCallsTotal = task.apiCallsTotal + (fromCache ? 0 : 1);
    patch.lastRealScanAtMs = nowMs;
    patch.lastErrorAt = null;
    patch.status = 'ACTIVE';
    patch.modeSafety = false;

    const trafficSec = Math.max(0, Number(sample.trafficDurationSec) || 0);
    const staticSec = Math.max(
      0,
      Number(sample.staticDurationSec ?? sample.trafficDurationSec) || 0,
    );

    if (reason === 'PROBE1_CONFIG' || reason === 'PROBE1_RETRY') {
      const dStdMin = Math.max(1, Math.round(staticSec / 60));
      const elasticMode = normalizeElasticTransportMode(task.transportMode);
      const window = computeElasticDepartureWindow(task.arrivalAtMs, dStdMin, elasticMode);
      if (!window) throw new Error('elastic window failed');

      logTripMath({
        reason,
        alias: resolveTripMathAlias(tripMeta, task.destination),
        targetArrivalMs: task.arrivalAtMs,
        apiTrajetMin: dStdMin,
        bufferMin: window.bufferMin,
        windowStartMs: window.startDate.getTime(),
        windowEndMs: window.endDate.getTime(),
      });

      await patchTripElasticMetadata(task.id, {
        ...elasticWindowToTripPatch(window, { approximate: false, shifted: false }),
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        last_traffic_duration: staticSec,
      });

      patch.scanCount = 1;
      patch.scan1AtMs = nowMs;
      patch.scan1DurationSec = staticSec;
      patch.lastTrafficDuration = staticSec;
      applyElasticWindowPatch(patch, window);
      patch.vigilanceStatus = 'VIGILANCE_BLUE';
      patch.stateVersion = task.stateVersion + 1;

      const next = scheduleNextElasticProbe({
        task: { ...task, ...patch, scanCount: 1, scan1DurationSec: staticSec },
        tripMeta: {
          ...(tripMeta ?? {}),
          standard_duration_min: dStdMin,
          elastic_start_ms: window.startDate.getTime(),
        },
        scanCount: 1,
        nowMs,
      });
      patch.nextRealScanAtMs = next.nextRealScanAtMs;
      patch.nextRealScanReason = next.nextRealScanReason;

      return {
        patch,
        goNoGo: null,
      probe3Unavailable: null,
        trace: baseTrace(task, window.startDate.getTime(), window.endDate.getTime(), 'REAL'),
        traceForce: true,
        done: false,
      };
    }

    if (reason === 'PROBE2_TREND') {
      if (skipsElasticProbe2(task.transportMode)) {
        throw new Error('PROBE2 skipped for non-driving mode');
      }
      const dStdMin = resolveDStdMin(task, tripMeta);
      const bufferMin = computeBufferForTask(task, tripMeta);
      const dLiveMin = Math.max(1, Math.round(trafficSec / 60));
      patch.scanCount = 2;
      patch.scan2AtMs = nowMs;
      patch.scan2DurationSec = trafficSec;
      patch.lastTrafficDuration = trafficSec;
      patch.stateVersion = task.stateVersion + 1;

      const previousTrajetMin = Math.max(
        1,
        Math.round(resolveProbe1BaselineDurationSec(task, trafficSec) / 60),
      );
      const baselineAtMs = resolveProbe1BaselineAtMs(task, nowMs);
      const prelimWindow = computeShiftedElasticWindow(task.arrivalAtMs, dLiveMin, bufferMin);
      const windowEndForTrend =
        prelimWindow?.endDate.getTime() ?? task.tPessimisteMs ?? nowMs;

      const trend = computeTrafficTrendProjection({
        baselineDurationSec: resolveProbe1BaselineDurationSec(task, trafficSec),
        currentDurationSec: trafficSec,
        baselineAtMs,
        currentAtMs: nowMs,
        windowEndMs: windowEndForTrend,
        nowMs,
      });
      const dProjectedMin = trend.finalDurationMin;

      let windowStartMs = task.tOptimisteMs ?? nowMs;
      let windowEndMs = task.tPessimisteMs ?? nowMs;
      const liveWindow = computeShiftedElasticWindow(task.arrivalAtMs, dProjectedMin, bufferMin);
      if (liveWindow) {
        windowStartMs = liveWindow.startDate.getTime();
        windowEndMs = liveWindow.endDate.getTime();
      }

      const trendLogFields = {
        congestionGrowthRateMinPerMin: trend.growthRateMinPerMin,
        projectedTrajetMin: trend.finalDurationMin,
      };

      if (evaluateProbe2Overflow({ dLiveMin: dProjectedMin, dStdMin, bufferMin })) {
        const shiftedPatch = buildShiftedTripPatch(
          task.arrivalAtMs,
          dProjectedMin,
          bufferMin,
          trafficSec,
        );
        if (shiftedPatch) {
          windowStartMs = shiftedPatch.elastic_start_ms ?? windowStartMs;
          windowEndMs = shiftedPatch.elastic_end_ms ?? windowEndMs;
          logTripMath({
            reason: 'PROBE2_TREND',
            alias: resolveTripMathAlias(tripMeta, task.destination),
            targetArrivalMs: task.arrivalAtMs,
            apiTrajetMin: dLiveMin,
            bufferMin,
            windowStartMs,
            windowEndMs,
            previousTrajetMin,
            ...trendLogFields,
          });
          await patchTripElasticMetadata(task.id, shiftedPatch);
          console.log(`[TRIP-SENTINEL] ⚠️ Cas B shift for ${task.id}`);
        }
      } else if (liveWindow) {
        await patchTripElasticMetadata(task.id, {
          ...elasticWindowToTripPatch(liveWindow, { approximate: false, shifted: false }),
          last_traffic_duration: trafficSec,
        });
        logTripMath({
          reason: 'PROBE2_TREND',
          alias: resolveTripMathAlias(tripMeta, task.destination),
          targetArrivalMs: task.arrivalAtMs,
          apiTrajetMin: dLiveMin,
          bufferMin,
          windowStartMs,
          windowEndMs,
          previousTrajetMin,
          ...trendLogFields,
        });
      } else {
        logTripMath({
          reason: 'PROBE2_TREND',
          alias: resolveTripMathAlias(tripMeta, task.destination),
          targetArrivalMs: task.arrivalAtMs,
          apiTrajetMin: dLiveMin,
          bufferMin,
          windowStartMs,
          windowEndMs,
          previousTrajetMin,
          ...trendLogFields,
        });
      }

      patch.tOptimisteMs = windowStartMs;
      patch.tPessimisteMs = windowEndMs;
      patch.displayedTOptimisteMs = windowStartMs;
      patch.displayedTPessimisteMs = windowEndMs;
      patch.vigilanceStatus = 'VIGILANCE_ORANGE';

      const next = scheduleNextElasticProbe({
        task: { ...task, ...patch, scanCount: 2 },
        tripMeta: {
          ...(tripMeta ?? {}),
          elastic_start_ms: windowStartMs,
          standard_duration_min: dStdMin,
        },
        scanCount: 2,
        nowMs,
      });
      patch.nextRealScanAtMs = next.nextRealScanAtMs;
      patch.nextRealScanReason = next.nextRealScanReason;

      return {
        patch,
        goNoGo: null,
      probe3Unavailable: null,
        trace: baseTrace(task, windowStartMs, windowEndMs, 'REAL'),
        traceForce: true,
        done: false,
      };
    }

    if (reason === 'PROBE3_GONOGO') {
      patch.scanCount = 3;
      patch.lastTrafficDuration = trafficSec;
      patch.status = 'DONE';
      patch.vigilanceStatus = 'FINISHED';
      patch.nextRealScanAtMs = null;
      patch.nextRealScanReason = null;
      patch.stateVersion = task.stateVersion + 1;

      const departInMin = computeDepartInMinutes(task.arrivalAtMs, trafficSec, nowMs);
      const dStdMin = resolveDStdMin(task, tripMeta);
      const bufferMin = computeBufferForTask(task, tripMeta);
      const dLiveMin = Math.max(1, Math.round(trafficSec / 60));
      const variant: 'smooth' | 'leave_now' = evaluateProbe2Overflow({
        dLiveMin,
        dStdMin,
        bufferMin,
      })
        ? 'leave_now'
        : departInMin <= 5
          ? 'leave_now'
          : 'smooth';

      const liveWindow = computeShiftedElasticWindow(task.arrivalAtMs, dLiveMin, bufferMin);
      const startMs = liveWindow?.startDate.getTime() ?? task.tOptimisteMs ?? nowMs;
      const endMs = liveWindow?.endDate.getTime() ?? task.tPessimisteMs ?? nowMs;
      const previousTrajetMin = Math.max(
        1,
        Math.round(
          Number(task.scan2DurationSec ?? task.scan1DurationSec ?? dStdMin * 60) / 60,
        ),
      );

      logTripMath({
        reason: 'PROBE3_GONOGO',
        alias: resolveTripMathAlias(tripMeta, task.destination),
        targetArrivalMs: task.arrivalAtMs,
        apiTrajetMin: dLiveMin,
        bufferMin,
        windowStartMs: startMs,
        windowEndMs: endMs,
        previousTrajetMin,
      });

      patch.tOptimisteMs = startMs;
      patch.tPessimisteMs = endMs;
      patch.displayedTOptimisteMs = startMs;
      patch.displayedTPessimisteMs = endMs;

      await patchTripElasticMetadata(task.id, {
        ...(liveWindow
          ? elasticWindowToTripPatch(liveWindow, { approximate: false, shifted: false })
          : {}),
        last_traffic_duration: trafficSec,
      });

      return {
        patch,
        goNoGo: { variant, departInMin: variant === 'smooth' ? Math.max(1, departInMin) : 0 },
        probe3Unavailable: null,
        trace: baseTrace(task, startMs, endMs, 'REAL'),
        traceForce: true,
        done: true,
      };
    }

    throw new Error(`Unknown probe reason: ${reason}`);
  } catch (err) {
    console.error(`[TRIP-ERROR] Probe failed for ID: ${task.id}`, err);
    Object.assign(patch, buildProbeFailureRecovery({ task, reason, nowMs }));
    const probe3Unavailable =
      reason === 'PROBE3_GONOGO' ? { destination: task.destination } : null;
    return {
      patch,
      goNoGo: null,
      probe3Unavailable,
      trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'REAL'),
      traceForce: true,
      done: false,
    };
  }
}

export async function runElasticSchedulerTick(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  nowMs: number;
  mapsService: MapsService;
  disableRealScans?: boolean;
}): Promise<ElasticTickResult> {
  const { task, tripMeta, nowMs, mapsService, disableRealScans } = input;
  const patch: Partial<TripTaskRowV4> = {};

  const row = await getTrankilV2IntentionById(task.id);
  let metaRoot: Record<string, unknown> | null = null;
  if (row?.metadata_json) {
    try {
      const parsed = JSON.parse(row.metadata_json) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') metaRoot = parsed;
    } catch {
      metaRoot = null;
    }
  }
  const dueDate = row?.due_date ?? null;
  if (isTripAllDay(metaRoot, tripMeta, dueDate)) {
    patch.status = 'PAUSED';
    patch.nextRealScanAtMs = null;
    patch.nextRealScanReason = null;
    patch.vigilanceStatus = 'FINISHED';
    return {
      patch,
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'SCHEDULED'),
      traceForce: true,
      done: false,
    };
  }

  const arrivalIso = parseTripArrivalIso(metaRoot, tripMeta, dueDate);
  if (!arrivalIso || !Number.isFinite(Date.parse(arrivalIso))) {
    patch.status = 'PAUSED';
    patch.nextRealScanAtMs = null;
    patch.nextRealScanReason = null;
    return {
      patch,
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'SCHEDULED'),
      traceForce: true,
      done: false,
    };
  }

  if (nowMs >= task.arrivalAtMs) {
    patch.status = 'DONE';
    patch.vigilanceStatus = 'FINISHED';
    patch.nextRealScanAtMs = null;
    patch.nextRealScanReason = null;
    return {
      patch,
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(
        task,
        task.tOptimisteMs ?? nowMs,
        task.tPessimisteMs ?? nowMs,
        'SCHEDULED',
      ),
      traceForce: true,
      done: true,
    };
  }

  const computedFp = computeFingerprint(task);
  if (!task.fingerprint || task.fingerprint !== computedFp) {
    patch.fingerprint = computedFp;
    patch.scanCount = 0;
    patch.nextRealScanAtMs = nowMs;
    patch.nextRealScanReason = 'PROBE1_CONFIG';
    patch.lastErrorAt = null;
    patch.modeSafety = false;
    patch.stateVersion = task.stateVersion + 1;
    return {
      patch,
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'SCHEDULED'),
      traceForce: true,
      done: false,
    };
  }

  const probeReason = resolveDueElasticProbe({ task, tripMeta, nowMs });
  const willRealScan =
    probeReason != null && task.sentinelMode === 'SENTINEL' && disableRealScans !== true;

  if (willRealScan && probeReason) {
    return executeElasticProbe({ task, tripMeta, nowMs, reason: probeReason, mapsService });
  }

  const scanCount = Math.max(0, Math.round(task.scanCount));
  const next = scheduleNextElasticProbe({ task, tripMeta, scanCount, nowMs });
  patch.nextRealScanAtMs = next.nextRealScanAtMs;
  patch.nextRealScanReason = next.nextRealScanReason;
  patch.vigilanceStatus = 'VIGILANCE_BLUE';

  if (!hasTripStandardDurationMin(tripMeta) && scanCount === 0 && task.sentinelMode === 'STATIC') {
    patch.nextRealScanAtMs = null;
    patch.nextRealScanReason = null;
  }

  return {
    patch,
    goNoGo: null,
    probe3Unavailable: null,
    trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'SCHEDULED'),
    traceForce: false,
    done: false,
  };
}
