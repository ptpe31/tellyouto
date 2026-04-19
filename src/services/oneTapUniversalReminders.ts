/**
 * Rappels **découplés du type** d’intention : planification locale via expo-notifications
 * à partir de `data.dueDateTime` (ISO) et `data.recurrence` (objet structuré).
 *
 * @module oneTapUniversalReminders
 */

import { ensureNotificationPermissions, getNotifications } from './notifications';

type Translate = (key: string, options?: Record<string, string | number>) => string;

function recurrenceFrequency(rec: Record<string, unknown>): string {
  return String(rec.frequency ?? rec.cadence ?? '').toLowerCase().trim();
}

/**
 * Planifie une notification ponctuelle et/ou une récurrence simple après persistance one-tap.
 */
export async function scheduleOneTapUniversalReminders(params: {
  intentionId: string;
  title: string;
  data: Record<string, unknown>;
  translate: Translate;
}): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  try {
    if (!(await ensureNotificationPermissions())) return;
  } catch {
    return;
  }

  const { intentionId, title, data, translate } = params;
  const triggerTypes = n.SchedulableTriggerInputTypes;

  const dueRaw = data.dueDateTime;
  if (typeof dueRaw === 'string' && dueRaw.trim()) {
    const when = new Date(dueRaw.trim());
    if (!Number.isNaN(when.getTime()) && when.getTime() > Date.now() + 4_000) {
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
      } catch {
        /* module / trigger refusé */
      }
    }
  }

  const rec = data.recurrence;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return;
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
      return;
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
}
