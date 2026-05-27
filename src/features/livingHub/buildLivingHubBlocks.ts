import type { TrankilV2TimelineItemRow } from '../../api';
import { isHabitRowActiveForDate, resolveHabitTimeTarget } from './habitRecurrenceEvaluator';
import { parseRowTemporalMeta } from './parseRowTemporalMeta';

export type HubBlockId = 'home_routine' | 'temporal' | 'residual';

export type HubBlock = {
  id: HubBlockId;
  emoji: string;
  titleI18nKey: string;
  emptyI18nKey: string;
  items: TrankilV2TimelineItemRow[];
  previewTitles: string[];
};

export type BuildLivingHubBlocksOptions = {
  activeHabits?: TrankilV2TimelineItemRow[];
  targetDate?: Date;
};

function normalizeCategoryId(raw: unknown): string {
  const up = String(raw ?? '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) {
    return up;
  }
  return 'PERSO';
}

function pickPreviewTitles(rows: TrankilV2TimelineItemRow[], max: number): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const title = String(r.display_title ?? '').trim();
    if (title && !out.includes(title)) out.push(title.slice(0, 72));
    if (out.length >= max) break;
  }
  return out;
}

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

function habitHasStrictTime(row: TrankilV2TimelineItemRow): boolean {
  const meta = parseMetadataJson(row.metadata_json);
  return Boolean(resolveHabitTimeTarget(meta));
}

function isHomeRoutineRow(row: TrankilV2TimelineItemRow): boolean {
  if (row.section === 'PROJECT_SUBTASK') return false;
  if (normalizeCategoryId(row.category_id) !== 'HOME') return false;
  const temporal = parseRowTemporalMeta(row);
  return !temporal.hasStrictTime;
}

function isTemporalRow(row: TrankilV2TimelineItemRow): boolean {
  return parseRowTemporalMeta(row).hasStrictTime;
}

function temporalSortKey(row: TrankilV2TimelineItemRow): string {
  const meta = parseMetadataJson(row.metadata_json);
  const habitHm = resolveHabitTimeTarget(meta);
  if (habitHm) return habitHm;
  return parseRowTemporalMeta(row).dueTimeHm ?? '99:99';
}

const BLOCK_DEFS: Record<
  HubBlockId,
  { emoji: string; titleI18nKey: string; emptyI18nKey: string }
> = {
  temporal: {
    emoji: '🕐',
    titleI18nKey: 'livingHub.temporalTitle',
    emptyI18nKey: 'livingHub.temporalEmpty',
  },
  home_routine: {
    emoji: '🏠',
    titleI18nKey: 'livingHub.homeRoutineTitle',
    emptyI18nKey: 'livingHub.homeRoutineEmpty',
  },
  residual: {
    emoji: '📥',
    titleI18nKey: 'livingHub.residualTitle',
    emptyI18nKey: 'livingHub.residualEmpty',
  },
};

function makeBlock(id: HubBlockId, items: TrankilV2TimelineItemRow[]): HubBlock {
  const def = BLOCK_DEFS[id];
  return {
    id,
    emoji: def.emoji,
    titleI18nKey: def.titleI18nKey,
    emptyI18nKey: def.emptyI18nKey,
    items,
    previewTitles: pickPreviewTitles(items, 2),
  };
}

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
 * Partitionne les intentions « aujourd'hui » en 3 blocs email (MVP).
 * Chaque ligne appartient à exactement un bloc.
 * Les habitudes actives (recurrence_rule) peuvent être injectées virtuellement via `activeHabits`.
 */
export function buildLivingHubBlocks(
  rows: TrankilV2TimelineItemRow[],
  opts?: BuildLivingHubBlocksOptions,
): HubBlock[] {
  const mergedRows = mergeActiveHabitsForHub(rows, opts);
  const temporal: TrankilV2TimelineItemRow[] = [];
  const homeRoutine: TrankilV2TimelineItemRow[] = [];
  const residual: TrankilV2TimelineItemRow[] = [];

  for (const row of mergedRows) {
    if (row.type === 'HABIT') {
      if (habitHasStrictTime(row)) temporal.push(row);
      else homeRoutine.push(row);
      continue;
    }
    if (isTemporalRow(row)) {
      temporal.push(row);
    } else if (isHomeRoutineRow(row)) {
      homeRoutine.push(row);
    } else {
      residual.push(row);
    }
  }

  temporal.sort((a, b) => temporalSortKey(a).localeCompare(temporalSortKey(b)));

  const blocks = [
    makeBlock('temporal', temporal),
    makeBlock('home_routine', homeRoutine),
    makeBlock('residual', residual),
  ];

  return blocks.sort((a, b) => {
    const aEmpty = a.items.length === 0 ? 1 : 0;
    const bEmpty = b.items.length === 0 ? 1 : 0;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;
    return b.items.length - a.items.length;
  });
}
