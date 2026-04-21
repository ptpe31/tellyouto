import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DestinationKind, TravelMode } from './types';

export type TravelStatsKey = {
  dk: DestinationKind;
  m: TravelMode;
  wd: number;
  hb: number;
};

export type TravelStatsBucket = TravelStatsKey & {
  n: number;
  mean: number;
  m2: number;
  lastMs: number;
};

export type TravelStatsSnapshot = {
  v: 1;
  buckets: TravelStatsBucket[];
};

const STORAGE_KEY = '@tellyouto/phoenix_travel_stats_v1';
const MAX_BUCKETS = 220;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function keyToString(k: TravelStatsKey): string {
  return `${k.dk}|${k.m}|${k.wd}|${k.hb}`;
}

function hourBucket(h: number): number {
  return clamp(Math.floor(h / 2), 0, 11);
}

export function computeStatsKey(input: {
  destinationKind: DestinationKind;
  mode: TravelMode;
  nowMs: number;
}): TravelStatsKey {
  const d = new Date(input.nowMs);
  return {
    dk: input.destinationKind,
    m: input.mode,
    wd: d.getDay(),
    hb: hourBucket(d.getHours()),
  };
}

function variance(bucket: TravelStatsBucket): number {
  if (bucket.n <= 1) return 0;
  return bucket.m2 / (bucket.n - 1);
}

export function bucketStdDevMin(bucket: TravelStatsBucket): number {
  const v = variance(bucket);
  return Math.sqrt(Math.max(0, v));
}

export function bucketCv(bucket: TravelStatsBucket): number {
  const mu = bucket.mean;
  if (mu <= 0) return 0;
  return bucketStdDevMin(bucket) / mu;
}

export class TravelStatsCache {
  private hydrated = false;
  private buckets = new Map<string, TravelStatsBucket>();

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return;
      const s = parsed as Partial<TravelStatsSnapshot>;
      const arr = Array.isArray(s.buckets) ? s.buckets : [];
      for (const b of arr) {
        if (!b || typeof b !== 'object') continue;
        const x = b as Partial<TravelStatsBucket>;
        if (typeof x.dk !== 'string' || typeof x.m !== 'string') continue;
        if (typeof x.wd !== 'number' || typeof x.hb !== 'number') continue;
        if (typeof x.n !== 'number' || typeof x.mean !== 'number' || typeof x.m2 !== 'number') continue;
        if (typeof x.lastMs !== 'number') continue;
        const key = keyToString({ dk: x.dk as DestinationKind, m: x.m as TravelMode, wd: x.wd, hb: x.hb });
        this.buckets.set(key, {
          dk: x.dk as DestinationKind,
          m: x.m as TravelMode,
          wd: x.wd,
          hb: x.hb,
          n: Math.max(0, Math.floor(x.n)),
          mean: Math.max(0, x.mean),
          m2: Math.max(0, x.m2),
          lastMs: Math.max(0, x.lastMs),
        });
      }
      this.trimIfNeeded();
    } catch {
      return;
    }
  }

  private trimIfNeeded(): void {
    if (this.buckets.size <= MAX_BUCKETS) return;
    const sorted = [...this.buckets.values()].sort((a, b) => a.lastMs - b.lastMs);
    const toDrop = Math.max(0, sorted.length - MAX_BUCKETS);
    for (let i = 0; i < toDrop; i += 1) {
      const b = sorted[i];
      const k = keyToString(b);
      this.buckets.delete(k);
    }
  }

  getBucket(key: TravelStatsKey): TravelStatsBucket | null {
    const k = keyToString(key);
    return this.buckets.get(k) ?? null;
  }

  recordSample(params: { key: TravelStatsKey; durationMin: number; nowMs: number }): void {
    const x = Math.max(0, Number(params.durationMin) || 0);
    const k = keyToString(params.key);
    const prev = this.buckets.get(k);
    if (!prev) {
      this.buckets.set(k, { ...params.key, n: 1, mean: x, m2: 0, lastMs: params.nowMs });
      this.trimIfNeeded();
      return;
    }
    const n1 = prev.n;
    const n2 = n1 + 1;
    const delta = x - prev.mean;
    const mean = prev.mean + delta / n2;
    const delta2 = x - mean;
    const m2 = prev.m2 + delta * delta2;
    this.buckets.set(k, { ...prev, n: n2, mean: Math.max(0, mean), m2: Math.max(0, m2), lastMs: params.nowMs });
  }

  shouldSkipMaps(key: TravelStatsKey, nowMs: number): boolean {
    const b = this.getBucket(key);
    if (!b) return false;
    if (b.n < 6) return false;
    const ageMin = (nowMs - b.lastMs) / 60_000;
    if (ageMin > 10 * 60) return false;
    const cv = bucketCv(b);
    return cv > 0 && cv <= 0.18;
  }

  async flush(): Promise<void> {
    await this.hydrate();
    const payload: TravelStatsSnapshot = { v: 1, buckets: [...this.buckets.values()] };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

