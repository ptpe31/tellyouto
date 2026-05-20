/**
 * Créneau Élastique — Contrat de Départ (moteur mathématique pur).
 * Aucune dépendance SQLite, Sentinel, réseau ou UI.
 */

/** Marge incompressible (préparation + stationnement). */
export const ELASTIC_BUFFER_BASE_MIN = 15;
/** Part d'aléa trafic : 10 % du temps de trajet API. */
export const ELASTIC_BUFFER_VARIANCE_RATIO = 0.1;
export const ELASTIC_BUFFER_CLAMP_MIN = 15;
export const ELASTIC_BUFFER_CLAMP_MAX_MIN = 25;
export const ELASTIC_BUFFER_PREDICTIVE_CAP_MIN = 30;
/** @deprecated Alias affichage — utiliser ELASTIC_BUFFER_BASE_MIN. */
export const ELASTIC_BUFFER_FLOOR_MIN = ELASTIC_BUFFER_BASE_MIN;

export const ELASTIC_DEAD_ZONE_MIN = 5;
export const ELASTIC_PROBE3_SKIP_DEPARTURE_MIN = 10;
export const ELASTIC_PROBE2_LEAD_MIN = 45;
export const ELASTIC_PROBE3_LEAD_MIN = 15;
export const ELASTIC_SHORT_TRIP_MAX_MIN = 15;
export const DEFAULT_ELASTIC_D_STD_MIN = 30;

export type ElasticTransportMode = 'driving' | 'walking' | 'bicycling';

export type WindowAnchor = {
  startMs: number;
  endMs: number;
  durationMin: number;
};

export type ElasticDepartureWindow = {
  startDate: Date;
  endDate: Date;
  bufferMin: number;
  dStdMin: number;
};

export type ElasticProbeSchedule = {
  probe2AtMs: number | null;
  probe3AtMs: number;
};

export function normalizeElasticTransportMode(raw: string | null | undefined): ElasticTransportMode {
  const m = String(raw ?? '').trim().toLowerCase();
  if (m === 'walking' || m === 'walk') return 'walking';
  if (m === 'bike' || m === 'bicycling' || m === 'bicycle') return 'bicycling';
  return 'driving';
}

export function skipsElasticProbe2(transportMode: string | null | undefined): boolean {
  const m = normalizeElasticTransportMode(transportMode);
  return m === 'walking' || m === 'bicycling';
}

/** Smart Buffer de base : 15 min + 10 % trajet, borné [15, 25]. */
export function computeBaseSmartBufferMin(dIdealMin: number): number | null {
  const duration = Number(dIdealMin);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const varianceBuffer = Math.round(duration * ELASTIC_BUFFER_VARIANCE_RATIO);
  let bufferMin = ELASTIC_BUFFER_BASE_MIN + Math.max(0, varianceBuffer);
  bufferMin = Math.max(ELASTIC_BUFFER_CLAMP_MIN, Math.min(ELASTIC_BUFFER_CLAMP_MAX_MIN, bufferMin));
  return bufferMin;
}

export function computeDegradationRatio(tPredMin: number, tIdealMin: number): number {
  return tPredMin / Math.max(tIdealMin, 1);
}

export function computePrudenceAlpha(ratio: number): number {
  if (ratio < 1.05) return 1.0;
  if (ratio < 1.25) return 1.1;
  if (ratio < 1.5) return 1.2;
  return 1.35;
}

/** Buffer du contrat : Smart Buffer × α, plafonné à 30 min. */
export function computePredictiveBufferMin(dIdealMin: number, alpha: number): number {
  const base = computeBaseSmartBufferMin(dIdealMin) ?? ELASTIC_BUFFER_BASE_MIN;
  const a = Number.isFinite(alpha) && alpha > 0 ? alpha : 1;
  return Math.min(Math.round(base * a), ELASTIC_BUFFER_PREDICTIVE_CAP_MIN);
}

export function computeProbe1DepartureTimeUnix(input: {
  arrivalMs: number;
  tIdealMin: number;
  bufferBaseMin: number;
}): number {
  const departMs =
    input.arrivalMs - (input.tIdealMin + input.bufferBaseMin) * 60_000;
  return Math.floor(departMs / 1000);
}

/**
 * Contrat de Départ :
 *   endMs   = arrivée − (tUsed × α) − marge incompressible (15 min)
 *   startMs = arrivée − (tUsed × α) − bufferMin
 */
export function computeProposedWindowAnchor(input: {
  arrivalMs: number;
  tUsedMin: number;
  alpha: number;
  bufferMin: number;
}): WindowAnchor | null {
  const arrivalMs = Number(input.arrivalMs);
  const tUsed = Number(input.tUsedMin);
  const alpha = Number(input.alpha);
  const bufferMin = Number(input.bufferMin);
  if (!Number.isFinite(arrivalMs) || !Number.isFinite(tUsed) || tUsed <= 0) return null;
  if (!Number.isFinite(alpha) || alpha <= 0 || !Number.isFinite(bufferMin) || bufferMin < 0) {
    return null;
  }

  const contractDriveMin = tUsed * alpha;
  const endMs = arrivalMs - (contractDriveMin + ELASTIC_BUFFER_BASE_MIN) * 60_000;
  const startMs = arrivalMs - (contractDriveMin + bufferMin) * 60_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null;

  return {
    startMs,
    endMs,
    durationMin: Math.max(1, Math.round(tUsed)),
  };
}

export function applyPessimisticAnchor(
  oldAnchor: WindowAnchor | null,
  proposed: WindowAnchor,
): { anchor: WindowAnchor; changed: boolean } {
  if (!oldAnchor) {
    return { anchor: proposed, changed: true };
  }
  const anchor: WindowAnchor = {
    startMs: Math.min(oldAnchor.startMs, proposed.startMs),
    endMs: Math.min(oldAnchor.endMs, proposed.endMs),
    durationMin: Math.max(oldAnchor.durationMin, proposed.durationMin),
  };
  const changed =
    anchor.startMs !== oldAnchor.startMs ||
    anchor.endMs !== oldAnchor.endMs ||
    anchor.durationMin !== oldAnchor.durationMin;
  return { anchor, changed };
}

export function isWithinTrafficDeadZone(deltaMin: number, thresholdMin = ELASTIC_DEAD_ZONE_MIN): boolean {
  return Math.abs(Number(deltaMin)) <= thresholdMin;
}

export function shouldSkipProbe3Api(input: {
  deltaMin: number;
  timeToDepartureMin: number;
  deadZoneMin?: number;
  skipDepartureThresholdMin?: number;
}): boolean {
  const deadZone = input.deadZoneMin ?? ELASTIC_DEAD_ZONE_MIN;
  const skipThreshold = input.skipDepartureThresholdMin ?? ELASTIC_PROBE3_SKIP_DEPARTURE_MIN;
  return (
    isWithinTrafficDeadZone(input.deltaMin, deadZone) &&
    input.timeToDepartureMin < skipThreshold
  );
}

export function anchorToDepartureWindow(
  anchor: WindowAnchor,
  bufferMin: number,
  tIdealMin: number,
): ElasticDepartureWindow {
  return {
    startDate: new Date(anchor.startMs),
    endDate: new Date(anchor.endMs),
    bufferMin,
    dStdMin: Math.max(1, Math.round(tIdealMin)),
  };
}

export function scheduleElasticProbes(input: {
  windowStartMs: number;
  dStdMin: number;
  nowMs?: number;
  skipProbe2?: boolean;
}): ElasticProbeSchedule | null {
  const startMs = Number(input.windowStartMs);
  const dStd = Number(input.dStdMin);
  const nowMs = Number(input.nowMs ?? Date.now());
  if (!Number.isFinite(startMs) || !Number.isFinite(dStd) || dStd <= 0) return null;

  const probe3AtMs = startMs - ELASTIC_PROBE3_LEAD_MIN * 60_000;
  const skipProbe2 = input.skipProbe2 === true || dStd < ELASTIC_SHORT_TRIP_MAX_MIN;
  const probe2RawMs = startMs - ELASTIC_PROBE2_LEAD_MIN * 60_000;
  const probe2AtMs = skipProbe2
    ? null
    : Math.max(nowMs, Math.min(probe2RawMs, probe3AtMs - 60_000));

  return {
    probe2AtMs,
    probe3AtMs: Math.max(nowMs, probe3AtMs),
  };
}

export function readElasticWindowAnchor(
  trip: Record<string, unknown> | null | undefined,
): WindowAnchor | null {
  if (!trip) return null;
  const startMs = Number(trip.elastic_anchor_start_ms ?? trip.elastic_start_ms);
  const endMs = Number(trip.elastic_anchor_end_ms ?? trip.elastic_end_ms);
  const durationMin = Number(
    trip.elastic_anchor_duration_min ??
      trip.elastic_predicted_duration_min ??
      trip.standard_duration_min,
  );
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;
  return {
    startMs,
    endMs,
    durationMin: Math.max(1, Math.round(durationMin)),
  };
}

export function elasticWindowFromStoredMs(
  startMs: number,
  endMs: number,
  dStdMin: number,
  bufferMin: number,
): ElasticDepartureWindow | null {
  const s = Number(startMs);
  const e = Number(endMs);
  const dStd = Number(dStdMin);
  const buffer = Number(bufferMin);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return null;
  if (!Number.isFinite(dStd) || dStd <= 0 || !Number.isFinite(buffer) || buffer < 0) return null;
  return {
    startDate: new Date(s),
    endDate: new Date(e),
    bufferMin: buffer,
    dStdMin: dStd,
  };
}
