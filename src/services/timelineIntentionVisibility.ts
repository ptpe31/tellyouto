import type { TrankilV2TimelineItemRow } from '../api';

export const NOTE_FALLBACK_LABEL = 'NOTE_FALLBACK';

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.map((x) => String(x).trim()) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isHiddenTechnicalNoteFallbackRow(row: TrankilV2TimelineItemRow): boolean {
  const tags = parseJsonArray(row.suggested_tags);
  if (tags.includes(NOTE_FALLBACK_LABEL)) return true;
  const meta = parseJsonObject(row.metadata_json);
  if (String(meta.persistence_label || '').trim() === NOTE_FALLBACK_LABEL) return true;
  return false;
}

export function filterTimelineVisibleRows<T extends TrankilV2TimelineItemRow>(rows: T[]): T[] {
  return rows.filter((row) => !isHiddenTechnicalNoteFallbackRow(row));
}
