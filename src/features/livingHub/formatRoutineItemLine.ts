import type { TrankilV2TimelineItemRow } from '../../api';
import {
  cadenceDescriptionFromRule,
  parseRecurrenceRuleFromMetadata,
} from '../../utils/habitRecurrenceRule';
import { isTrackStreakEnabled, parseIntentionMetadata } from '../../utils/intentionMetadata';
import { formatHubItemLine, type HubItemLine } from './formatHubItemLine';
import { getHabitStreakData, type HabitStreakData } from './getHabitStreakData';

export type RoutineHubItemLine = HubItemLine & {
  cadenceLabel: string;
  trackStreak: boolean;
  streakData: HabitStreakData | null;
};

function resolveCadenceLabel(meta: ReturnType<typeof parseIntentionMetadata>): string {
  const rule = parseRecurrenceRuleFromMetadata(meta);
  if (rule) return cadenceDescriptionFromRule(rule);
  const legacy = String(meta?.cadenceDescription ?? '').trim();
  if (legacy) return legacy.slice(0, 120);
  return 'Récurrent';
}

/** Ligne routine : titre, cadence et semainier compact (si opt-in). */
export function formatRoutineItemLine(
  row: TrankilV2TimelineItemRow,
  _completionDayKeys: string[],
  _referenceDate = new Date(),
): RoutineHubItemLine {
  const base = formatHubItemLine(row);
  const meta = parseIntentionMetadata(row.metadata_json);
  const trackStreak = isTrackStreakEnabled(meta);
  return {
    ...base,
    cadenceLabel: resolveCadenceLabel(meta),
    trackStreak,
    streakData: trackStreak ? getHabitStreakData(row.id) : null,
  };
}

export { resolveCadenceLabel };
