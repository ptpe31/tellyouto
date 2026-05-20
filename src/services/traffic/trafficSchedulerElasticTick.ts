import { getTrankilV2IntentionById } from '../../api/trankilV2Db';
import {
  applyPessimisticAnchor,
  computeBaseSmartBufferMin,
  computeDegradationRatio,
  computeProbe1DepartureTimeUnix,
  computeProposedWindowAnchor,
  computePrudenceAlpha,
  computePredictiveBufferMin,
  isWithinTrafficDeadZone,
  readElasticWindowAnchor,
  shouldSkipProbe3Api,
  skipsElasticProbe2,
  type WindowAnchor,
} from '../../utils/elasticSlotEngine';
import { logTripMath, resolveTripMathAlias } from '../../utils/tripMathLogger';
import { isTripAllDay, parseTripArrivalIso } from '../../utils/tripElasticDisplay';
import { getForegroundOriginSnapshot } from './SentinelLocationService';
import {
  buildContractTripPatch,
  hasTripStandardDurationMin,
  patchTripElasticMetadata,
} from './sentinelElasticTripMetadata';
import {
  computeBufferForTask,
  computeDepartInMinutesFromAnchor,
  PROBE1_GPS_RETRY_MS,
  buildProbeFailureRecovery,
  releaseElasticProbeLock,
  normalizeProbeReason,
  resolveDueElasticProbe,
  resolveIdealDurationMin,
  resolvePredictedDurationMin,
  resolveTrafficDeltaMin,
  scheduleNextElasticProbe,
  tryAcquireElasticProbeLock,
  type ElasticProbeReason,
} from './sentinelElasticProbes';
import type { FetchTrafficSampleOptions, MapsService, TripTaskRowV4 } from './TrafficSchedulerV4';

type FlowMode = 'REAL' | 'SCHEDULED';

type ProbeExecutionContext = {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  nowMs: number;
  mapsService: MapsService;
};

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

function baseTrace(
  task: TripTaskRowV4,
  startMs: number,
  endMs: number,
  flowMode: FlowMode,
): ElasticTickResult['trace'] {
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

function applyDisplayedContractPatch(
  patch: Partial<TripTaskRowV4>,
  anchor: WindowAnchor,
  uiUpdate: boolean,
): void {
  patch.tOptimisteMs = anchor.startMs;
  patch.tPessimisteMs = anchor.endMs;
  patch.baseTOptimisteMs = anchor.startMs;
  patch.baseTPessimisteMs = anchor.endMs;
  if (uiUpdate) {
    patch.displayedTOptimisteMs = anchor.startMs;
    patch.displayedTPessimisteMs = anchor.endMs;
    patch.lastUiUpdateAtMs = Date.now();
  }
}

function readStoredAlpha(tripMeta: Record<string, unknown> | null): number {
  const alpha = tripMeta ? Number(tripMeta.elastic_prudence_alpha) : NaN;
  return Number.isFinite(alpha) && alpha > 0 ? alpha : 1;
}

function readStoredRatioD(tripMeta: Record<string, unknown> | null): number | null {
  const ratio = tripMeta ? Number(tripMeta.elastic_degradation_ratio) : NaN;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
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

async function fetchTrafficWithAccounting(
  task: TripTaskRowV4,
  patch: Partial<TripTaskRowV4>,
  mapsService: MapsService,
  fetchOpts?: FetchTrafficSampleOptions,
): Promise<{ trafficSec: number; staticSec: number }> {
  const sample = await mapsService.fetchTrafficSample(
    {
      ...task,
      originLat: patch.originLat ?? task.originLat,
      originLng: patch.originLng ?? task.originLng,
    },
    fetchOpts,
  );
  const fromCache = sample.fromCache === true;
  patch.apiCallsAvoidedCache = task.apiCallsAvoidedCache + (fromCache ? 1 : 0);
  patch.apiCallsTotal = task.apiCallsTotal + (fromCache ? 0 : 1);
  const trafficSec = Math.max(0, Number(sample.trafficDurationSec) || 0);
  const staticSec = Math.max(
    0,
    Number(sample.staticDurationSec ?? sample.trafficDurationSec) || 0,
  );
  return { trafficSec, staticSec };
}

async function executeProbe1Contract(ctx: ProbeExecutionContext): Promise<ElasticTickResult> {
  const { task, tripMeta, nowMs, mapsService } = ctx;
  const patch: Partial<TripTaskRowV4> = {};
  const reason: ElasticProbeReason =
    normalizeProbeReason(task.nextRealScanReason) === 'PROBE1_RETRY'
      ? 'PROBE1_RETRY'
      : 'PROBE1_CONFIG';

  const origin = await resolveOriginCoords(task, tripMeta, reason);
  if (!origin) {
    return probe1GpsFailure(task, patch, nowMs);
  }
  patch.originLat = origin.lat;
  patch.originLng = origin.lng;

  if (!hasValidDestination(task)) {
    return probe1DestFailure(task, patch, nowMs);
  }

  try {
    const estimateIdeal = resolveIdealDurationMin(task, tripMeta);
    const bufferBase = computeBaseSmartBufferMin(estimateIdeal) ?? 15;
    const departureTimeUnix = computeProbe1DepartureTimeUnix({
      arrivalMs: task.arrivalAtMs,
      tIdealMin: estimateIdeal,
      bufferBaseMin: bufferBase,
    });

    patch.lastRealScanAtMs = nowMs;
    patch.lastErrorAt = null;
    patch.status = 'ACTIVE';
    patch.modeSafety = false;

    const { trafficSec, staticSec } = await fetchTrafficWithAccounting(task, patch, mapsService, {
      departureTimeUnix,
    });

    const tIdealMin = Math.max(1, Math.round(staticSec / 60));
    const tPredMin = Math.max(1, Math.round(trafficSec / 60));
    const ratioD = computeDegradationRatio(tPredMin, tIdealMin);
    const alpha = computePrudenceAlpha(ratioD);
    const bufferMin = computePredictiveBufferMin(tIdealMin, alpha);

    const proposed = computeProposedWindowAnchor({
      arrivalMs: task.arrivalAtMs,
      tUsedMin: tPredMin,
      alpha,
      bufferMin,
    });
    if (!proposed) throw new Error('contract anchor failed');

    const { anchor } = applyPessimisticAnchor(null, proposed);
    const metaPatch = buildContractTripPatch({
      anchor,
      bufferMin,
      tIdealMin,
      tPredMin,
      ratioD,
      alpha,
      approximate: false,
      shifted: false,
    });

    logTripMath({
      reason,
      alias: resolveTripMathAlias(tripMeta, task.destination),
      targetArrivalMs: task.arrivalAtMs,
      apiTrajetMin: tPredMin,
      bufferMin,
      windowStartMs: anchor.startMs,
      windowEndMs: anchor.endMs,
      ratioD,
      alpha,
      uiUpdate: true,
    });

    await patchTripElasticMetadata(task.id, {
      ...metaPatch,
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      last_traffic_duration: trafficSec,
    });

    patch.scanCount = 1;
    patch.scan1AtMs = nowMs;
    patch.scan1DurationSec = staticSec;
    patch.lastTrafficDuration = trafficSec;
    applyDisplayedContractPatch(patch, anchor, true);
    patch.vigilanceStatus = 'VIGILANCE_BLUE';
    patch.stateVersion = task.stateVersion + 1;

    const next = scheduleNextElasticProbe({
      task: { ...task, ...patch, scanCount: 1, scan1DurationSec: staticSec },
      tripMeta: { ...(tripMeta ?? {}), ...metaPatch },
      scanCount: 1,
      nowMs,
    });
    patch.nextRealScanAtMs = next.nextRealScanAtMs;
    patch.nextRealScanReason = next.nextRealScanReason;

    return {
      patch,
      goNoGo: null,
      probe3Unavailable: null,
      trace: baseTrace(task, anchor.startMs, anchor.endMs, 'REAL'),
      traceForce: true,
      done: false,
    };
  } catch (err) {
    return probeFailure(task, patch, nowMs, reason, err);
  }
}

async function executeProbe2Contract(ctx: ProbeExecutionContext): Promise<ElasticTickResult> {
  const { task, tripMeta, nowMs, mapsService } = ctx;
  const patch: Partial<TripTaskRowV4> = {};
  const reason: ElasticProbeReason = 'PROBE2_TREND';

  if (skipsElasticProbe2(task.transportMode)) {
    throw new Error('PROBE2 skipped for non-driving mode');
  }

  const origin = await resolveOriginCoords(task, tripMeta, reason);
  if (!origin) {
    return probeFailure(task, patch, nowMs, reason, new Error('origin missing'));
  }
  patch.originLat = origin.lat;
  patch.originLng = origin.lng;
  if (!hasValidDestination(task)) {
    return probeFailure(task, patch, nowMs, reason, new Error('destination missing'));
  }

  try {
    patch.lastRealScanAtMs = nowMs;
    patch.lastErrorAt = null;
    patch.status = 'ACTIVE';
    patch.modeSafety = false;

    const { trafficSec } = await fetchTrafficWithAccounting(task, patch, mapsService);
    const dLiveMin = Math.max(1, Math.round(trafficSec / 60));
    const alpha = readStoredAlpha(tripMeta);
    const bufferMin = computeBufferForTask(task, tripMeta);
    const ratioD = readStoredRatioD(tripMeta);
    const tIdealMin = resolveIdealDurationMin(task, tripMeta);
    const { deltaMin, baselineMin } = resolveTrafficDeltaMin(dLiveMin, tripMeta);
    const uiUpdate = !isWithinTrafficDeadZone(deltaMin);

    const previousAnchor = readElasticWindowAnchor(tripMeta);
    let anchor = previousAnchor ?? {
      startMs: task.tOptimisteMs ?? nowMs,
      endMs: task.tPessimisteMs ?? nowMs,
      durationMin: baselineMin,
    };

    let shifted = tripMeta?.elastic_shifted === true;
    if (uiUpdate) {
      const proposed = computeProposedWindowAnchor({
        arrivalMs: task.arrivalAtMs,
        tUsedMin: dLiveMin,
        alpha,
        bufferMin,
      });
      if (proposed) {
        const merged = applyPessimisticAnchor(previousAnchor, proposed);
        anchor = merged.anchor;
        shifted = shifted || (previousAnchor != null && merged.changed);
        const metaPatch = buildContractTripPatch({
          anchor,
          bufferMin,
          tIdealMin,
          tPredMin: resolvePredictedDurationMin(task, tripMeta),
          ratioD: ratioD ?? computeDegradationRatio(dLiveMin, tIdealMin),
          alpha,
          shifted,
        });
        await patchTripElasticMetadata(task.id, {
          ...metaPatch,
          last_traffic_duration: trafficSec,
        });
        if (shifted) {
          console.log(`[TRIP-SENTINEL] ⚠️ Contrat reculé for ${task.id}`);
        }
      }
    } else {
      await patchTripElasticMetadata(task.id, { last_traffic_duration: trafficSec });
    }

    logTripMath({
      reason,
      alias: resolveTripMathAlias(tripMeta, task.destination),
      targetArrivalMs: task.arrivalAtMs,
      apiTrajetMin: dLiveMin,
      bufferMin,
      windowStartMs: anchor.startMs,
      windowEndMs: anchor.endMs,
      previousTrajetMin: baselineMin,
      ratioD: ratioD ?? undefined,
      alpha,
      uiUpdate,
    });

    patch.scanCount = 2;
    patch.scan2AtMs = nowMs;
    patch.scan2DurationSec = trafficSec;
    patch.lastTrafficDuration = trafficSec;
    patch.stateVersion = task.stateVersion + 1;
    applyDisplayedContractPatch(patch, anchor, uiUpdate);
    patch.vigilanceStatus = 'VIGILANCE_ORANGE';

    const next = scheduleNextElasticProbe({
      task: { ...task, ...patch, scanCount: 2 },
      tripMeta: {
        ...(tripMeta ?? {}),
        elastic_anchor_start_ms: anchor.startMs,
        elastic_start_ms: anchor.startMs,
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
      trace: baseTrace(task, anchor.startMs, anchor.endMs, 'REAL'),
      traceForce: true,
      done: false,
    };
  } catch (err) {
    return probeFailure(task, patch, nowMs, reason, err);
  }
}

async function executeProbe3Contract(ctx: ProbeExecutionContext): Promise<ElasticTickResult> {
  const { task, tripMeta, nowMs, mapsService } = ctx;
  const patch: Partial<TripTaskRowV4> = {};
  const reason: ElasticProbeReason = 'PROBE3_GONOGO';

  const origin = await resolveOriginCoords(task, tripMeta, reason);
  if (!origin) {
    return probeFailure(task, patch, nowMs, reason, new Error('origin missing'), true);
  }
  patch.originLat = origin.lat;
  patch.originLng = origin.lng;
  if (!hasValidDestination(task)) {
    return probeFailure(task, patch, nowMs, reason, new Error('destination missing'), true);
  }

  try {
    patch.lastRealScanAtMs = nowMs;
    patch.lastErrorAt = null;

    const { trafficSec } = await fetchTrafficWithAccounting(task, patch, mapsService);
    return finalizeProbe3FromMeasurement({
      task,
      tripMeta,
      patch,
      nowMs,
      trafficSec,
      probe3Skipped: false,
      flowMode: 'REAL',
    });
  } catch (err) {
    return probeFailure(task, patch, nowMs, reason, err, true);
  }
}

async function finalizeProbe3Silent(ctx: ProbeExecutionContext): Promise<ElasticTickResult> {
  const { task, tripMeta, nowMs } = ctx;
  const patch: Partial<TripTaskRowV4> = {};
  patch.apiCallsAvoidedExtrapolation = task.apiCallsAvoidedExtrapolation + 1;

  const trafficSec = Math.max(
    0,
    Number(task.scan2DurationSec ?? task.scan1DurationSec ?? task.lastTrafficDuration) || 0,
  );

  return finalizeProbe3FromMeasurement({
    task,
    tripMeta,
    patch,
    nowMs,
    trafficSec,
    probe3Skipped: true,
    flowMode: 'SCHEDULED',
  });
}

async function finalizeProbe3FromMeasurement(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  patch: Partial<TripTaskRowV4>;
  nowMs: number;
  trafficSec: number;
  probe3Skipped: boolean;
  flowMode: FlowMode;
}): Promise<ElasticTickResult> {
  const { task, tripMeta, patch, nowMs, trafficSec, probe3Skipped, flowMode } = input;
  const fallbackSec = Number(task.scan2DurationSec ?? task.scan1DurationSec ?? 0);
  const measureSec = trafficSec > 0 ? trafficSec : fallbackSec;
  const dLiveMin = Math.max(1, Math.round(measureSec / 60));
  const alpha = readStoredAlpha(tripMeta);
  const bufferMin = computeBufferForTask(task, tripMeta);
  const ratioD = readStoredRatioD(tripMeta);
  const tIdealMin = resolveIdealDurationMin(task, tripMeta);
  const { deltaMin, baselineMin } = resolveTrafficDeltaMin(dLiveMin, tripMeta);
  const uiUpdate = !probe3Skipped && !isWithinTrafficDeadZone(deltaMin);

  const previousAnchor = readElasticWindowAnchor(tripMeta);
  let anchor = previousAnchor ?? {
    startMs: task.tOptimisteMs ?? nowMs,
    endMs: task.tPessimisteMs ?? nowMs,
    durationMin: baselineMin,
  };

  if (uiUpdate) {
    const proposed = computeProposedWindowAnchor({
      arrivalMs: task.arrivalAtMs,
      tUsedMin: dLiveMin,
      alpha,
      bufferMin,
    });
    if (proposed) {
      const merged = applyPessimisticAnchor(previousAnchor, proposed);
      anchor = merged.anchor;
    }
  }

  const departInMin = computeDepartInMinutesFromAnchor(anchor.endMs, nowMs);
  const variant: 'smooth' | 'leave_now' =
    departInMin < 10 || departInMin <= 5 ? 'leave_now' : 'smooth';

  logTripMath({
    reason: 'PROBE3_GONOGO',
    alias: resolveTripMathAlias(tripMeta, task.destination),
    targetArrivalMs: task.arrivalAtMs,
    apiTrajetMin: dLiveMin,
    bufferMin,
    windowStartMs: anchor.startMs,
    windowEndMs: anchor.endMs,
    previousTrajetMin: baselineMin,
    ratioD: ratioD ?? undefined,
    alpha,
    uiUpdate: uiUpdate || probe3Skipped,
    probe3Skipped,
  });

  patch.scanCount = 3;
  patch.lastTrafficDuration = trafficSec > 0 ? trafficSec : task.lastTrafficDuration;
  patch.status = 'DONE';
  patch.vigilanceStatus = 'FINISHED';
  patch.nextRealScanAtMs = null;
  patch.nextRealScanReason = null;
  patch.stateVersion = task.stateVersion + 1;
  applyDisplayedContractPatch(patch, anchor, true);

  await patchTripElasticMetadata(task.id, {
    ...buildContractTripPatch({
      anchor,
      bufferMin,
      tIdealMin,
      tPredMin: resolvePredictedDurationMin(task, tripMeta),
      ratioD: ratioD ?? computeDegradationRatio(dLiveMin, tIdealMin),
      alpha,
      probe3Skipped,
    }),
    last_traffic_duration: patch.lastTrafficDuration ?? trafficSec,
  });

  return {
    patch,
    goNoGo: {
      variant,
      departInMin: variant === 'smooth' ? Math.max(1, departInMin) : 0,
    },
    probe3Unavailable: null,
    trace: baseTrace(task, anchor.startMs, anchor.endMs, flowMode),
    traceForce: true,
    done: true,
  };
}

function shouldSkipProbe3ForTask(
  task: TripTaskRowV4,
  tripMeta: Record<string, unknown> | null,
  nowMs: number,
): boolean {
  const anchor = readElasticWindowAnchor(tripMeta);
  if (!anchor) return false;
  const dLiveMin = Math.max(
    1,
    Math.round(Number(task.scan2DurationSec ?? task.scan1DurationSec ?? 0) / 60) || 1,
  );
  const { deltaMin } = resolveTrafficDeltaMin(dLiveMin, tripMeta);
  const timeToDepartureMin = computeDepartInMinutesFromAnchor(anchor.endMs, nowMs);
  return shouldSkipProbe3Api({ deltaMin, timeToDepartureMin });
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

  const ctx: ProbeExecutionContext = { task, tripMeta, nowMs, mapsService };
  try {
    console.log(`[TRIP-SENTINEL] 🔭 ${reason} for ${task.id}`);
    switch (reason) {
      case 'PROBE1_CONFIG':
      case 'PROBE1_RETRY':
        return executeProbe1Contract(ctx);
      case 'PROBE2_TREND':
        return executeProbe2Contract(ctx);
      case 'PROBE3_GONOGO':
        return executeProbe3Contract(ctx);
      default:
        throw new Error(`Unknown probe reason: ${reason}`);
    }
  } finally {
    releaseElasticProbeLock(intentionId);
  }
}

function hasValidDestination(task: TripTaskRowV4): boolean {
  return (
    task.destLat != null &&
    task.destLng != null &&
    Number.isFinite(task.destLat) &&
    Number.isFinite(task.destLng)
  );
}

function probe1GpsFailure(
  task: TripTaskRowV4,
  patch: Partial<TripTaskRowV4>,
  nowMs: number,
): ElasticTickResult {
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

function probe1DestFailure(
  task: TripTaskRowV4,
  patch: Partial<TripTaskRowV4>,
  nowMs: number,
): ElasticTickResult {
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

function probeFailure(
  task: TripTaskRowV4,
  patch: Partial<TripTaskRowV4>,
  nowMs: number,
  reason: ElasticProbeReason,
  err: unknown,
  probe3 = false,
): ElasticTickResult {
  console.error(`[TRIP-ERROR] Probe failed for ID: ${task.id}`, err);
  Object.assign(patch, buildProbeFailureRecovery({ task, reason, nowMs }));
  return {
    patch,
    goNoGo: null,
    probe3Unavailable: probe3 ? { destination: task.destination } : null,
    trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'REAL'),
    traceForce: true,
    done: false,
  };
}

function handleIdleState(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  nowMs: number;
}): ElasticTickResult {
  const { task, tripMeta, nowMs } = input;
  const patch: Partial<TripTaskRowV4> = {};
  const scanCount = Math.max(0, Math.round(task.scanCount));
  const next = scheduleNextElasticProbe({ task, tripMeta, scanCount, nowMs });
  patch.nextRealScanAtMs = next.nextRealScanAtMs;
  patch.nextRealScanReason = next.nextRealScanReason;
  patch.vigilanceStatus = 'VIGILANCE_BLUE';

  if (!hasTripStandardDurationMin(tripMeta) && scanCount === 0 && task.sentinelMode === 'STATIC') {
    patch.nextRealScanAtMs = null;
    patch.nextRealScanReason = null;
  }

  const startMs = task.displayedTOptimisteMs ?? task.tOptimisteMs ?? nowMs;
  const endMs = task.displayedTPessimisteMs ?? task.tPessimisteMs ?? nowMs;
  return {
    patch,
    goNoGo: null,
    probe3Unavailable: null,
    trace: baseTrace(task, startMs, endMs, 'SCHEDULED'),
    traceForce: false,
    done: false,
  };
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
      trace: baseTrace(task, task.tOptimisteMs ?? nowMs, task.tPessimisteMs ?? nowMs, 'SCHEDULED'),
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

  if (willRealScan && probeReason === 'PROBE3_GONOGO' && shouldSkipProbe3ForTask(task, tripMeta, nowMs)) {
    return finalizeProbe3Silent({ task, tripMeta, nowMs, mapsService });
  }

  if (willRealScan && probeReason) {
    return executeElasticProbe({ task, tripMeta, nowMs, reason: probeReason, mapsService });
  }

  return handleIdleState({ task, tripMeta, nowMs });
}
