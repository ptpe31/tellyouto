import { VERBOSE_DEBUG } from '../../config/verboseDebug';
import type { MapsService, TrafficSample, TripTaskRowV4 } from './TrafficSchedulerV4';

type CacheEntry = {
  sample: TrafficSample;
  fetchedAtMs: number;
};

function buildCacheKey(input: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode: string;
}): string {
  const r = (x: number) => Math.round(x * 10_000) / 10_000;
  return `${r(input.originLat)},${r(input.originLng)}|${r(input.destLat)},${r(input.destLng)}|${input.mode}`;
}

function getApiKey(): string {
  const k1 = String(process.env.EXPO_PUBLIC_GOOGLE_DISTANCE_MATRIX_API_KEY || '').trim();
  if (k1) return k1;
  return String(process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '').trim();
}

function normalizeMode(mode: string | null | undefined): string {
  const m = String(mode || '').toLowerCase();
  if (m === 'walking' || m === 'walk') return 'walking';
  if (m === 'bike' || m === 'bicycling') return 'bicycling';
  return 'driving';
}

export class DistanceMatrixMapsService implements MapsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 15 * 60 * 1000;
  private readonly timeoutMs = 8000;

  constructor(private readonly getNowMs: () => number = () => Date.now()) {}

  async fetchTrafficSample(task: TripTaskRowV4): Promise<TrafficSample> {
    const originLat = Number(task.originLat);
    const originLng = Number(task.originLng);
    const destLat = Number(task.destLat);
    const destLng = Number(task.destLng);
    const transportMode = String(task.transportMode || '');
    if (
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLng) ||
      !Number.isFinite(destLat) ||
      !Number.isFinite(destLng)
    ) {
      throw new Error('DistanceMatrixMapsService: missing coords');
    }
    const mode = normalizeMode(transportMode);
    const key = buildCacheKey({ originLat, originLng, destLat, destLng, mode });
    const nowMs = this.getNowMs();
    const cached = this.cache.get(key);
    if (cached && nowMs - cached.fetchedAtMs <= this.ttlMs) {
      return { ...cached.sample, fromCache: true, cacheKey: key };
    }

    const apiKey = getApiKey();
    if (!apiKey) throw new Error('DistanceMatrixMapsService: missing api key');

    console.log(
      `[API-CALL] 💸 GOOGLE DISTANCE MATRIX | Origins: ${originLat},${originLng} | Dest: ${destLat},${destLng} | Mode: ${mode}`,
    );

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${encodeURIComponent(`${originLat},${originLng}`)}` +
      `&destinations=${encodeURIComponent(`${destLat},${destLng}`)}` +
      `&mode=${encodeURIComponent(mode)}` +
      `&departure_time=${encodeURIComponent(String(Math.floor(nowMs / 1000)))}` +
      `&key=${encodeURIComponent(apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const t0 = nowMs;
    try {
      const res = await fetch(url, { signal: controller.signal });
      const json = (await res.json()) as unknown;
      if (!res.ok) throw new Error(`DistanceMatrix: http ${res.status}`);
      const latencyMs = Math.max(0, this.getNowMs() - t0);

      const rows = (json as { rows?: Array<{ elements?: Array<Record<string, unknown>> }> }).rows;
      const el = rows?.[0]?.elements?.[0];
      const durationValue = Number((el?.duration as { value?: number } | undefined)?.value);
      const durationTrafficValue = Number(
        (el?.duration_in_traffic as { value?: number } | undefined)?.value,
      );
      const trafficDurationSec = Number.isFinite(durationTrafficValue)
        ? Math.max(0, durationTrafficValue)
        : Number.isFinite(durationValue)
          ? Math.max(0, durationValue)
          : NaN;
      if (!Number.isFinite(trafficDurationSec)) throw new Error('DistanceMatrix: missing duration');

      const sample: TrafficSample = {
        trafficDurationSec,
        staticDurationSec: Number.isFinite(durationValue) ? Math.max(0, durationValue) : undefined,
        fromCache: false,
        cacheKey: key,
        latencyMs,
      };
      this.cache.set(key, { sample, fetchedAtMs: nowMs });
      if (VERBOSE_DEBUG) {
        console.log('[SENTINEL_V4][distance_matrix]', { key, trafficDurationSec, latencyMs });
      }
      return sample;
    } finally {
      clearTimeout(timeout);
    }
  }
}
