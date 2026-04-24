import type { OneTapUniversalResult } from '../../../src/services/oneTapUniversalCapture';

export type TravelRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type TravelPrediction = {
  destinationLabel: string;
  arrivalAtMs: number;
  baseDurationMin: number;
  trafficMultiplier: number;
  etaMin: number;
  criticalDepartAtMs: number | null;
  risk: TravelRiskLevel;
};

function safeInt(n: unknown, fallback: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.round(x);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseArrivalAtMs(data: Record<string, unknown>): number | null {
  const ymd = typeof data.dueDateYmd === 'string' ? data.dueDateYmd.trim() : '';
  const hm = typeof data.dueTimeHm === 'string' ? data.dueTimeHm.trim() : '';
  if (ymd && hm) {
    const dt = new Date(`${ymd}T${hm}:00`);
    const ms = dt.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const iso = typeof data.dueAtIso === 'string' ? data.dueAtIso.trim() : '';
  if (iso) {
    const dt = new Date(iso);
    const ms = dt.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function extractDestinationLabel(data: Record<string, unknown>): string {
  const v =
    (typeof data.location_address === 'string' ? data.location_address : null) ??
    (typeof data.destination_name === 'string' ? data.destination_name : null) ??
    (typeof data.destinationName === 'string' ? data.destinationName : null) ??
    (typeof data.locationLabel === 'string' ? data.locationLabel : null);
  return String(v || '').trim().slice(0, 200);
}

function inferBaseDurationMin(destinationLabel: string): number {
  const s = destinationLabel.toLowerCase();
  if (!s) return 0;
  if (/\b(aéroport|airport)\b/.test(s)) return 55;
  if (/\b(gare|station)\b/.test(s)) return 35;
  if (/\b(dentiste|doctor|médecin|medecin)\b/.test(s)) return 25;
  if (/\b(tennis|sport|gym)\b/.test(s)) return 30;
  return 20;
}

function riskFromSlackMinutes(slackMin: number): TravelRiskLevel {
  if (slackMin <= 10) return 'HIGH';
  if (slackMin <= 25) return 'MEDIUM';
  return 'LOW';
}

export function buildTravelPrediction(params: {
  ctx: { nowMs: number; destinationLabel: string; arrivalAtMs: number };
  bucket: unknown;
  overrideBaseDurationMin?: number;
  overrideTrafficMultiplier?: number;
}): TravelPrediction {
  const destinationLabel = String(params.ctx.destinationLabel || '').trim().slice(0, 200);
  const arrivalAtMs = safeInt(params.ctx.arrivalAtMs, 0);
  const baseDurationMin = clamp(
    safeInt(params.overrideBaseDurationMin, inferBaseDurationMin(destinationLabel)),
    0,
    180,
  );
  const trafficMultiplier = clamp(
    typeof params.overrideTrafficMultiplier === 'number' && Number.isFinite(params.overrideTrafficMultiplier)
      ? params.overrideTrafficMultiplier
      : 1.2,
    1,
    2,
  );
  const etaMin = Math.max(0, Math.round(baseDurationMin * trafficMultiplier));
  const criticalDepartAtMs = arrivalAtMs > 0 ? arrivalAtMs - etaMin * 60 * 1000 : null;
  const slackMin =
    criticalDepartAtMs !== null ? Math.round((criticalDepartAtMs - params.ctx.nowMs) / (60 * 1000)) : 0;
  const risk = riskFromSlackMinutes(slackMin);
  return { destinationLabel, arrivalAtMs, baseDurationMin, trafficMultiplier, etaMin, criticalDepartAtMs, risk };
}

export function buildTravelMetadataFromOneTap(draft: OneTapUniversalResult): Record<string, unknown> {
  const data = (draft.data ?? {}) as Record<string, unknown>;
  const destinationLabel = extractDestinationLabel(data);
  const arrivalAtMs = parseArrivalAtMs(data);
  if (!destinationLabel || arrivalAtMs === null) return {};
  const adjustForTraffic = Boolean(data.adjustForTraffic);
  const p = buildTravelPrediction({
    ctx: { nowMs: Date.now(), destinationLabel, arrivalAtMs },
    bucket: null,
    overrideBaseDurationMin: undefined,
    overrideTrafficMultiplier: adjustForTraffic ? 1.3 : 1.1,
  });
  return {
    travel_v1: {
      destination: p.destinationLabel,
      arrival_at_ms: p.arrivalAtMs,
      eta_min: p.etaMin,
      critical_depart_at_ms: p.criticalDepartAtMs,
      risk: p.risk,
      adjust_for_traffic: adjustForTraffic,
      computed_at_ms: Date.now(),
      source: 'local_heuristic',
    },
  };
}
