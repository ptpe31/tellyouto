import type { TrankilV2TimelineItemRow } from '../api';

export const NOTE_FALLBACK_LABEL = 'NOTE_FALLBACK';

/** Intention technique insérée au healthcheck SQLite (hors produit). */
export const SYSTEM_READY_SENTINEL_TITLE = 'System Ready';

export function isSystemReadySentinelRow(row: {
  id?: string | null;
  display_title?: string | null;
  title?: string | null;
}): boolean {
  const id = String(row.id ?? '').trim();
  if (id.startsWith('system_ready_')) return true;
  const title = String(row.display_title ?? row.title ?? '').trim();
  return title === SYSTEM_READY_SENTINEL_TITLE;
}

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
  const meta = parseJsonObject(row.metadata_json);
  /** Notes file `offline_audio_queue` : même label sémantique, mais visibles Timeline (pas le masque « technique » OneTap). */
  if (String(meta.source || '').trim() === 'offline_audio_queue') return false;
  const tags = parseJsonArray(row.suggested_tags);
  if (tags.includes(NOTE_FALLBACK_LABEL)) return true;
  if (String(meta.persistence_label || '').trim() === NOTE_FALLBACK_LABEL) return true;
  return false;
}

export function filterTimelineVisibleRows<T extends TrankilV2TimelineItemRow>(rows: T[]): T[] {
  return rows.filter((row) => !isHiddenTechnicalNoteFallbackRow(row) && !isSystemReadySentinelRow(row));
}
