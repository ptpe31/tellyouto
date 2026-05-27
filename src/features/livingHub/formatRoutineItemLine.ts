import type { TrankilV2TimelineItemRow } from '../../api';
import {
  cadenceDescriptionFromRule,
  parseRecurrenceRuleFromMetadata,
} from '../../utils/habitRecurrenceRule';
import { resolveHabitStreakDisplay, type HabitStreakDisplay } from './habitStreak';
import { formatHubItemLine, type HubItemLine } from './formatHubItemLine';

export type RoutineHubItemLine = HubItemLine & {
  cadenceLabel: string;
  streak: HabitStreakDisplay;
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

function resolveCadenceLabel(meta: Record<string, unknown> | null): string {
  const rule = parseRecurrenceRuleFromMetadata(meta);
  if (rule) return cadenceDescriptionFromRule(rule);
  const legacy = String(meta?.cadenceDescription ?? '').trim();
  if (legacy) return legacy.slice(0, 120);
  return 'Récurrent';
}

/** Ligne routine : titre, cadence et badge série. */
export function formatRoutineItemLine(
  row: TrankilV2TimelineItemRow,
  completionDayKeys: string[],
  referenceDate = new Date(),
): RoutineHubItemLine {
  const base = formatHubItemLine(row);
  const meta = parseMetadataJson(row.metadata_json);
  const rule = parseRecurrenceRuleFromMetadata(meta);
  return {
    ...base,
    cadenceLabel: resolveCadenceLabel(meta),
    streak: resolveHabitStreakDisplay(rule, completionDayKeys, Number(row.created_at), referenceDate),
  };
}
