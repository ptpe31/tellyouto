import type { HabitRecurrenceRule } from '../../utils/habitRecurrenceRule';
import { isHabitActiveForDate } from './habitRecurrenceEvaluator';

export type HabitStreakDisplay =
  | { kind: 'fire'; days: number }
  | { kind: 'pause' }
  | { kind: 'none' };

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + delta);
  return startOfLocalDay(next);
}

function prevScheduledDate(
  rule: HabitRecurrenceRule,
  from: Date,
  anchor: Date,
  maxSteps = 120,
): Date | null {
  let cursor = startOfLocalDay(from);
  for (let i = 0; i < maxSteps; i += 1) {
    cursor = addDays(cursor, -1);
    if (cursor.getTime() < startOfLocalDay(anchor).getTime()) return null;
    if (isHabitActiveForDate(rule, cursor, anchor)) return cursor;
  }
  return null;
}

/**
 * Série consécutive d'occurrences planifiées cochées « Fait ».
 * Pause si l'utilisateur a manqué au moins 2 créneaux consécutifs après une série passée.
 */
export function resolveHabitStreakDisplay(
  rule: HabitRecurrenceRule | null,
  completionDayKeys: string[],
  createdAtMs: number,
  referenceDate = new Date(),
): HabitStreakDisplay {
  if (!rule || completionDayKeys.length === 0) return { kind: 'none' };

  const completionSet = new Set(completionDayKeys);
  const anchor = startOfLocalDay(new Date(createdAtMs));
  const today = startOfLocalDay(referenceDate);

  let cursor: Date | null = today;
  if (!isHabitActiveForDate(rule, today, anchor)) {
    cursor = prevScheduledDate(rule, today, anchor);
  }
  if (!cursor) return { kind: 'none' };

  let streak = 0;
  while (cursor && isHabitActiveForDate(rule, cursor, anchor)) {
    const ymd = toYmd(cursor);
    if (!completionSet.has(ymd)) break;
    streak += 1;
    cursor = prevScheduledDate(rule, cursor, anchor);
  }

  if (streak > 0) return { kind: 'fire', days: streak };

  const hadPastCompletions = completionDayKeys.length > 0;
  if (!hadPastCompletions) return { kind: 'none' };

  let missed = 0;
  let probe: Date | null = today;
  if (!isHabitActiveForDate(rule, today, anchor)) {
    probe = prevScheduledDate(rule, today, anchor);
  }
  while (probe && missed < 2) {
    const ymd = toYmd(probe);
    if (!completionSet.has(ymd)) {
      missed += 1;
    } else {
      break;
    }
    probe = prevScheduledDate(rule, probe, anchor);
  }

  return missed >= 2 ? { kind: 'pause' } : { kind: 'none' };
}
