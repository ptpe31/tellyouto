/**
 * Contrat `recurrence_rule` pour habitudes OneTap — stockage JSON léger, évaluation JIT côté UI.
 *
 * @module habitRecurrenceRule
 */

import { parsePass1DueDateTime } from './pass1DueDateParse';

export type HabitFrequency = 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type HabitRecurrenceRule = {
  frequency: HabitFrequency;
  interval?: number;
  time_target?: string;
  byWeekday?: number;
  dayOfMonth?: number;
  duration_minutes?: number;
  raw_phrase?: string;
};

const VALID_FREQUENCIES = new Set<HabitFrequency>(['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']);

export function normalizeHabitTimeHm(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [hRaw, mRaw] = s.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function normalizeHabitFrequency(raw: unknown): HabitFrequency | null {
  const up = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (VALID_FREQUENCIES.has(up as HabitFrequency)) return up as HabitFrequency;
  const low = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (low === 'daily' || low === 'quotidien' || low === 'day') return 'DAILY';
  if (low === 'weekly' || low === 'hebdo' || low === 'week') return 'WEEKLY';
  if (low === 'monthly' || low === 'mensuel' || low === 'month') return 'MONTHLY';
  if (low === 'hourly' || low === 'heure') return 'HOURLY';
  if (low === 'minutely' || low === 'minute') return 'MINUTELY';
  return null;
}

function inferFrequencyFromText(text: string): HabitFrequency | null {
  const t = text.toLowerCase();
  if (/\b(toutes?\s+les?\s+\d*\s*heures?|every\s+\d*\s*hours?|hourly|chaque\s+heure)\b/.test(t)) return 'HOURLY';
  if (/\b(toutes?\s+les?\s+\d*\s*minutes?|every\s+\d*\s*minutes?|minutely)\b/.test(t)) return 'MINUTELY';
  if (/\b(tous\s+les\s+lundis?|every\s+monday|chaque\s+semaine|weekly|hebdo|toutes?\s+les?\s+semaines?)\b/.test(t)) {
    return 'WEEKLY';
  }
  if (/\b(tous\s+les\s+mois|every\s+month|monthly|mensuel|chaque\s+mois)\b/.test(t)) return 'MONTHLY';
  if (/\b(tous\s+les\s+jours?|every\s+day|daily|quotidien|chaque\s+jour|routine|habitude)\b/.test(t)) return 'DAILY';
  return null;
}

function parseIntervalFromText(text: string): number {
  const t = text.toLowerCase();
  const m = t.match(
    /\b(?:tous?\s+les|every|toutes?\s+les)\s+(\d+)\s+(?:jours?|days?|semaines?|weeks?|heures?|hours?|minutes?|mois)\b/,
  );
  if (m) return Math.max(1, parseInt(m[1], 10));
  return 1;
}

function extractTimeFromDueOrPref(due?: string, preferredTime?: string, skeletonHm?: string): string | null {
  const pref = normalizeHabitTimeHm(preferredTime) ?? normalizeHabitTimeHm(skeletonHm);
  if (pref) return pref;
  const dueRaw = String(due ?? '').trim();
  if (!dueRaw) return null;
  const parsed = parsePass1DueDateTime(dueRaw);
  return parsed.dueTimeHm ? normalizeHabitTimeHm(parsed.dueTimeHm) : null;
}

/** Parse un objet `recurrence_rule` brut (metadata ou intent Gemini). */
export function parseRecurrenceRuleFromObject(raw: unknown): HabitRecurrenceRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const freq = normalizeHabitFrequency(r.frequency);
  if (!freq) return null;
  const intervalRaw = Number(r.interval);
  const rule: HabitRecurrenceRule = {
    frequency: freq,
    interval: Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.trunc(intervalRaw) : 1,
  };
  const tt = normalizeHabitTimeHm(r.time_target ?? r.timeTarget);
  if (tt) rule.time_target = tt;
  const dow = Number(r.byWeekday ?? r.dayOfWeek);
  if (Number.isFinite(dow) && dow >= 1 && dow <= 7) rule.byWeekday = Math.trunc(dow);
  const dom = Number(r.dayOfMonth);
  if (Number.isFinite(dom) && dom >= 1 && dom <= 31) rule.dayOfMonth = Math.trunc(dom);
  const dur = Number(r.duration_minutes ?? r.durationMinutes);
  if (Number.isFinite(dur) && dur > 0) rule.duration_minutes = Math.trunc(dur);
  const rp = String(r.raw_phrase ?? r.rawPhrase ?? '').trim();
  if (rp) rule.raw_phrase = rp.slice(0, 500);
  return rule;
}

export function cadenceDescriptionFromRule(rule: HabitRecurrenceRule): string {
  if (rule.raw_phrase?.trim()) return rule.raw_phrase.trim().slice(0, 500);
  const interval = rule.interval ?? 1;
  switch (rule.frequency) {
    case 'DAILY':
      return interval === 1 ? 'Quotidien' : `Tous les ${interval} jours`;
    case 'WEEKLY':
      return interval === 1 ? 'Hebdomadaire' : `Toutes les ${interval} semaines`;
    case 'MONTHLY':
      return interval === 1 ? 'Mensuel' : `Tous les ${interval} mois`;
    case 'HOURLY':
      return interval === 1 ? 'Toutes les heures' : `Toutes les ${interval} heures`;
    case 'MINUTELY':
      return interval === 1 ? 'Toutes les minutes' : `Toutes les ${interval} minutes`;
    default:
      return 'Récurrent';
  }
}

/** Coercition défensive quand Gemini renvoie l’ancien format (`recurrence` + `due`). */
export function coerceRecurrenceRule(params: {
  recurrence_rule?: unknown;
  recurrence?: string;
  preferredTime?: string;
  due?: string;
  skeletonPreferredTimeHm?: string;
  skeletonCadence?: string;
  transcript?: string;
}): HabitRecurrenceRule | null {
  const fromObj = params.recurrence_rule ? parseRecurrenceRuleFromObject(params.recurrence_rule) : null;
  const time = extractTimeFromDueOrPref(params.due, params.preferredTime, params.skeletonPreferredTimeHm);

  if (fromObj) {
    if (!fromObj.time_target && time) fromObj.time_target = time;
    if (!fromObj.raw_phrase && params.recurrence?.trim()) fromObj.raw_phrase = params.recurrence.trim().slice(0, 500);
    return fromObj;
  }

  const textParts = [params.recurrence, params.transcript, params.skeletonCadence].filter(Boolean).join(' ').trim();
  const freq = inferFrequencyFromText(textParts);
  if (!freq && !time && !params.recurrence?.trim()) return null;

  const resolvedFreq = freq ?? 'DAILY';
  return {
    frequency: resolvedFreq,
    interval: parseIntervalFromText(textParts),
    ...(time ? { time_target: time } : {}),
    raw_phrase: (params.recurrence || textParts || '').trim().slice(0, 500) || undefined,
  };
}

export function parseRecurrenceRuleFromMetadata(metadata: Record<string, unknown> | null): HabitRecurrenceRule | null {
  if (!metadata) return null;
  const direct = parseRecurrenceRuleFromObject(metadata.recurrence_rule);
  if (direct) return direct;

  const legacy = metadata.recurrence_rule;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    const lo = legacy as Record<string, unknown>;
    const freq = normalizeHabitFrequency(lo.frequency);
    if (freq) {
      return parseRecurrenceRuleFromObject({
        frequency: freq,
        interval: lo.interval,
        byWeekday: lo.dayOfWeek ?? lo.byWeekday,
        time_target: metadata.preferredTimeHm,
        raw_phrase: metadata.cadenceDescription,
      });
    }
  }

  const cadence = String(metadata.cadenceDescription ?? '').trim();
  const pref = normalizeHabitTimeHm(metadata.preferredTimeHm);
  if (!cadence && !pref) return null;
  return coerceRecurrenceRule({
    recurrence: cadence,
    preferredTime: pref ?? undefined,
    skeletonCadence: cadence,
  });
}
