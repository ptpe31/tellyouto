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

export { buildLivingHubBlocks, buildRoutineHubBlocks, type HubBlock, type BuildLivingHubBlocksOptions, type BuildRoutineHubBlocksOptions } from './buildLivingHubBlocks';
export {
  buildNarrativeTimelineBlocks,
  type NarrativeTimelineBlock,
  type BuildNarrativeTimelineBlocksOptions,
} from './buildNarrativeTimelineBlocks';
export { formatHubItemLine, hubItemSortKey, type HubItemLine } from './formatHubItemLine';
export { formatNarrativeItemLine, narrativeItemSortKey, type NarrativeItemLine } from './formatNarrativeItemLine';
export { resolveNarrativeSubtitle } from './resolveNarrativeSubtitle';
export { resolveNarrativeTitle } from './resolveNarrativeTitle';
export {
  computeDaysUntilDue,
  extractReminderBlockRows,
  isRowDueOnYmd,
  isRowPinned,
  normalizeRowDueYmd,
  resolveDueConstraintFromCapture,
  shouldAutoPinOnCapturePersist,
  shouldRowAppearInTimeSegments,
  sortReminderBlockRows,
} from './narrativePinRules';
export {
  TIME_SEGMENT_ORDER,
  isTimeSegmentPast,
  resolveCurrentTimeSegment,
  resolveTimeSegmentFromHm,
  timeSegmentDisplayTitle,
  timeSegmentSortIndex,
  type TimeSegmentId,
} from './timeSegmentRegistry';
export { formatRoutineItemLine, type RoutineHubItemLine } from './formatRoutineItemLine';
export { HabitStreakCompact } from './HabitStreakCompact';
export { getHabitStreakData, type HabitOccurrenceState, type HabitStreakData } from './getHabitStreakData';
export {
  HUB_CATEGORY_EMOJI,
  HUB_CATEGORY_ORDER,
  hubCategoryDisplayTitle,
  hubCategoryEmoji,
  hubCategorySortIndex,
  isHubTripRow,
  normalizeHubCategoryId,
  resolveHubBlockCategoryId,
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
export { NarrativeTimelineBlockShell } from './NarrativeTimelineBlockShell';
export { LivingHubCategoryModal } from './LivingHubCategoryModal';

import { useAppTheme } from '../../context/ThemeContext';

/** Variante de disposition Timeline (Debug — orthogonal aux skins Test Theme). */
export function useTimelineLayoutMode() {
  const { timelineLayoutMode, setTimelineLayoutMode, timelineLayoutHydrated } = useAppTheme();
  return { timelineLayoutMode, setTimelineLayoutMode, timelineLayoutHydrated };
}
