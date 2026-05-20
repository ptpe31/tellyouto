import {
  DEFAULT_ELASTIC_D_STD_MIN,
  ELASTIC_BUFFER_BASE_MIN,
  computePredictiveBufferMin,
  readElasticWindowAnchor,
  scheduleElasticProbes,
  skipsElasticProbe2,
} from '../../utils/elasticSlotEngine';
import { hasTripStandardDurationMin } from './sentinelElasticTripMetadata';
import type { TripTaskRowV4 } from './TrafficSchedulerV4';

export const PROBE1_GPS_RETRY_MS = 3 * 60 * 1000;
export const PROBE2_RETRY_MS = 5 * 60 * 1000;
export const PROBE3_RETRY_MS = 2 * 60 * 1000;

export type ElasticProbeReason = 'PROBE1_CONFIG' | 'PROBE1_RETRY' | 'PROBE2_TREND' | 'PROBE3_GONOGO';

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

export function resolveIdealDurationMin(
  task: TripTaskRowV4,
  tripMeta: Record<string, unknown> | null,
): number {
  if (tripMeta && hasTripStandardDurationMin(tripMeta)) {
    return Math.max(1, Math.round(Number(tripMeta.standard_duration_min)));
  }
  const scan1 = task.scan1DurationSec;
  if (scan1 != null && Number.isFinite(scan1) && scan1 > 0) {
    return Math.max(1, Math.round(scan1 / 60));
  }
  return DEFAULT_ELASTIC_D_STD_MIN;
}

export function resolvePredictedDurationMin(
  task: TripTaskRowV4,
  tripMeta: Record<string, unknown> | null,
): number {
  if (tripMeta) {
    const stored = Number(tripMeta.elastic_predicted_duration_min);
    if (Number.isFinite(stored) && stored > 0) return Math.max(1, Math.round(stored));
  }
  const scan1 = task.scan1DurationSec;
  if (scan1 != null && Number.isFinite(scan1) && scan1 > 0) {
    return Math.max(1, Math.round(scan1 / 60));
  }
  return resolveIdealDurationMin(task, tripMeta);
}

export function resolveElasticWindowStartMs(
  task: TripTaskRowV4,
  tripMeta: Record<string, unknown> | null,
): number {
  const anchor = readElasticWindowAnchor(tripMeta ?? undefined);
  if (anchor) return anchor.startMs;
  if (tripMeta) {
    const stored = Number(tripMeta.elastic_start_ms);
    if (Number.isFinite(stored)) return stored;
  }
  const dMin = resolvePredictedDurationMin(task, tripMeta);
  return task.tOptimisteMs ?? task.arrivalAtMs - dMin * 60_000;
}

export function resolveContractBaselineDurationMin(
  tripMeta: Record<string, unknown> | null,
): number {
  if (tripMeta) {
    const anchored = Number(tripMeta.elastic_anchor_duration_min);
    if (Number.isFinite(anchored) && anchored > 0) return Math.max(1, Math.round(anchored));
    const predicted = Number(tripMeta.elastic_predicted_duration_min);
    if (Number.isFinite(predicted) && predicted > 0) return Math.max(1, Math.round(predicted));
  }
  return DEFAULT_ELASTIC_D_STD_MIN;
}

export function resolveTrafficDeltaMin(
  measuredMin: number,
  tripMeta: Record<string, unknown> | null,
): { deltaMin: number; baselineMin: number } {
  const baselineMin = resolveContractBaselineDurationMin(tripMeta);
  const measured = Math.max(1, Math.round(measuredMin));
  return { deltaMin: measured - baselineMin, baselineMin };
}

export function computeBufferForTask(
  task: TripTaskRowV4,
  tripMeta: Record<string, unknown> | null,
): number {
  const stored = tripMeta ? Number(tripMeta.elastic_buffer_min) : NaN;
  if (Number.isFinite(stored) && stored > 0) return stored;
  const alpha = tripMeta ? Number(tripMeta.elastic_prudence_alpha) : NaN;
  if (Number.isFinite(alpha) && alpha > 0) {
    const ideal = resolveIdealDurationMin(task, tripMeta);
    return computePredictiveBufferMin(ideal, alpha);
  }
  return ELASTIC_BUFFER_BASE_MIN;
}

export function computeDepartInMinutesFromAnchor(anchorEndMs: number, nowMs: number): number {
  return Math.max(0, Math.round((Number(anchorEndMs) - Number(nowMs)) / 60_000));
}

export function scheduleNextElasticProbe(input: {
  task: TripTaskRowV4;
  tripMeta: Record<string, unknown> | null;
  scanCount: number;
  nowMs: number;
}): { nextRealScanAtMs: number | null; nextRealScanReason: ElasticProbeReason | null } {
  const { task, tripMeta, scanCount, nowMs } = input;
  const dStdMin = resolvePredictedDurationMin(task, tripMeta);
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
