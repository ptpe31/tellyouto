/**
 * Créneau Élastique — Contrat de Départ (moteur mathématique pur).
 * Aucune dépendance SQLite, Sentinel, réseau ou UI.
 */

/** Marge incompressible (relax) = Start_Relax = Deadline − 15 min. */
export const ELASTIC_BUFFER_BASE_MIN = 15;
/** Vitesse de référence pour T_ideal fallback (distance / 50 km/h). */
export const ELASTIC_REFERENCE_SPEED_KMH = 50;
/** @deprecated Alias affichage — utiliser ELASTIC_BUFFER_BASE_MIN. */
export const ELASTIC_BUFFER_FLOOR_MIN = ELASTIC_BUFFER_BASE_MIN;

export const ELASTIC_DEAD_ZONE_MIN = 5;
export const ELASTIC_PROBE3_SKIP_DEPARTURE_MIN = 10;
export const ELASTIC_PROBE2_LEAD_MIN = 45;
export const ELASTIC_PROBE3_LEAD_MIN = 15;
export const ELASTIC_SHORT_TRIP_MAX_MIN = 15;
export const DEFAULT_ELASTIC_D_STD_MIN = 30;
/** Marge minimale entre now et departure_time PROBE1 (évite requête DM dans le passé). */
export const PROBE1_DEPARTURE_MIN_LEAD_MS = 120_000;

type ElasticTransportMode = 'driving' | 'walking' | 'bicycling';

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

type ElasticProbeSchedule = {
  probe2AtMs: number | null;
  probe3AtMs: number;
};

function normalizeElasticTransportMode(raw: string | null | undefined): ElasticTransportMode {
  const m = String(raw ?? '').trim().toLowerCase();
  if (m === 'walking' || m === 'walk') return 'walking';
  if (m === 'bike' || m === 'bicycling' || m === 'bicycle') return 'bicycling';
  return 'driving';
}

export function skipsElasticProbe2(transportMode: string | null | undefined): boolean {
  const m = normalizeElasticTransportMode(transportMode);
  return m === 'walking' || m === 'bicycling';
}

export function computeDegradationRatio(tPredMin: number, tIdealMin: number): number {
  const pred = Number(tPredMin);
  const ideal = Math.max(1, Number(tIdealMin));
  if (!Number.isFinite(pred) || pred <= 0) return 1;
  return pred / ideal;
}

/** T_ideal (min) à partir de la distance : distance_km / 50 km/h. */
export function computeIdealDurationMinFromDistanceM(distanceM: number): number {
  const meters = Number(distanceM);
  if (!Number.isFinite(meters) || meters <= 0) return 1;
  const hours = meters / 1000 / ELASTIC_REFERENCE_SPEED_KMH;
  return Math.max(1, Math.round(hours * 60));
}

/**
 * T_ideal stable : durée statique API (sans trafic), sinon distance / 50 km/h.
 */
export function resolveIdealDurationMinFromSample(input: {
  staticDurationSec: number;
  distanceM?: number | null;
}): number {
  const staticSec = Math.max(0, Number(input.staticDurationSec) || 0);
  if (staticSec > 0) return Math.max(1, Math.round(staticSec / 60));
  const distanceM = input.distanceM;
  if (distanceM != null && Number.isFinite(distanceM) && distanceM > 0) {
    return computeIdealDurationMinFromDistanceM(distanceM);
  }
  return 1;
}

/** Largeur fixe du créneau relax (Start = Deadline − 15 min). */
export function contractRelaxBufferMin(): number {
  return ELASTIC_BUFFER_BASE_MIN;
}

export function computeProbe1DepartureTimeUnix(input: {
  arrivalMs: number;
  tIdealMin: number;
  bufferBaseMin: number;
  nowMs: number;
}): number {
  const calculatedDepartMs =
    input.arrivalMs - (input.tIdealMin + input.bufferBaseMin) * 60_000;
  const safeDepartMs = Math.max(
    Number(input.nowMs) + PROBE1_DEPARTURE_MIN_LEAD_MS,
    calculatedDepartMs,
  );
  return Math.floor(safeDepartMs / 1000);
}

/** Horodatage de départ estimé avant garde temporelle (pour logs / diagnostic). */
export function computeProbe1CalculatedDepartMs(input: {
  arrivalMs: number;
  tIdealMin: number;
  bufferBaseMin?: number;
}): number {
  const buffer = input.bufferBaseMin ?? ELASTIC_BUFFER_BASE_MIN;
  return input.arrivalMs - (input.tIdealMin + buffer) * 60_000;
}

/**
 * Contrat de Départ (marge adaptative) :
 *   D = T_pred / T_ideal
 *   Deadline (endMs) = arrivée − (T_used × D) × 60_000
 *   Start_Relax (startMs) = Deadline − 15 min
 */
export function computeProposedWindowAnchor(input: {
  arrivalMs: number;
  tUsedMin: number;
  ratioD: number;
}): WindowAnchor | null {
  const arrivalMs = Number(input.arrivalMs);
  const tUsed = Number(input.tUsedMin);
  const ratioD = Number(input.ratioD);
  if (!Number.isFinite(arrivalMs) || !Number.isFinite(tUsed) || tUsed <= 0) return null;
  if (!Number.isFinite(ratioD) || ratioD <= 0) return null;

  const contractDriveMin = tUsed * ratioD;
  const endMs = arrivalMs - contractDriveMin * 60_000;
  const startMs = endMs - ELASTIC_BUFFER_BASE_MIN * 60_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null;

  return {
    startMs,
    endMs,
    durationMin: Math.max(1, Math.round(tUsed)),
  };
}

/** Ratio D pour shifts PROBE2/3 : ne jamais assouplir sous le D calibré PROBE1. */
export function resolveContractRatioD(input: {
  storedRatioD: number | null;
  tLiveMin: number;
  tIdealMin: number;
}): number {
  const stored = input.storedRatioD;
  const liveD = computeDegradationRatio(input.tLiveMin, input.tIdealMin);
  if (stored != null && Number.isFinite(stored) && stored > 0) {
    return Math.max(stored, liveD);
  }
  return liveD;
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
