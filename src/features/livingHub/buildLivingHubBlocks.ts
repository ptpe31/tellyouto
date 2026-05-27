import type { TrankilV2TimelineItemRow } from '../../api';
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

function isHomeRoutineRow(row: TrankilV2TimelineItemRow): boolean {
  if (row.section === 'PROJECT_SUBTASK') return false;
  if (normalizeCategoryId(row.category_id) !== 'HOME') return false;
  const temporal = parseRowTemporalMeta(row);
  return !temporal.hasStrictTime;
}

function isTemporalRow(row: TrankilV2TimelineItemRow): boolean {
  return parseRowTemporalMeta(row).hasStrictTime;
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

/**
 * Partitionne les intentions « aujourd'hui » en 3 blocs email (MVP).
 * Chaque ligne appartient à exactement un bloc.
 */
export function buildLivingHubBlocks(rows: TrankilV2TimelineItemRow[]): HubBlock[] {
  const temporal: TrankilV2TimelineItemRow[] = [];
  const homeRoutine: TrankilV2TimelineItemRow[] = [];
  const residual: TrankilV2TimelineItemRow[] = [];

  for (const row of rows) {
    if (isTemporalRow(row)) {
      temporal.push(row);
    } else if (isHomeRoutineRow(row)) {
      homeRoutine.push(row);
    } else {
      residual.push(row);
    }
  }

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
