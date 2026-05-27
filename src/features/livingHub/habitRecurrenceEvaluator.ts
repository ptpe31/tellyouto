/**
 * Évaluation juste-à-temps des habitudes pour le Living Hub.
 *
 * @module habitRecurrenceEvaluator
 */

import {
  normalizeHabitTimeHm,
  parseRecurrenceRuleFromMetadata,
  type HabitRecurrenceRule,
} from '../../utils/habitRecurrenceRule';

export type { HabitRecurrenceRule };

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function isoWeekday(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime();
  return Math.floor(ms / 86_400_000);
}

function weeksBetween(a: Date, b: Date): number {
  return Math.floor(daysBetween(a, b) / 7);
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Heure cible affichée pour une habitude (metadata). */
export function resolveHabitTimeTarget(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const rule = parseRecurrenceRuleFromMetadata(metadata);
  if (rule?.time_target) return normalizeHabitTimeHm(rule.time_target);
  return normalizeHabitTimeHm(metadata.preferredTimeHm);
}

/**
 * Détermine si une habitude doit apparaître pour `targetDate` (jour local).
 * `anchorDate` = date de création (ou première activation) pour les intervalles > 1.
 */
export function isHabitActiveForDate(
  rule: HabitRecurrenceRule,
  targetDate: Date,
  anchorDate?: Date,
): boolean {
  const anchor = startOfLocalDay(anchorDate ?? targetDate);
  const target = startOfLocalDay(targetDate);
  if (target.getTime() < anchor.getTime()) return false;

  const interval = Math.max(1, rule.interval ?? 1);

  switch (rule.frequency) {
    case 'DAILY': {
      const delta = daysBetween(anchor, target);
      return delta >= 0 && delta % interval === 0;
    }
    case 'WEEKLY': {
      if (rule.byWeekday != null && isoWeekday(target) !== rule.byWeekday) return false;
      const delta = weeksBetween(anchor, target);
      return delta >= 0 && delta % interval === 0;
    }
    case 'MONTHLY': {
      const dom = rule.dayOfMonth ?? anchor.getDate();
      const lastDom = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      const effectiveDom = Math.min(dom, lastDom);
      if (target.getDate() !== effectiveDom) return false;
      const delta = monthsBetween(anchor, target);
      return delta >= 0 && delta % interval === 0;
    }
    case 'HOURLY':
      return daysBetween(anchor, target) >= 0;
    case 'MINUTELY': {
      if (!rule.duration_minutes) return daysBetween(anchor, target) >= 0;
      const sameDay = daysBetween(anchor, target) === 0;
      if (!sameDay) return false;
      const elapsedMin = (targetDate.getTime() - anchorDate!.getTime()) / 60_000;
      return elapsedMin >= 0 && elapsedMin <= rule.duration_minutes;
    }
    default:
      return false;
  }
}

export function isHabitRowActiveForDate(
  metadataJson: string | null | undefined,
  targetDate: Date,
  createdAtMs: number,
): boolean {
  let meta: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(String(metadataJson ?? '')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  const rule = parseRecurrenceRuleFromMetadata(meta);
  if (!rule) return false;
  const anchor = new Date(createdAtMs);
  return isHabitActiveForDate(rule, targetDate, anchor);
}
