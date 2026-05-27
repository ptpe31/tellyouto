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

export { buildLivingHubBlocks, type HubBlock, type HubBlockId } from './buildLivingHubBlocks';
export { parseRowTemporalMeta, type RowTemporalMeta } from './parseRowTemporalMeta';
export { LivingHubBlockShell } from './LivingHubBlockShell';

import { useAppTheme } from '../../context/ThemeContext';

/** Variante de disposition Timeline (Debug — orthogonal aux skins Test Theme). */
export function useTimelineLayoutMode() {
  const { timelineLayoutMode, setTimelineLayoutMode, timelineLayoutHydrated } = useAppTheme();
  return { timelineLayoutMode, setTimelineLayoutMode, timelineLayoutHydrated };
}
