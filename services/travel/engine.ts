import type { DestinationKind, TravelContext, TravelMode, TravelPrediction, TravelRisk, TravelRiskCode, TravelSnapshot } from './types';
import type { TravelStatsBucket } from './cache';
import { bucketCv, bucketStdDevMin, computeStatsKey } from './cache';

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normText(s: string): string {
  return s
    .replace(/\u00A0/g, ' ')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function inferTravelMode(transcript: string): TravelMode {
  const t = normText(transcript);
  if (/\b(à pied|a pied|marche|marcher|walking|walk)\b/.test(t)) return 'WALK';
  if (/\b(vélo|velo|bike|bicyclette)\b/.test(t)) return 'BIKE';
  if (/\b(métro|metro|rer|train|bus|tram|transit)\b/.test(t)) return 'TRANSIT';
  if (/\b(voiture|car|uber|taxi|conduire|drive)\b/.test(t)) return 'CAR';
  return 'MIXED';
}

export function inferDestinationKind(input: { transcript: string; destinationLabel?: string }): DestinationKind {
  const t = normText([input.destinationLabel ?? '', input.transcript].filter(Boolean).join(' '));
  if (/\b(maison|home)\b/.test(t)) return 'HOME';
  if (/\b(travail|boulot|bureau|work)\b/.test(t)) return 'WORK';
  if (/\b(gare|station|rer|sncf)\b/.test(t)) return 'STATION';
  if (/\b(aéroport|aeroport|airport)\b/.test(t)) return 'AIRPORT';
  if (/\b(dentiste|médecin|medecin|kiné|kine|hôpital|hopital|pharmacie|rdv)\b/.test(t)) return 'HEALTH';
  if (/\b(gym|sport|tennis|piscine|yoga)\b/.test(t)) return 'SPORT';
  if (/\b(supermarché|supermarche|courses|acheter|carrefour|lidl|leclerc|intermarché|intermarche)\b/.test(t))
    return 'SHOPPING';
  if (/\b(école|ecole|crèche|creche|université|universite)\b/.test(t)) return 'SCHOOL';
  return 'OTHER';
}

function isRushHour(d: Date): boolean {
  const wd = d.getDay();
  const h = d.getHours() + d.getMinutes() / 60;
  const weekday = wd >= 1 && wd <= 5;
  if (!weekday) return false;
  const morning = h >= 7 && h < 10;
  const evening = h >= 16.5 && h < 19.5;
  return morning || evening;
}

function rushPenaltyMin(nowMs: number, mode: TravelMode): number {
  const d = new Date(nowMs);
  if (!isRushHour(d)) return 0;
  if (mode === 'CAR') return 10;
  if (mode === 'TRANSIT') return 6;
  if (mode === 'MIXED') return 7;
  return 2;
}

function destinationPenaltyMin(kind: DestinationKind): number {
  if (kind === 'AIRPORT') return 18;
  if (kind === 'STATION') return 10;
  if (kind === 'HEALTH') return 8;
  if (kind === 'SCHOOL') return 8;
  if (kind === 'WORK') return 6;
  if (kind === 'SHOPPING') return 4;
  return 3;
}

function baseSafetyMin(mode: TravelMode): number {
  if (mode === 'WALK') return 3;
  if (mode === 'BIKE') return 4;
  if (mode === 'TRANSIT') return 6;
  if (mode === 'CAR') return 7;
  return 6;
}

function uncertaintyMinFromBucket(bucket: TravelStatsBucket | null): number {
  if (!bucket || bucket.n < 2) return 7;
  const std = bucketStdDevMin(bucket);
  const cv = bucketCv(bucket);
  const base = std;
  const extra = cv >= 0.35 ? 6 : cv >= 0.25 ? 4 : cv >= 0.18 ? 2 : 0;
  const nPenalty = bucket.n < 6 ? 2 : 0;
  return clamp(base + extra + nPenalty, 1, 22);
}

function predictedDoorToDoorMin(params: {
  baseDurationMin: number;
  trafficMultiplier: number;
  bufferRecommendedMin: number;
}): number {
  const base = Math.max(0, params.baseDurationMin);
  const mult = clamp(params.trafficMultiplier, 0.9, 2.5);
  const buf = Math.max(0, params.bufferRecommendedMin);
  return Math.max(1, Math.round(base * mult + buf));
}

function computeCriticalDepartAtMs(arrivalAtMs: number, doorToDoorMin: number): number {
  return arrivalAtMs - Math.max(0, doorToDoorMin) * 60_000;
}

function computeElasticity(params: {
  bufferSafetyMin: number | null;
  bufferRecommendedMin: number;
  uncertaintyMin: number;
  rushMin: number;
}): number {
  const rec = Math.max(1, params.bufferRecommendedMin);
  const u = Math.max(0, params.uncertaintyMin);
  const rush = Math.max(0, params.rushMin);
  const baseRisk = clamp01((u + rush) / (rec + 8));
  if (params.bufferSafetyMin === null) return clamp01(0.35 + 0.55 * baseRisk);
  const s = params.bufferSafetyMin;
  const x = 1 - clamp01(s / (rec * 2));
  return clamp01(0.25 * baseRisk + 0.85 * x);
}

function riskFromElasticity(e: number, bufferSafetyMin: number | null): TravelRisk {
  if (bufferSafetyMin !== null && bufferSafetyMin <= 0) return 'GO';
  if (e >= 0.72) return 'GO';
  if (e >= 0.38) return 'TENSE';
  return 'CALM';
}

function riskCode(r: TravelRisk): TravelRiskCode {
  if (r === 'GO') return 2;
  if (r === 'TENSE') return 1;
  return 0;
}

export function buildTravelPrediction(params: {
  ctx: TravelContext;
  bucket: TravelStatsBucket | null;
  overrideBaseDurationMin?: number;
  overrideTrafficMultiplier?: number;
}): TravelPrediction {
  const dk = inferDestinationKind({ transcript: params.ctx.transcript, destinationLabel: params.ctx.destinationLabel });
  const mode = inferTravelMode(params.ctx.transcript);
  const key = computeStatsKey({ destinationKind: dk, mode, nowMs: params.ctx.nowMs });
  const baseFromBucket = params.bucket ? params.bucket.mean : null;
  const baseDurationMin = clamp(
    params.overrideBaseDurationMin ?? baseFromBucket ?? 18,
    3,
    180,
  );
  const rushMin = rushPenaltyMin(params.ctx.nowMs, mode);
  const uncMin = uncertaintyMinFromBucket(params.bucket);
  const bufferRecommendedMin = Math.round(
    baseSafetyMin(mode) + destinationPenaltyMin(dk) + rushMin + uncMin,
  );
  const trafficMultiplier = clamp(params.overrideTrafficMultiplier ?? (rushMin > 0 ? 1.18 : 1.08), 0.9, 2.5);
  const estimatedDoorToDoorMin = predictedDoorToDoorMin({
    baseDurationMin,
    trafficMultiplier,
    bufferRecommendedMin,
  });

  const criticalDepartAtMs =
    typeof params.ctx.arrivalAtMs === 'number' && Number.isFinite(params.ctx.arrivalAtMs)
      ? computeCriticalDepartAtMs(params.ctx.arrivalAtMs, estimatedDoorToDoorMin)
      : null;

  const bufferSafetyMin =
    criticalDepartAtMs !== null ? Math.round((criticalDepartAtMs - params.ctx.nowMs) / 60_000) : null;

  const elasticity = computeElasticity({
    bufferSafetyMin,
    bufferRecommendedMin,
    uncertaintyMin: uncMin,
    rushMin,
  });

  const risk = riskFromElasticity(elasticity, bufferSafetyMin);
  const nextJumpMs = computeRiskDrivenNextJumpMs({
    nowMs: params.ctx.nowMs,
    criticalDepartAtMs,
    bufferSafetyMin,
    elasticity,
  });

  return {
    destinationKind: dk,
    mode,
    baseDurationMin,
    trafficMultiplier,
    uncertaintyMin: uncMin,
    bufferRecommendedMin,
    estimatedDoorToDoorMin,
    criticalDepartAtMs,
    bufferSafetyMin,
    risk,
    nextJumpMs,
    elasticity,
  };
}

export function toTravelSnapshot(p: TravelPrediction, nowMs: number): TravelSnapshot {
  return {
    t: nowMs,
    dk: p.destinationKind,
    m: p.mode,
    e: Math.round(clamp01(p.elasticity) * 1000) / 1000,
    r: riskCode(p.risk),
    eta: Math.round(p.estimatedDoorToDoorMin),
    buf: p.bufferSafetyMin === null ? 999 : Math.round(p.bufferSafetyMin),
    dep: p.criticalDepartAtMs,
    nxt: Math.max(250, Math.round(p.nextJumpMs)),
  };
}

export function computeRiskDrivenNextJumpMs(params: {
  nowMs: number;
  criticalDepartAtMs: number | null;
  bufferSafetyMin: number | null;
  elasticity: number;
}): number {
  const e = clamp01(params.elasticity);
  const minMs = 45_000;
  const maxMs = 30 * 60_000;

  const timeToDepartMin =
    params.criticalDepartAtMs !== null ? (params.criticalDepartAtMs - params.nowMs) / 60_000 : null;

  const nearDepart = timeToDepartMin !== null && timeToDepartMin <= 18;
  const critical = (params.bufferSafetyMin ?? 999) <= 6;

  const base =
    critical ? 90_000 : nearDepart ? 2.5 * 60_000 : 8 * 60_000;

  const scaled = base * (1 - 0.85 * e);
  const gated = critical ? Math.min(3 * 60_000, scaled) : nearDepart ? Math.min(10 * 60_000, scaled) : scaled;

  const seed = ((params.nowMs | 0) ^ Math.floor(e * 1_000_000)) >>> 0;
  const jitter = 0.88 + ((seed % 1000) / 1000) * 0.26;
  return clamp(Math.round(gated * jitter), minMs, maxMs);
}
