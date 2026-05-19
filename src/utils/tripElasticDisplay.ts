/**
 * Résolution affichage Créneau Élastique depuis metadata_json.trip (PR2).
 * Indépendant de Sentinel — lecture SQLite optionnelle via champs miroir trip.*.
 */

import {
  computeElasticBufferMin,
  computeElasticDepartureWindow,
  DEFAULT_ELASTIC_D_STD_MIN,
  ELASTIC_BUFFER_FLOOR_MIN,
  elasticWindowFromStoredMs,
  type ElasticDepartureWindow,
} from './elasticSlotEngine';
import { formatDepartureWindowI18n } from './tripTimeHelpers';

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function parseTripArrivalIso(
  meta: Record<string, unknown> | null,
  trip: Record<string, unknown> | null,
  dueDate: string | null,
): string | null {
  return (
    str(trip, 'arrivalDue') ??
    str(trip, 'dueDateTime') ??
    str(meta, 'dueDateTime') ??
    (dueDate && !isDateOnlyDueValue(dueDate) ? String(dueDate).trim() : null)
  );
}

function isDateOnlyDueValue(dueDate: string): boolean {
  const due = String(dueDate ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(due) || /^\d{8}$/.test(due);
}

/** TRIP sans heure d'arrivée précise — créneau élastique non calculable. */
export function isTripAllDay(
  meta: Record<string, unknown> | null,
  trip: Record<string, unknown> | null,
  dueDate: string | null,
): boolean {
  if (meta) {
    const flag = meta.is_all_day;
    if (flag === 1 || flag === true) return true;
  }
  const arrivalIso = parseTripArrivalIso(meta, trip, dueDate);
  if (arrivalIso && Number.isFinite(Date.parse(arrivalIso))) return false;
  const due = dueDate ? String(dueDate).trim() : '';
  if (isDateOnlyDueValue(due)) return true;
  const tripYmd = str(trip, 'dueDateYmd');
  if (tripYmd && !str(trip, 'dueTimeHm') && !str(trip, 'arrivalDue')) return true;
  return false;
}

export type ElasticSlotDisplay = {
  window: ElasticDepartureWindow | null;
  windowLabel: string | null;
  approximate: boolean;
  shifted: boolean;
  dStdMin: number;
};

function resolveStoredElasticWindow(trip: Record<string, unknown>): ElasticDepartureWindow | null {
  const startMs = Number(trip.elastic_start_ms);
  const endMs = Number(trip.elastic_end_ms);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

  const dStdMin = Number(trip.standard_duration_min);
  const parsedStd = Number.isFinite(dStdMin) && dStdMin > 0 ? dStdMin : DEFAULT_ELASTIC_D_STD_MIN;
  const bufferRaw = Number(trip.elastic_buffer_min);
  const bufferMin =
    Number.isFinite(bufferRaw) && bufferRaw > 0 ? bufferRaw : computeElasticBufferMin(parsedStd) ?? ELASTIC_BUFFER_FLOOR_MIN;

  return elasticWindowFromStoredMs(startMs, endMs, parsedStd, bufferMin);
}

function resolveStandardDurationMin(trip: Record<string, unknown>): { minutes: number; approximate: boolean } {
  if (trip.elastic_approximate === true) {
    const raw = Number(trip.standard_duration_min);
    return {
      minutes: Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ELASTIC_D_STD_MIN,
      approximate: true,
    };
  }
  if (trip.elastic_approximate === false) {
    const raw = Number(trip.standard_duration_min);
    return {
      minutes: Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ELASTIC_D_STD_MIN,
      approximate: false,
    };
  }

  const raw = trip.standard_duration_min;
  const parsed = Number(raw);
  if (raw != null && Number.isFinite(parsed) && parsed > 0) {
    return { minutes: parsed, approximate: false };
  }
  return { minutes: DEFAULT_ELASTIC_D_STD_MIN, approximate: true };
}

export function resolveElasticSlotDisplay(input: {
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  dueDate: string | null;
  locale: string;
}): ElasticSlotDisplay {
  const { meta, trip, dueDate, locale } = input;
  const empty: ElasticSlotDisplay = {
    window: null,
    windowLabel: null,
    approximate: true,
    shifted: false,
    dStdMin: DEFAULT_ELASTIC_D_STD_MIN,
  };
  if (!trip) return empty;

  if (isTripAllDay(meta, trip, dueDate)) {
    return { ...empty, approximate: false, shifted: false };
  }

  const shifted = trip.elastic_shifted === true;
  const stored = resolveStoredElasticWindow(trip);
  const { minutes: dStdMin, approximate } = resolveStandardDurationMin(trip);

  const arrivalIso = parseTripArrivalIso(meta, trip, dueDate);
  const computed = arrivalIso ? computeElasticDepartureWindow(arrivalIso, dStdMin) : null;
  const window = stored ?? computed;

  return {
    window,
    windowLabel: formatDepartureWindowI18n(window, locale),
    approximate,
    shifted,
    dStdMin,
  };
}
