import type { TrankilV2TimelineItemRow } from '../../api';
import { formatHubItemLine, hubItemSortKey, type HubItemLine } from './formatHubItemLine';
import { formatRoutineItemLine, type RoutineHubItemLine } from './formatRoutineItemLine';
import { isHabitRowActiveForDate } from './habitRecurrenceEvaluator';
import {
  hubCategoryEmoji,
  hubCategorySortIndex,
  normalizeHubCategoryId,
  type HubCategoryId,
} from './hubCategoryRegistry';

export type HubBlock = {
  categoryId: HubCategoryId;
  emoji: string;
  items: TrankilV2TimelineItemRow[];
  lines: HubItemLine[];
  routineLines?: RoutineHubItemLine[];
};

export type BuildLivingHubBlocksOptions = {
  activeHabits?: TrankilV2TimelineItemRow[];
  targetDate?: Date;
};

function mergeActiveHabitsForHub(
  rows: TrankilV2TimelineItemRow[],
  opts?: BuildLivingHubBlocksOptions,
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

/**
 * Regroupe les intentions du jour par `category_id` IA (Pass 1).
 * Seules les catégories non vides sont retournées.
 */
export function buildLivingHubBlocks(
  rows: TrankilV2TimelineItemRow[],
  opts?: BuildLivingHubBlocksOptions,
): HubBlock[] {
  const mergedRows = mergeActiveHabitsForHub(rows, opts);
  const groups = new Map<HubCategoryId, TrankilV2TimelineItemRow[]>();

  for (const row of mergedRows) {
    const key = normalizeHubCategoryId(row.category_id);
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const blocks: HubBlock[] = [];
  for (const [categoryId, items] of groups) {
    if (!items.length) continue;
    const sorted = [...items].sort((a, b) => hubItemSortKey(a).localeCompare(hubItemSortKey(b)));
    blocks.push({
      categoryId,
      emoji: hubCategoryEmoji(categoryId),
      items: sorted,
      lines: sorted.map(formatHubItemLine),
    });
  }

  return blocks.sort(
    (a, b) =>
      hubCategorySortIndex(a.categoryId) - hubCategorySortIndex(b.categoryId) ||
      b.items.length - a.items.length,
  );
}

export type BuildRoutineHubBlocksOptions = {
  completionDaysById?: Map<string, string[]>;
  targetDate?: Date;
};

/** Regroupe les routines actives par catégorie IA (vue « Gérer »). */
export function buildRoutineHubBlocks(
  rows: TrankilV2TimelineItemRow[],
  opts?: BuildRoutineHubBlocksOptions,
): HubBlock[] {
  const referenceDate = opts?.targetDate ?? new Date();
  const completionDaysById = opts?.completionDaysById ?? new Map<string, string[]>();
  const groups = new Map<HubCategoryId, TrankilV2TimelineItemRow[]>();

  for (const row of rows) {
    const key = normalizeHubCategoryId(row.category_id);
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const blocks: HubBlock[] = [];
  for (const [categoryId, items] of groups) {
    if (!items.length) continue;
    const sorted = [...items].sort((a, b) => hubItemSortKey(a).localeCompare(hubItemSortKey(b)));
    const routineLines = sorted.map((row) =>
      formatRoutineItemLine(row, completionDaysById.get(row.id) ?? [], referenceDate),
    );
    blocks.push({
      categoryId,
      emoji: hubCategoryEmoji(categoryId),
      items: sorted,
      lines: routineLines,
      routineLines,
    });
  }

  return blocks.sort(
    (a, b) =>
      hubCategorySortIndex(a.categoryId) - hubCategorySortIndex(b.categoryId) ||
      b.items.length - a.items.length,
  );
}
