import {
  computeElasticBufferMin,
  computeElasticDepartureWindow,
  ELASTIC_BUFFER_BASE_MIN,
  isTrafficAbsorbedByElasticBuffer,
  normalizeElasticTransportMode,
  scheduleElasticProbes,
  skipsElasticProbe2,
} from '../../utils/elasticSlotEngine';
import { hasTripStandardDurationMin } from './sentinelElasticTripMetadata';
import type { TripTaskRowV4 } from './TrafficSchedulerV4';

/** Réexport observabilité créneau élastique — voir `src/utils/tripMathLogger.ts`. */
export { ENABLE_TRIP_MATH_LOGS, logTripMath } from '../../utils/tripMathLogger';

export const PROBE1_GPS_RETRY_MS = 3 * 60 * 1000;
export const PROBE2_WINDOW_MS = 5 * 60 * 1000;
export const PROBE2_RETRY_MS = 5 * 60 * 1000;
export const PROBE3_RETRY_MS = 2 * 60 * 1000;

export type ElasticProbeReason = 'PROBE1_CONFIG' | 'PROBE1_RETRY' | 'PROBE2_TREND' | 'PROBE3_GONOGO';

/** Verrou in-memory : une seule sonde élastique active par intentionId. */
const activeElasticProbes = new Set<string>();

export function tryAcquireElasticProbeLock(intentionId: string): boolean {
  const id = String(intentionId || '').trim();
  if (!id || activeElasticProbes.has(id)) return false;
  activeElasticProbes.add(id);
  return true;
}

export function releaseElasticProbeLock(intentionId: string): void {
  const id = String(intentionId || '').trim();
  if (id) activeElasticProbes.delete(id);
}

const LEGACY_PROBE_MAP: Record<string, ElasticProbeReason> = {
  SCAN1_INITIAL: 'PROBE1_CONFIG',
  SCAN2_ENTRY_ORANGE: 'PROBE2_TREND',
  SCAN2_RETRY: 'PROBE2_TREND',
  SCAN3_CRITICAL: 'PROBE3_GONOGO',
  PROBE1_CONFIG: 'PROBE1_CONFIG',
  PROBE1_RETRY: 'PROBE1_RETRY',
  PROBE2_TREND: 'PROBE2_TREND',
  PROBE3_GONOGO: 'PROBE3_GONOGO',
};

export function normalizeProbeReason(raw: string | null | undefined): ElasticProbeReason | null {
  if (!raw) return null;
  return LEGACY_PROBE_MAP[String(raw).trim()] ?? null;
}

export function resolveDStdMin(task: TripTaskRowV4, tripMeta: Record<string, unknown> | null): number {
  if (tripMeta && hasTripStandardDurationMin(tripMeta)) {
    return Number(tripMeta.standard_duration_min);
  }
  const scan1 = task.scan1DurationSec;
  if (scan1 != null && Number.isFinite(scan1) && scan1 > 0) {
    return Math.max(1, Math.round(scan1 / 60));
  }
  const target = task.lastTrafficDuration;
  if (target > 0) return Math.max(1, Math.round(target / 60));
  return 30;
}

export function resolveElasticWindowStartMs(task: TripTaskRowV4, tripMeta: Record<string, unknown> | null): number {
  if (tripMeta) {
    const stored = Number(tripMeta.elastic_start_ms);
    if (Number.isFinite(stored)) return stored;
  }
  const dStdMin = resolveDStdMin(task, tripMeta);
  const elasticMode = normalizeElasticTransportMode(task.transportMode);
  const window = computeElasticDepartureWindow(task.arrivalAtMs, dStdMin, elasticMode);
  return window?.startDate.getTime() ?? task.tOptimisteMs ?? task.arrivalAtMs - dStdMin * 60_000;
}

export function scheduleNextElasticProbe(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  scanCount: number;
  nowMs: number;
}): { nextRealScanAtMs: number | null; nextRealScanReason: ElasticProbeReason | null } {
  const { task, tripMeta, scanCount, nowMs } = input;
  const dStdMin = resolveDStdMin(task, tripMeta);
  const windowStartMs = resolveElasticWindowStartMs(task, tripMeta);
  const probes = scheduleElasticProbes({
    windowStartMs,
    dStdMin,
    nowMs,
    skipProbe2: skipsElasticProbe2(task.transportMode),
  });

  if (scanCount <= 0) {
    return { nextRealScanAtMs: nowMs, nextRealScanReason: 'PROBE1_CONFIG' };
  }
  if (scanCount === 1) {
    if (skipsElasticProbe2(task.transportMode)) {
      return {
        nextRealScanAtMs: probes?.probe3AtMs ?? nowMs,
        nextRealScanReason: 'PROBE3_GONOGO',
      };
    }
    if (probes?.probe2AtMs != null) {
      return { nextRealScanAtMs: probes.probe2AtMs, nextRealScanReason: 'PROBE2_TREND' };
    }
    return {
      nextRealScanAtMs: probes?.probe3AtMs ?? nowMs,
      nextRealScanReason: 'PROBE3_GONOGO',
    };
  }
  if (scanCount === 2) {
    return {
      nextRealScanAtMs: probes?.probe3AtMs ?? nowMs,
      nextRealScanReason: 'PROBE3_GONOGO',
    };
  }
  return { nextRealScanAtMs: null, nextRealScanReason: null };
}

export function resolveDueElasticProbe(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  nowMs: number;
}): ElasticProbeReason | null {
  const { task, tripMeta, nowMs } = input;
  const scanCount = Math.max(0, Math.round(task.scanCount));
  if (scanCount >= 3) return null;

  const scheduledReason = normalizeProbeReason(task.nextRealScanReason);
  const nextAt = task.nextRealScanAtMs;

  if (scanCount === 0 || !hasTripStandardDurationMin(tripMeta)) {
    if (nextAt == null || nowMs >= nextAt) return scheduledReason ?? 'PROBE1_CONFIG';
    return null;
  }

  if (nextAt == null || scheduledReason == null) return null;
  if (nowMs < nextAt) return null;
  if (scheduledReason === 'PROBE2_TREND' && skipsElasticProbe2(task.transportMode)) {
    return 'PROBE3_GONOGO';
  }
  return scheduledReason;
}

export function evaluateProbe2Overflow(input: {
  dLiveMin: number;
  dStdMin: number;
  bufferMin: number;
}): boolean {
  return !isTrafficAbsorbedByElasticBuffer(input.dLiveMin, input.dStdMin, input.bufferMin);
}

export function computeBufferForTask(task: TripTaskRowV4, tripMeta: Record<string, unknown> | null): number {
  const stored = tripMeta ? Number(tripMeta.elastic_buffer_min) : NaN;
  if (Number.isFinite(stored) && stored > 0) return stored;
  const dStdMin = resolveDStdMin(task, tripMeta);
  const elasticMode = normalizeElasticTransportMode(task.transportMode);
  return computeElasticBufferMin(dStdMin, elasticMode) ?? ELASTIC_BUFFER_BASE_MIN;
}

export function computeDepartInMinutes(arrivalAtMs: number, dLiveSec: number, nowMs: number): number {
  const departAtMs = arrivalAtMs - dLiveSec * 1000;
  return Math.max(0, Math.round((departAtMs - nowMs) / 60_000));
}

/** Atténuation projection tendance trafic — bouchon qui grossit (agressif). */
export const TRAFFIC_TREND_DAMPING_POSITIVE = 0.6;
/** Atténuation projection tendance trafic — trafic qui se dégage (prudent). */
export const TRAFFIC_TREND_DAMPING_NEGATIVE = 0.25;

export type TrafficTrendProjection = {
  baselineDurationSec: number;
  currentDurationSec: number;
  baselineAtMs: number;
  currentAtMs: number;
  deltaDurationMin: number;
  deltaTimeMin: number;
  /** Vitesse de croissance de l'embouteillage (min/min). */
  growthRateMinPerMin: number;
  timeToDepartureMin: number;
  projectedDurationMin: number;
  finalDurationMin: number;
  finalDurationSec: number;
  dampingFactor: number;
};

/**
 * Projette la durée trajet à partir de la tendance PROBE1 → PROBE2 (modèle flux / onde de choc).
 * Trend = (D_P2 − D_P1) / Δt ; projection = D_P2 + Trend × temps_avant_départ, atténuée.
 */
export function computeTrafficTrendProjection(input: {
  baselineDurationSec: number;
  currentDurationSec: number;
  baselineAtMs: number;
  currentAtMs: number;
  /** Borne haute du créneau (limite départ) — horizon de projection. */
  windowEndMs: number;
  nowMs: number;
}): TrafficTrendProjection {
  const baselineSec = Math.max(0, Number(input.baselineDurationSec) || 0);
  const currentSec = Math.max(0, Number(input.currentDurationSec) || 0);
  const baselineMin = baselineSec / 60;
  const currentMin = Math.max(1, currentSec / 60);

  const deltaDurationMin = currentMin - baselineMin;
  const deltaTimeMs = Math.max(
    60_000,
    Number(input.currentAtMs) - Number(input.baselineAtMs),
  );
  const deltaTimeMin = deltaTimeMs / 60_000;
  const growthRateMinPerMin = deltaDurationMin / deltaTimeMin;

  const timeToDepartureMin = Math.max(
    0,
    (Number(input.windowEndMs) - Number(input.nowMs)) / 60_000,
  );

  const rawProjectedMin = currentMin + growthRateMinPerMin * timeToDepartureMin;
  const projectedDeltaMin = rawProjectedMin - currentMin;
  const dampingFactor =
    growthRateMinPerMin > 0 ? TRAFFIC_TREND_DAMPING_POSITIVE : TRAFFIC_TREND_DAMPING_NEGATIVE;
  const dampedDeltaMin = projectedDeltaMin * dampingFactor;
  const finalDurationMin = Math.max(1, Math.round(currentMin + dampedDeltaMin));

  return {
    baselineDurationSec: baselineSec,
    currentDurationSec: currentSec,
    baselineAtMs: input.baselineAtMs,
    currentAtMs: input.currentAtMs,
    deltaDurationMin,
    deltaTimeMin,
    growthRateMinPerMin,
    timeToDepartureMin,
    projectedDurationMin: Math.max(1, Math.round(rawProjectedMin)),
    finalDurationMin,
    finalDurationSec: finalDurationMin * 60,
    dampingFactor,
  };
}

export function resolveProbe1BaselineAtMs(task: TripTaskRowV4, nowMs: number): number {
  const scan1At = task.scan1AtMs;
  if (scan1At != null && Number.isFinite(scan1At) && scan1At > 0) return scan1At;
  return nowMs - 45 * 60_000;
}

export function resolveProbe1BaselineDurationSec(task: TripTaskRowV4, fallbackSec: number): number {
  const scan1 = task.scan1DurationSec;
  if (scan1 != null && Number.isFinite(scan1) && scan1 > 0) return scan1;
  return Math.max(0, fallbackSec);
}

export function buildProbeFailureRecovery(input: {
  task: TripTaskRowV4;
  reason: ElasticProbeReason;
  nowMs: number;
}): Partial<TripTaskRowV4> {
  const { task, reason, nowMs } = input;
  const patch: Partial<TripTaskRowV4> = {
    lastErrorAt: nowMs,
    status: 'ACTIVE',
    modeSafety: false,
  };

  if (reason === 'PROBE2_TREND') {
    patch.nextRealScanAtMs = nowMs + PROBE2_RETRY_MS;
    patch.nextRealScanReason = 'PROBE2_TREND';
    return patch;
  }

  if (reason === 'PROBE3_GONOGO') {
    patch.nextRealScanAtMs = nowMs + PROBE3_RETRY_MS;
    patch.nextRealScanReason = 'PROBE3_GONOGO';
    return patch;
  }

  patch.nextRealScanAtMs = nowMs + PROBE1_GPS_RETRY_MS;
  patch.nextRealScanReason = 'PROBE1_RETRY';
  patch.stateVersion = task.stateVersion + 1;
  return patch;
}
