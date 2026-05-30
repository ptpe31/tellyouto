import type { TrankilV2TimelineItemRow } from '../api';
import { isTripAllDay } from './tripElasticDisplay';
import { getTripReadinessBlockers, isTripReadyForScan } from './tripTripReadiness';

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function resolveTripOriginLabel(
  trip: Record<string, unknown> | null,
  t: (key: string) => string,
): string {
  const origin = str(trip, 'origin_address');
  return origin ?? t('intentionDetail.currentPosition');
}

export function resolveTripArrivalLabel(
  _row: TrankilV2TimelineItemRow,
  trip: Record<string, unknown> | null,
  meta: Record<string, unknown> | null,
): string | null {
  const fromTrip = str(trip, 'location_address');
  if (fromTrip) return fromTrip;
  const fromMeta = str(meta, 'location_address');
  return fromMeta;
}

export function hasTripArrivalAddress(
  row: TrankilV2TimelineItemRow,
  trip: Record<string, unknown> | null,
  meta: Record<string, unknown> | null,
): boolean {
  return getTripReadinessBlockers({ meta, trip, dueDate: row.due_date ?? null }).indexOf('destination') < 0;
}

export function isTripReadyForIdeaBankSurveillance(input: {
  row: TrankilV2TimelineItemRow;
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  isProUser: boolean;
}): boolean {
  if (!input.isProUser) return false;
  if (isTripAllDay(input.meta, input.trip, input.row.due_date ?? null)) return false;
  return isTripReadyForScan({
    meta: input.meta,
    trip: input.trip,
    dueDate: input.row.due_date ?? null,
  });
}
