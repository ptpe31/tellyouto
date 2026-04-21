import type { TravelContext, TravelPrediction, TravelSchedulerState, TravelSnapshot } from './types';
import type { TravelStatsCache } from './cache';
import { computeStatsKey } from './cache';
import { buildTravelPrediction, toTravelSnapshot } from './engine';

export type MapsDoorToDoorSample = {
  doorToDoorMin: number;
};

export type TravelMapsService = {
  fetchDoorToDoor(params: {
    nowMs: number;
    transcript: string;
    destinationLabel?: string;
    arrivalAtMs?: number;
  }): Promise<MapsDoorToDoorSample | null>;
};

export type TravelTickInput = {
  ctx: TravelContext;
  state: TravelSchedulerState;
  cache: TravelStatsCache;
  maps?: TravelMapsService;
};

export type TravelTickOutput = {
  prediction: TravelPrediction;
  snapshot: TravelSnapshot;
  nextState: TravelSchedulerState;
  shouldFetchMaps: boolean;
  statsKey: ReturnType<typeof computeStatsKey>;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function shouldFetchByRisk(params: {
  nowMs: number;
  lastMapsAtMs: number | null;
  prediction: TravelPrediction;
  skipMapsByCache: boolean;
}): boolean {
  if (params.skipMapsByCache && params.prediction.elasticity < 0.25) return false;
  if (params.lastMapsAtMs === null) return params.prediction.elasticity >= 0.22;
  const ageMs = params.nowMs - params.lastMapsAtMs;
  if (ageMs < 0) return true;
  const baseInterval = params.prediction.nextJumpMs;
  const minInterval = clamp(Math.round(baseInterval * 0.55), 45_000, baseInterval);
  if (ageMs < minInterval) return false;
  if (params.prediction.risk === 'GO') return true;
  if (params.prediction.elasticity >= 0.48) return true;
  if (params.prediction.bufferSafetyMin !== null && params.prediction.bufferSafetyMin <= 18) return true;
  return ageMs >= baseInterval;
}

export async function travelTick(input: TravelTickInput): Promise<TravelTickOutput> {
  await input.cache.hydrate();

  const preliminary = buildTravelPrediction({
    ctx: input.ctx,
    bucket: null,
  });
  const statsKey = computeStatsKey({
    destinationKind: preliminary.destinationKind,
    mode: preliminary.mode,
    nowMs: input.ctx.nowMs,
  });
  const bucket = input.cache.getBucket(statsKey);

  const keyForCache = computeStatsKey({
    destinationKind: preliminary.destinationKind,
    mode: preliminary.mode,
    nowMs: input.ctx.nowMs,
  });
  const skipMapsByCache = input.cache.shouldSkipMaps(keyForCache, input.ctx.nowMs);

  const predictionBase = buildTravelPrediction({
    ctx: input.ctx,
    bucket,
  });

  const fetchable = input.maps != null && input.state.running;
  const shouldFetchMaps = fetchable
    ? shouldFetchByRisk({
        nowMs: input.ctx.nowMs,
        lastMapsAtMs: input.state.lastMapsAtMs,
        prediction: predictionBase,
        skipMapsByCache,
      })
    : false;

  if (!shouldFetchMaps) {
    const snapshot = toTravelSnapshot(predictionBase, input.ctx.nowMs);
    return {
      prediction: predictionBase,
      snapshot,
      nextState: {
        ...input.state,
        running: true,
        lastElasticity: predictionBase.elasticity,
      },
      shouldFetchMaps: false,
      statsKey,
    };
  }

  const sample = await input.maps!.fetchDoorToDoor({
    nowMs: input.ctx.nowMs,
    transcript: input.ctx.transcript,
    destinationLabel: input.ctx.destinationLabel,
    arrivalAtMs: input.ctx.arrivalAtMs,
  });

  const overrideBase = sample?.doorToDoorMin != null ? clamp(sample.doorToDoorMin, 1, 240) : null;

  const prediction = buildTravelPrediction({
    ctx: input.ctx,
    bucket,
    overrideBaseDurationMin: overrideBase ?? undefined,
    overrideTrafficMultiplier: 1,
  });

  if (overrideBase !== null) {
    input.cache.recordSample({
      key: statsKey,
      durationMin: overrideBase,
      nowMs: input.ctx.nowMs,
    });
    await input.cache.flush();
  }

  const snapshot = toTravelSnapshot(prediction, input.ctx.nowMs);
  return {
    prediction,
    snapshot,
    nextState: {
      lastMapsAtMs: input.ctx.nowMs,
      lastDoorToDoorMin: overrideBase,
      lastElasticity: prediction.elasticity,
      running: true,
    },
    shouldFetchMaps: true,
    statsKey,
  };
}

