import type { TrankilV2TimelineItemRow } from '../../api';

export type RowTemporalMeta = {
  hasStrictTime: boolean;
  dueTimeHm: string | null;
  timeMarker: 'ALL_DAY' | 'EXACT_TIME' | null;
};

function parseMetadataJson(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeHm(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function extractHmFromIso(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

/** Heuristique MVP : horaire strict si timeMarker, dueTimeHm, trip, preferredTimeHm, recurrence_rule.time_target ou ISO datetime. */
export function parseRowTemporalMeta(row: TrankilV2TimelineItemRow): RowTemporalMeta {
  const meta = parseMetadataJson(row.metadata_json);
  const timeMarkerRaw = String(meta?.timeMarker ?? '').trim().toUpperCase();
  const timeMarker =
    timeMarkerRaw === 'EXACT_TIME' ? 'EXACT_TIME' : timeMarkerRaw === 'ALL_DAY' ? 'ALL_DAY' : null;

  const trip = meta?.trip && typeof meta.trip === 'object' ? (meta.trip as Record<string, unknown>) : null;
  const recRule =
    meta?.recurrence_rule && typeof meta.recurrence_rule === 'object' && !Array.isArray(meta.recurrence_rule)
      ? (meta.recurrence_rule as Record<string, unknown>)
      : null;
  const dueTimeHm =
    normalizeHm(meta?.dueTimeHm) ??
    normalizeHm(trip?.dueTimeHm) ??
    normalizeHm(recRule?.time_target) ??
    normalizeHm(meta?.preferredTimeHm) ??
    extractHmFromIso(meta?.dueDateTime) ??
    extractHmFromIso(trip?.dueDateTime) ??
    extractHmFromIso(row.due_date);

  const hasStrictTime = timeMarker === 'EXACT_TIME' || Boolean(dueTimeHm);
  return { hasStrictTime, dueTimeHm, timeMarker };
}
