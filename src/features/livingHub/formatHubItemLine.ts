import type { TrankilV2TimelineItemRow } from '../../api';
import { resolveHabitTimeTarget } from './habitRecurrenceEvaluator';
import { parseRowTemporalMeta } from './parseRowTemporalMeta';

export type HubItemLine = {
  rowId: string;
  timeHm: string | null;
  title: string;
  isHabit: boolean;
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

function resolveDisplayTitle(row: TrankilV2TimelineItemRow): string {
  const direct = String(row.display_title ?? '').trim();
  if (direct) return direct.slice(0, 120);
  const raw = String(row.content_raw ?? '').trim();
  if (raw) return raw.slice(0, 120);
  return row.id;
}

/** Ligne email : heure optionnelle + titre + marqueur habitude. */
export function formatHubItemLine(row: TrankilV2TimelineItemRow): HubItemLine {
  const meta = parseMetadataJson(row.metadata_json);
  const temporal = parseRowTemporalMeta(row);
  const habitHm = resolveHabitTimeTarget(meta);
  const timeHm = temporal.dueTimeHm ?? habitHm;
  const isHabit = row.type === 'HABIT' || Boolean(meta?.recurrence_rule);

  return {
    rowId: row.id,
    timeHm,
    title: resolveDisplayTitle(row),
    isHabit,
  };
}

/** Clé de tri : horaires d'abord (croissant), puis titres sans heure. */
export function hubItemSortKey(row: TrankilV2TimelineItemRow): string {
  const line = formatHubItemLine(row);
  if (line.timeHm) return `0-${line.timeHm}-${line.title.toLowerCase()}`;
  return `1-${line.title.toLowerCase()}-${row.created_at}`;
}
