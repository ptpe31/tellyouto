/**
 * Créneau Élastique — moteur mathématique pur (PR1).
 * Aucune dépendance SQLite, Sentinel, réseau ou UI.
 */

export const ELASTIC_BUFFER_FLOOR_MIN = 10;
export const ELASTIC_BUFFER_RATIO = 0.3;
export const ELASTIC_PROBE2_LEAD_MIN = 45;
export const ELASTIC_PROBE3_LEAD_MIN = 15;
export const ELASTIC_SHORT_TRIP_MAX_MIN = 15;
export const DEFAULT_ELASTIC_D_STD_MIN = 30;

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

function parseArrivalMs(input: Date | string): number | null {
  if (input instanceof Date) {
    return Number.isFinite(input.getTime()) ? input.getTime() : null;
  }
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Buffer = max(10 min, 30 % de D_std). */
export function computeElasticBufferMin(dStdMin: number): number | null {
  const dStd = Number(dStdMin);
  if (!Number.isFinite(dStd) || dStd <= 0) return null;
  return Math.max(ELASTIC_BUFFER_FLOOR_MIN, Math.round(dStd * ELASTIC_BUFFER_RATIO * 10) / 10);
}

/**
 * Fenêtre initiale : [ arrivée − (D_std + Buffer) … arrivée − D_std ].
 * Ex. arrivée 19h30, D_std 30, Buffer 10 → [ 18h50 – 19h00 ].
 */
export function computeElasticDepartureWindow(
  arrivalTime: Date | string,
  dStdMin: number,
): ElasticDepartureWindow | null {
  const arrivalMs = parseArrivalMs(arrivalTime);
  const dStd = Number(dStdMin);
  const bufferMin = computeElasticBufferMin(dStd);
  if (arrivalMs == null || bufferMin == null) return null;

  const startMs = arrivalMs - (dStd + bufferMin) * 60_000;
  const endMs = arrivalMs - dStd * 60_000;
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
 * Cas B (PROBE2) : décalage du créneau avec D_live et le buffer initial.
 * start = arrivée − (D_live + buffer), end = arrivée − D_live.
 */
export function computeShiftedElasticWindow(
  arrivalTime: Date | string,
  dLiveMin: number,
  bufferMin: number,
): ElasticDepartureWindow | null {
  const arrivalMs = parseArrivalMs(arrivalTime);
  const dLive = Number(dLiveMin);
  const buffer = Number(bufferMin);
  if (arrivalMs == null || !Number.isFinite(dLive) || dLive <= 0 || !Number.isFinite(buffer) || buffer < 0) {
    return null;
  }

  const startMs = arrivalMs - (dLive + buffer) * 60_000;
  const endMs = arrivalMs - dLive * 60_000;
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
}): ElasticProbeSchedule | null {
  const startMs = Number(input.windowStartMs);
  const dStd = Number(input.dStdMin);
  const nowMs = Number(input.nowMs ?? Date.now());
  if (!Number.isFinite(startMs) || !Number.isFinite(dStd) || dStd <= 0) return null;

  const probe3AtMs = startMs - ELASTIC_PROBE3_LEAD_MIN * 60_000;
  const probe2RawMs = startMs - ELASTIC_PROBE2_LEAD_MIN * 60_000;
  const probe2AtMs =
    dStd < ELASTIC_SHORT_TRIP_MAX_MIN
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
