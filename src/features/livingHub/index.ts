export {
  ALL_TIMELINE_LAYOUT_MODES,
  DEFAULT_TIMELINE_LAYOUT_MODE,
  TIMELINE_LAYOUT_LABELS,
  TIMELINE_LAYOUT_STORAGE_KEY,
  isTimelineLayoutMode,
  persistTimelineLayoutMode,
  readPersistedTimelineLayoutMode,
  type TimelineLayoutMode,
} from './timelineLayoutRegistry';

export { buildLivingHubBlocks, type HubBlock, type BuildLivingHubBlocksOptions } from './buildLivingHubBlocks';
export { formatHubItemLine, hubItemSortKey, type HubItemLine } from './formatHubItemLine';
export {
  HUB_CATEGORY_EMOJI,
  HUB_CATEGORY_ORDER,
  hubCategoryEmoji,
  hubCategorySortIndex,
  normalizeHubCategoryId,
  type HubCategoryId,
} from './hubCategoryRegistry';
export { parseRowTemporalMeta, type RowTemporalMeta } from './parseRowTemporalMeta';
export {
  isHabitActiveForDate,
  isHabitRowActiveForDate,
  resolveHabitTimeTarget,
  type HabitRecurrenceRule,
} from './habitRecurrenceEvaluator';
export { LivingHubBlockShell } from './LivingHubBlockShell';

import { useAppTheme } from '../../context/ThemeContext';

/** Variante de disposition Timeline (Debug — orthogonal aux skins Test Theme). */
export function useTimelineLayoutMode() {
  const { timelineLayoutMode, setTimelineLayoutMode, timelineLayoutHydrated } = useAppTheme();
  return { timelineLayoutMode, setTimelineLayoutMode, timelineLayoutHydrated };
}
