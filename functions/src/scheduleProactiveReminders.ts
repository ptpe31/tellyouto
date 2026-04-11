import type { Firestore } from 'firebase-admin/firestore';

import { buildDeepLink, sendTelegramText } from './botReply';
import { formatProactiveReminderMessage } from './reminderMessages';

export type RailReminderWindow = {
  intentionId: string;
  title: string;
  urgent: boolean;
  slotStartUtcMs: number;
  remindAtUtcMs: number;
  leadMin: number;
};

/** Fenêtre d’envoi après l’heure prévue (dérive cron ~1 min). */
const FIRE_WINDOW_MS = 120_000;
const STALE_CUT_MS = 7 * 24 * 60 * 60 * 1000;

function pruneSentMap(
  raw: Record<string, unknown> | undefined,
  now: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && now - v < 48 * 60 * 60 * 1000) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Parcourt les appareils avec rail synchronisé et envoie les rappels dans la fenêtre [now, now+90s].
 */
export async function runProactiveReminders(firestore: Firestore): Promise<void> {
  const now = Date.now();
  const staleCut = now - STALE_CUT_MS;

  const devicesSnap = await firestore
    .collection('devices')
    .where('rail_reminders_updated_at', '>', staleCut)
    .limit(400)
    .get();

  for (const docSnap of devicesSnap.docs) {
    const deviceId = docSnap.id;
    const d = docSnap.data();

    if (d.messenger_reminders_enabled === false) continue;
    if (d.focus_session_active === true) continue;

    const windows = (d.rail_reminder_windows ?? []) as RailReminderWindow[];
    if (!Array.isArray(windows) || windows.length === 0) continue;

    const locale =
      typeof d.locale === 'string' && d.locale.trim() ? d.locale.trim() : 'fr';
    const firstName =
      typeof d.first_name === 'string' && d.first_name.trim()
        ? d.first_name.trim()
        : '';

    const channel =
      typeof d.last_messenger_channel === 'string'
        ? d.last_messenger_channel
        : '';
    const messengerUserId =
      typeof d.last_messenger_user_id === 'string'
        ? d.last_messenger_user_id
        : '';
    if (!channel || !messengerUserId) continue;

    let sentMap = pruneSentMap(
      d.reminder_sent_map as Record<string, unknown> | undefined,
      now,
    );
    let changed = false;

    for (const w of windows) {
      if (
        !w ||
        typeof w.remindAtUtcMs !== 'number' ||
        typeof w.intentionId !== 'string'
      ) {
        continue;
      }
      const t = w.remindAtUtcMs;
      if (now < t || now > t + FIRE_WINDOW_MS) continue;

      const key = `${w.intentionId}_${w.slotStartUtcMs}`;
      if (sentMap[key]) continue;

      const leadMin =
        typeof w.leadMin === 'number' && Number.isFinite(w.leadMin)
          ? Math.max(1, Math.round(w.leadMin))
          : typeof d.messenger_reminder_lead_minutes === 'number'
            ? Math.max(1, Math.round(d.messenger_reminder_lead_minutes))
            : 5;

      const text = formatProactiveReminderMessage(locale, {
        leadMin,
        title:
          typeof w.title === 'string' && w.title.trim()
            ? w.title.trim()
            : 'Intention',
        firstName,
        deepLink: buildDeepLink('timeline'),
        urgent: !!w.urgent,
      });

      if (channel === 'telegram') {
        await sendTelegramText(messengerUserId, text, {
          disableNotification: false,
        });
      } else {
        console.warn(
          `scheduleProactiveReminders: channel ${channel} not implemented for device ${deviceId}`,
        );
      }

      sentMap = { ...sentMap, [key]: now };
      changed = true;
    }

    if (changed) {
      await firestore.collection('devices').doc(deviceId).set(
        {
          reminder_sent_map: sentMap,
          reminder_sent_updated_at: now,
        },
        { merge: true },
      );
    }
  }
}
