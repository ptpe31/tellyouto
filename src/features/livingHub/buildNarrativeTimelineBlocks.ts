import type { TrankilV2TimelineItemRow } from '../../api';
import { formatNarrativeItemLine, narrativeItemSortKey, type NarrativeItemLine } from './formatNarrativeItemLine';
import { isHabitRowActiveForDate, resolveHabitTimeTarget } from './habitRecurrenceEvaluator';
import {
  extractReminderBlockRows,
  shouldRowAppearInTimeSegments,
  sortReminderBlockRows,
} from './narrativePinRules';
import { parseRowTemporalMeta } from './parseRowTemporalMeta';
import {
  resolveTimeSegmentFromHm,
  timeSegmentSortIndex,
  type TimeSegmentId,
} from './timeSegmentRegistry';

export type NarrativeTimelineBlock = {
  segmentId: TimeSegmentId;
  items: TrankilV2TimelineItemRow[];
  lines: NarrativeItemLine[];
  doneCount: number;
  totalCount: number;
};

export type BuildNarrativeTimelineBlocksOptions = {
  activeHabits?: TrankilV2TimelineItemRow[];
  targetDate?: Date;
  /** YYYY-MM-DD du jour affiché (requis pour le routage épinglé / Rappel). */
  todayYmd?: string;
  locale?: string;
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

function resolveRowTimeHm(row: TrankilV2TimelineItemRow): string | null {
  const meta = parseMetadataJson(row.metadata_json);
  const temporal = parseRowTemporalMeta(row);
  const habitHm = resolveHabitTimeTarget(meta);
  return temporal.dueTimeHm ?? habitHm;
}

function mergeActiveHabits(
  rows: TrankilV2TimelineItemRow[],
  opts?: BuildNarrativeTimelineBlocksOptions,
): TrankilV2TimelineItemRow[] {
  const habits = opts?.activeHabits ?? [];
  if (!habits.length) return rows;
  const targetDate = opts?.targetDate ?? new Date();
  const existingIds = new Set(rows.map((r) => r.id));
  const injected: TrankilV2TimelineItemRow[] = [];
  for (const habit of habits) {
    if (existingIds.has(habit.id)) continue;
    if (!isHabitRowActiveForDate(habit.metadata_json, targetDate, Number(habit.created_at))) continue;
    injected.push(habit);
  }
  return [...rows, ...injected];
}

function resolveTemporalSegmentId(row: TrankilV2TimelineItemRow): TimeSegmentId {
  const hm = resolveRowTimeHm(row);
  return resolveTimeSegmentFromHm(hm) ?? 'EVENING';
}

/**
 * Regroupe les intentions du jour par segment temporel (Matin / Après-midi / Soir / Rappel).
 * Le bloc « Rappel » est le seul foyer des intentions épinglées (`is_pinned`).
 */
export function buildNarrativeTimelineBlocks(
  rows: TrankilV2TimelineItemRow[],
  opts?: BuildNarrativeTimelineBlocksOptions,
): NarrativeTimelineBlock[] {
  const mergedRows = mergeActiveHabits(rows, opts);
  const todayYmd = opts?.todayYmd ?? '';
  const locale = opts?.locale;

  const reminderSource = todayYmd ? extractReminderBlockRows(mergedRows) : [];
  const reminderItems = todayYmd ? sortReminderBlockRows(reminderSource, todayYmd) : [];

  const temporalGroups = new Map<TimeSegmentId, TrankilV2TimelineItemRow[]>();
  for (const row of mergedRows) {
    if (todayYmd && !shouldRowAppearInTimeSegments(row, todayYmd)) continue;
    const segmentId = resolveTemporalSegmentId(row);
    const arr = temporalGroups.get(segmentId) ?? [];
    arr.push(row);
    temporalGroups.set(segmentId, arr);
  }

  const blocks: NarrativeTimelineBlock[] = [];
  for (const [segmentId, items] of temporalGroups) {
    if (!items.length) continue;
    const sorted = [...items].sort((a, b) => narrativeItemSortKey(a).localeCompare(narrativeItemSortKey(b)));
    const doneCount = sorted.filter((r) => r.status === 'DONE').length;
    blocks.push({
      segmentId,
      items: sorted,
      lines: sorted.map((row) => formatNarrativeItemLine(row, { locale, todayYmd, segmentId })),
      doneCount,
      totalCount: sorted.length,
    });
  }

  if (reminderItems.length) {
    const doneCount = reminderItems.filter((r) => r.status === 'DONE').length;
    blocks.push({
      segmentId: 'REMINDER',
      items: reminderItems,
      lines: reminderItems.map((row) =>
        formatNarrativeItemLine(row, { locale, todayYmd, segmentId: 'REMINDER' }),
      ),
      doneCount,
      totalCount: reminderItems.length,
    });
  }

  return blocks.sort((a, b) => timeSegmentSortIndex(a.segmentId) - timeSegmentSortIndex(b.segmentId));
}
