import AsyncStorage from '@react-native-async-storage/async-storage';

/** Disposition du corps Timeline sous « Aujourd'hui » (Debug — rollback via CURRENT). */
export type TimelineLayoutMode = 'CURRENT' | 'EMAIL_HUB';

export const TIMELINE_LAYOUT_STORAGE_KEY = '@trankil_debug_timeline_layout';

export const DEFAULT_TIMELINE_LAYOUT_MODE: TimelineLayoutMode = 'EMAIL_HUB';

export const ALL_TIMELINE_LAYOUT_MODES: TimelineLayoutMode[] = ['CURRENT', 'EMAIL_HUB'];

export const TIMELINE_LAYOUT_LABELS: Record<TimelineLayoutMode, string> = {
  CURRENT: 'Cartes actuelles',
  EMAIL_HUB: 'Chronologie narrative',
};

export function isTimelineLayoutMode(value: string): value is TimelineLayoutMode {
  return (ALL_TIMELINE_LAYOUT_MODES as string[]).includes(value);
}

export async function readPersistedTimelineLayoutMode(): Promise<TimelineLayoutMode> {
  try {
    const raw = await AsyncStorage.getItem(TIMELINE_LAYOUT_STORAGE_KEY);
    if (raw && isTimelineLayoutMode(raw)) return raw;
  } catch {
    /* fallback CURRENT */
  }
  return DEFAULT_TIMELINE_LAYOUT_MODE;
}

export async function persistTimelineLayoutMode(mode: TimelineLayoutMode): Promise<void> {
  await AsyncStorage.setItem(TIMELINE_LAYOUT_STORAGE_KEY, mode);
}
