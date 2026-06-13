/**
 * Rappels **découplés du type** d’intention : planification locale via expo-notifications
 * à partir de `data.dueDateTime` (ISO) et `data.recurrence` (objet structuré).
 *
 * @module oneTapUniversalReminders
 */

import { parsePass1DueDateTime } from '../utils/pass1DueDateParse';

import { ensureNotificationPermissions, getNotifications } from './notifications';

type Translate = (key: string, options?: Record<string, string | number>) => string;

const ONE_TAP_NOTIF_IDS = (intentionId: string) =>
  [
    `one_tap_due_${intentionId}`,
    `one_tap_rec_daily_${intentionId}`,
    `one_tap_rec_weekly_${intentionId}`,
  ] as const;

/** Annule les rappels one-tap liés à une intention (avant reprogrammation ou suppression brouillon). */
export async function cancelOneTapUniversalReminders(intentionId: string): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  for (const ident of ONE_TAP_NOTIF_IDS(intentionId)) {
    try {
      await n.cancelScheduledNotificationAsync(ident);
    } catch {
      /* ignore */
    }
  }
}

function recurrenceFrequency(rec: Record<string, unknown>): string {
  return String(rec.frequency ?? rec.cadence ?? '').toLowerCase().trim();
}

function strField(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Résout la date cible : `dueDateTime` ISO ou recomposition `dueDateYmd` + `dueTimeHm`. */
export function resolveOneTapReminderDueDate(data: Record<string, unknown>): Date | null {
  const dueRaw = strField(data, 'dueDateTime');
  if (dueRaw) {
    const when = new Date(dueRaw);
    if (!Number.isNaN(when.getTime())) return when;
  }

  const ymd = strField(data, 'dueDateYmd') || strField(data, 'nextDueYmd');
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;

  const hm = strField(data, 'dueTimeHm');
  const combined = hm && hm !== '00:00' ? `${ymd} ${hm}` : ymd;
  const parsed = parsePass1DueDateTime(combined);
  if (!parsed.dueDateTime) return null;
  const when = new Date(parsed.dueDateTime);
  return Number.isNaN(when.getTime()) ? null : when;
}

/**
 * Planifie une notification ponctuelle et/ou une récurrence simple après persistance one-tap.
 */
export async function scheduleOneTapUniversalReminders(params: {
  intentionId: string;
  title: string;
  data: Record<string, unknown>;
  translate: Translate;
}): Promise<boolean> {
  const n = getNotifications();
  if (!n) return false;
  try {
    if (!(await ensureNotificationPermissions())) return false;
  } catch {
    return false;
  }

  const { intentionId, title, data, translate } = params;
  const triggerTypes = n.SchedulableTriggerInputTypes;
  let dueScheduled = false;

  const when = resolveOneTapReminderDueDate(data);
  if (when && when.getTime() > Date.now() + 4_000) {
    try {
      await n.scheduleNotificationAsync({
        identifier: `one_tap_due_${intentionId}`,
        content: {
          title: translate('talkDebug.oneTapReminderNotifTitle'),
          body: title,
          data: { kind: 'one_tap_due', intentionId },
        },
        trigger: { type: triggerTypes.DATE, date: when },
      });
      dueScheduled = true;
    } catch {
      /* module / trigger refusé */
    }
  }

  const rec = data.recurrence;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return dueScheduled;
  const ro = rec as Record<string, unknown>;
  const freq = recurrenceFrequency(ro);
  const summary = String(ro.summary ?? ro.description ?? '').trim() || title;

  try {
    if (freq === 'daily' || freq === 'day' || freq === 'quotidien') {
      await n.scheduleNotificationAsync({
        identifier: `one_tap_rec_daily_${intentionId}`,
        content: {
          title: translate('talkDebug.oneTapReminderRecurringTitle'),
          body: summary,
          data: { kind: 'one_tap_rec_daily', intentionId },
        },
        trigger: { type: triggerTypes.DAILY, hour: 9, minute: 0 },
      });
      return true;
    }
    if (freq === 'weekly' || freq === 'week' || freq === 'hebdo') {
      const jsWd = Number(ro.byWeekday);
      const weekday =
        Number.isFinite(jsWd) && jsWd >= 0 && jsWd <= 6
          ? jsWd + 1
          : 2;
      await n.scheduleNotificationAsync({
        identifier: `one_tap_rec_weekly_${intentionId}`,
        content: {
          title: translate('talkDebug.oneTapReminderRecurringTitle'),
          body: summary,
          data: { kind: 'one_tap_rec_weekly', intentionId },
        },
        trigger: { type: triggerTypes.WEEKLY, weekday, hour: 9, minute: 0 },
      });
    }
  } catch {
    /* ignore */
  }
  return dueScheduled;
}
