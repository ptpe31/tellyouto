import AsyncStorage from '@react-native-async-storage/async-storage';

import { VERBOSE_DEBUG } from '../../config/verboseDebug';
import type { MapsService, TrafficSample, TripTaskRowV4 } from './TrafficSchedulerV4';

type CacheEntry = {
  sample: TrafficSample;
  fetchedAtMs: number;
};

type PersistedCacheEntry = {
  sample: TrafficSample;
  fetchedAtMs: number;
};

export type FetchTrafficSampleOptions = {
  departureTimeUnix?: number;
};

const STORAGE_PREFIX = '@trankil/distance_matrix_cache/';
const GRID_DECIMALS = 3;

/** Arrondi grid ~100 m — variations GPS mineures partagent la même clé. */
function roundGridCoord(value: number): number {
  const factor = 10 ** GRID_DECIMALS;
  return Math.round(Number(value) * factor) / factor;
}

function buildCacheKey(input: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode: string;
  departureTimeUnix?: number;
}): string {
  const r = roundGridCoord;
  const depart =
    input.departureTimeUnix != null && Number.isFinite(input.departureTimeUnix)
      ? `|d${Math.floor(input.departureTimeUnix / 300) * 300}`
      : '|now';
  return `${r(input.originLat)},${r(input.originLng)}|${r(input.destLat)},${r(input.destLng)}|${input.mode}${depart}`;
}

function storageKeyFor(cacheKey: string): string {
  return `${STORAGE_PREFIX}${cacheKey}`;
}

async function readPersistedCache(
  cacheKey: string,
  nowMs: number,
  ttlMs: number,
): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKeyFor(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCacheEntry;
    if (!parsed?.sample || !Number.isFinite(parsed.fetchedAtMs)) return null;
    if (nowMs - parsed.fetchedAtMs > ttlMs) {
      void AsyncStorage.removeItem(storageKeyFor(cacheKey));
      return null;
    }
    return { sample: parsed.sample, fetchedAtMs: parsed.fetchedAtMs };
  } catch {
    return null;
  }
}

async function writePersistedCache(cacheKey: string, entry: CacheEntry): Promise<void> {
  try {
    const payload: PersistedCacheEntry = {
      sample: entry.sample,
      fetchedAtMs: entry.fetchedAtMs,
    };
    await AsyncStorage.setItem(storageKeyFor(cacheKey), JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
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
  private readonly memoryCache = new Map<string, CacheEntry>();
  private readonly ttlMs = 15 * 60 * 1000;
  private readonly timeoutMs = 8000;

  constructor(private readonly getNowMs: () => number = () => Date.now()) {}

  async fetchTrafficSample(
    task: TripTaskRowV4,
    opts?: FetchTrafficSampleOptions,
  ): Promise<TrafficSample> {
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
    const nowMs = this.getNowMs();
    const departureTimeUnix =
      opts?.departureTimeUnix != null && Number.isFinite(opts.departureTimeUnix)
        ? Math.floor(opts.departureTimeUnix)
        : Math.floor(nowMs / 1000);

    const key = buildCacheKey({
      originLat,
      originLng,
      destLat,
      destLng,
      mode,
      departureTimeUnix:
        opts?.departureTimeUnix != null ? departureTimeUnix : undefined,
    });

    const memoryHit = this.memoryCache.get(key);
    if (memoryHit && nowMs - memoryHit.fetchedAtMs <= this.ttlMs) {
      console.log(`[API-CALL] 💸 GOOGLE DISTANCE MATRIX | CACHE HIT (memory) | key=${key}`);
      return { ...memoryHit.sample, fromCache: true, cacheKey: key };
    }

    const storageHit = await readPersistedCache(key, nowMs, this.ttlMs);
    if (storageHit) {
      this.memoryCache.set(key, storageHit);
      console.log(`[API-CALL] 💸 GOOGLE DISTANCE MATRIX | CACHE HIT (storage) | key=${key}`);
      return { ...storageHit.sample, fromCache: true, cacheKey: key };
    }

    const apiKey = getApiKey();
    if (!apiKey) throw new Error('DistanceMatrixMapsService: missing api key');

    console.log(
      `[API-CALL] 💸 GOOGLE DISTANCE MATRIX | NETWORK | Origins: ${originLat},${originLng} | Dest: ${destLat},${destLng} | Mode: ${mode} | Departure: ${departureTimeUnix} | key=${key}`,
    );

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${encodeURIComponent(`${originLat},${originLng}`)}` +
      `&destinations=${encodeURIComponent(`${destLat},${destLng}`)}` +
      `&mode=${encodeURIComponent(mode)}` +
      `&departure_time=${encodeURIComponent(String(departureTimeUnix))}` +
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
      const distanceM = Number((el?.distance as { value?: number } | undefined)?.value);
      const trafficDurationSec = Number.isFinite(durationTrafficValue)
        ? Math.max(0, durationTrafficValue)
        : Number.isFinite(durationValue)
          ? Math.max(0, durationValue)
          : NaN;
      if (!Number.isFinite(trafficDurationSec)) throw new Error('DistanceMatrix: missing duration');

      const sample: TrafficSample = {
        trafficDurationSec,
        staticDurationSec: Number.isFinite(durationValue) ? Math.max(0, durationValue) : undefined,
        distanceM: Number.isFinite(distanceM) && distanceM > 0 ? distanceM : undefined,
        fromCache: false,
        cacheKey: key,
        latencyMs,
      };
      const entry: CacheEntry = { sample, fetchedAtMs: nowMs };
      this.memoryCache.set(key, entry);
      void writePersistedCache(key, entry);
      if (VERBOSE_DEBUG) {
        console.log('[SENTINEL_V4][distance_matrix]', { key, trafficDurationSec, latencyMs });
      }
      return sample;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Exposé pour tests — clé grid-based 3 décimales. */
export function buildDistanceMatrixCacheKeyForTest(input: Parameters<typeof buildCacheKey>[0]): string {
  return buildCacheKey(input);
}
