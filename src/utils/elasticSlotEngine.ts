/**
 * Créneau Élastique — moteur mathématique pur (PR1).
 * Aucune dépendance SQLite, Sentinel, réseau ou UI.
 */

/** Marge incompressible (préparation + stationnement). */
export const ELASTIC_BUFFER_BASE_MIN = 15;
/** Part d'aléa trafic : 10 % du temps de trajet API. */
export const ELASTIC_BUFFER_VARIANCE_RATIO = 0.1;
/** Plancher / plafond du buffer total (minutes). */
export const ELASTIC_BUFFER_CLAMP_MIN = 15;
export const ELASTIC_BUFFER_CLAMP_MAX_MIN = 25;
/** @deprecated Utiliser ELASTIC_BUFFER_BASE_MIN — conservé pour compat affichage. */
export const ELASTIC_BUFFER_FLOOR_MIN = ELASTIC_BUFFER_BASE_MIN;
export const ELASTIC_PROBE2_LEAD_MIN = 45;
export const ELASTIC_PROBE3_LEAD_MIN = 15;
export const ELASTIC_SHORT_TRIP_MAX_MIN = 15;
export const DEFAULT_ELASTIC_D_STD_MIN = 30;

export type ElasticTransportMode = 'driving' | 'walking' | 'bicycling';

export type ElasticDepartureWindow = {
  /** Borne basse — heure de départ recommandée (partir tôt). */
  startDate: Date;
  /** Borne haute — heure limite de départ. */
  endDate: Date;
  bufferMin: number;
  dStdMin: number;
};

export type ElasticProbeSchedule = {
  probe2AtMs: number | null;
  probe3AtMs: number;
};

function parseArrivalMs(input: Date | string | number): number | null {
  if (input instanceof Date) {
    return Number.isFinite(input.getTime()) ? input.getTime() : null;
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

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

/** Smart Buffer : 15 min base + 10 % trajet, borné [15, 25] min. */
export function computeElasticBufferMin(
  durationMin: number,
  _mode: ElasticTransportMode = 'driving',
): number | null {
  const duration = Number(durationMin);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const baseBuffer = ELASTIC_BUFFER_BASE_MIN;
  const varianceBuffer = Math.round(duration * ELASTIC_BUFFER_VARIANCE_RATIO);
  let bufferMin = baseBuffer + Math.max(0, varianceBuffer);
  bufferMin = Math.max(ELASTIC_BUFFER_CLAMP_MIN, Math.min(ELASTIC_BUFFER_CLAMP_MAX_MIN, bufferMin));
  return bufferMin;
}

/**
 * Fenêtre de départ à rebours de l'arrivée cible :
 * End (limite départ) = arrivée − durationMin − marge incompressible (15 min) ;
 * Start (relax) = arrivée − durationMin − bufferMin (Smart Buffer total).
 * Ex. arrivée 18h30, trajet 16 min, buffer 17 → [ 17h57 – 17h59 ].
 */
export function computeElasticDepartureWindow(
  arrivalTime: Date | string | number,
  dStdMin: number,
  mode: ElasticTransportMode = 'driving',
): ElasticDepartureWindow | null {
  const arrivalMs = parseArrivalMs(arrivalTime);
  const dStd = Number(dStdMin);
  const bufferMin = computeElasticBufferMin(dStd, mode);
  if (arrivalMs == null || bufferMin == null) return null;

  const endMs = arrivalMs - (dStd + ELASTIC_BUFFER_BASE_MIN) * 60_000;
  const startMs = arrivalMs - (dStd + bufferMin) * 60_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null;

  return {
    startDate: new Date(startMs),
    endDate: new Date(endMs),
    bufferMin,
    dStdMin: dStd,
  };
}

/** Cas A : le trafic live reste absorbé par D_std + Buffer. */
export function isTrafficAbsorbedByElasticBuffer(
  dLiveMin: number,
  dStdMin: number,
  bufferMin: number,
): boolean {
  const live = Number(dLiveMin);
  const std = Number(dStdMin);
  const buffer = Number(bufferMin);
  if (!Number.isFinite(live) || !Number.isFinite(std) || !Number.isFinite(buffer)) return false;
  return live <= std + buffer;
}

/**
 * Cas B (PROBE2/3) : créneau recalculé avec D_live API et le buffer Smart.
 * End = arrivée − D_live − marge incompressible ; Start = arrivée − D_live − bufferMin.
 */
export function computeShiftedElasticWindow(
  arrivalTime: Date | string | number,
  dLiveMin: number,
  bufferMin: number,
): ElasticDepartureWindow | null {
  const arrivalMs = parseArrivalMs(arrivalTime);
  const dLive = Number(dLiveMin);
  const buffer = Number(bufferMin);
  if (arrivalMs == null || !Number.isFinite(dLive) || dLive <= 0 || !Number.isFinite(buffer) || buffer < 0) {
    return null;
  }

  const endMs = arrivalMs - (dLive + ELASTIC_BUFFER_BASE_MIN) * 60_000;
  const startMs = arrivalMs - (dLive + buffer) * 60_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null;

  return {
    startDate: new Date(startMs),
    endDate: new Date(endMs),
    bufferMin: buffer,
    dStdMin: dLive,
  };
}

/** Timestamps des sondes 2 et 3 par rapport à la borne basse courante. */
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
