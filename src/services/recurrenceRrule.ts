import { RRule } from 'rrule';

import type { IntentionRow } from '../api/localDb';

/**
 * Construit une règle RFC 5545 à partir de l’ancrage local (jour + minutes depuis minuit).
 * `recurrence_rrule` contient uniquement la partie RRULE (ex. `FREQ=WEEKLY;BYDAY=MO,WE`).
 */
export function buildRRuleFromIntention(row: IntentionRow): RRule | null {
  const raw = row.recurrence_rrule?.trim();
  const anchor = row.anchor_date_ymd?.trim();
  if (!raw || !anchor) return null;
  const parts = anchor.split('-').map(Number);
  const [y, m, d] = parts;
  if (
    parts.length !== 3 ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return null;
  }
  const mins = row.fixed_start_minutes ?? 0;
  const dtstart = new Date(y!, m! - 1, d!, 0, 0, 0, 0);
  dtstart.setMinutes(Math.max(0, Math.min(24 * 60 - 1, Math.floor(mins))));
  try {
    const parsed = RRule.parseString(raw);
    if (!parsed) return null;
    return new RRule({ ...parsed, dtstart });
  } catch {
    return null;
  }
}

/** Prochaine occurrence strictement après `after` (heure locale). */
export function nextOccurrenceAfter(
  row: IntentionRow,
  after: Date,
): Date | null {
  const rule = buildRRuleFromIntention(row);
  if (!rule) return null;
  const next = rule.after(after, false);
  return next ?? null;
}

/** Première occurrence à partir de `from` (inclusive). */
export function nextOccurrenceFrom(
  row: IntentionRow,
  from: Date,
): Date | null {
  const rule = buildRRuleFromIntention(row);
  if (!rule) return null;
  const next = rule.after(from, true);
  return next ?? null;
}
