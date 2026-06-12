import type { TrankilV2TimelineItemRow } from '../../api';
import { resolveHabitTimeTarget } from './habitRecurrenceEvaluator';
import { computeDaysUntilDue, normalizeRowDueYmd } from './narrativePinRules';
import { parseRowTemporalMeta } from './parseRowTemporalMeta';
import { resolveNarrativeSubtitle } from './resolveNarrativeSubtitle';
import { resolveNarrativeTitle } from './resolveNarrativeTitle';
import type { TimeSegmentId } from './timeSegmentRegistry';
import type { HubItemLine } from './formatHubItemLine';

export type NarrativeItemLine = HubItemLine & {
  subtitle: string | null;
  /** Jours restants jusqu'à l'échéance (bloc Rappel uniquement). */
  daysUntil: number | null;
};

export type FormatNarrativeItemLineOptions = {
  locale?: string;
  todayYmd?: string;
  segmentId?: TimeSegmentId;
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

/** Ligne narrative : heure + titre clean + sous-titre lieu (optionnel). */
export function formatNarrativeItemLine(
  row: TrankilV2TimelineItemRow,
  localeOrOpts?: string | FormatNarrativeItemLineOptions,
): NarrativeItemLine {
  const opts: FormatNarrativeItemLineOptions =
    typeof localeOrOpts === 'string' ? { locale: localeOrOpts } : (localeOrOpts ?? {});
  const locale = opts.locale;
  const meta = parseMetadataJson(row.metadata_json);
  const temporal = parseRowTemporalMeta(row);
  const habitHm = resolveHabitTimeTarget(meta);
  const timeHm = temporal.dueTimeHm ?? habitHm;
  const isHabit = row.type === 'HABIT' || Boolean(meta?.recurrence_rule);
  const title = resolveNarrativeTitle(row, locale);
  const subtitleRaw = resolveNarrativeSubtitle(row);
  const subtitle =
    subtitleRaw && subtitleRaw.toLowerCase() !== title.toLowerCase() ? subtitleRaw : null;

  const dueYmd = normalizeRowDueYmd(row.due_date);
  let daysUntil: number | null = null;
  if (opts.segmentId === 'REMINDER' && dueYmd && opts.todayYmd) {
    daysUntil = computeDaysUntilDue(dueYmd, opts.todayYmd);
  }

  return {
    rowId: row.id,
    timeHm,
    title,
    isHabit,
    subtitle,
    daysUntil,
  };
}

/** Clé de tri : horaires d'abord (croissant), puis titres sans heure. */
export function narrativeItemSortKey(row: TrankilV2TimelineItemRow): string {
  const line = formatNarrativeItemLine(row);
  if (line.timeHm) return `0-${line.timeHm}-${line.title.toLowerCase()}`;
  return `1-${line.title.toLowerCase()}-${row.created_at}`;
}
