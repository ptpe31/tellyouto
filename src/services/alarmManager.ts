import { Platform } from '../utils/rnPlatform';

import { ensureNotificationPermissions, getNotifications } from './notifications';
import type { IntentionRow } from '../api/localDb';
import type { TimelineSlot } from './agentLogic';

const ANDROID_ALARM_CHANNEL = 'tellyouto_rail_alarms';

/** Identifiant stable par intention — annulation / remplacement sans ambiguïté. */
export function intentionRailAlarmNotificationId(intentionId: string): string {
  return `tellyouto_rail_alarm_${intentionId}`;
}

let androidChannelReady = false;

async function ensureAndroidAlarmChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const n = getNotifications();
  if (!n) return;
  if (androidChannelReady) return;
  await n.setNotificationChannelAsync(ANDROID_ALARM_CHANNEL, {
    name: 'TellYouTo · Rail',
    importance: n.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400],
    sound: 'default',
    enableVibrate: true,
    bypassDnd: false,
  });
  androidChannelReady = true;
}

function dateAtLocalMinutes(day: Date, totalMinutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(Math.floor(totalMinutes));
  d.setSeconds(0);
  d.setMilliseconds(0);
  return d;
}

export async function cancelIntentionRailAlarm(intentionId: string): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  const id = intentionRailAlarmNotificationId(intentionId);
  try {
    await n.cancelScheduledNotificationAsync(id);
  } catch {
    /* id inconnu : ignoré */
  }
}

/**
 * Demande la permission notification au premier besoin (case Alarme cochée).
 */
export async function requestAlarmPermissionIfNeeded(): Promise<boolean> {
  return ensureNotificationPermissions();
}

async function scheduleSlotAlarm(
  intentionId: string,
  title: string,
  startMinutes: number,
  now: Date,
): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  await ensureAndroidAlarmChannel();

  const when = dateAtLocalMinutes(now, startMinutes);
  if (when.getTime() <= now.getTime() + 10_000) {
    await cancelIntentionRailAlarm(intentionId);
    return;
  }

  const identifier = intentionRailAlarmNotificationId(intentionId);
  try {
    await n.cancelScheduledNotificationAsync(identifier);
  } catch {
    /* */
  }

  await n.scheduleNotificationAsync({
    identifier,
    content: {
      title,
      body: '',
      sound: true,
      data: { kind: 'rail_alarm', intentionId },
      ...(Platform.OS === 'ios'
        ? { interruptionLevel: 'timeSensitive' as const }
        : { priority: n.AndroidNotificationPriority.MAX }),
    },
    trigger: {
      type: n.SchedulableTriggerInputTypes.DATE,
      date: when,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_ALARM_CHANNEL } : {}),
    },
  });
}

/**
 * Annule les alarmes obsolètes et reprogramme selon le rail courant (créneaux suggérés).
 */
export async function syncRailAlarmsWithTimeline(args: {
  pendingIntentions: IntentionRow[];
  slots: TimelineSlot[];
  now: Date;
}): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const { pendingIntentions, slots, now } = args;
  const slotById = new Map<string, TimelineSlot>();
  for (const s of slots) {
    const prev = slotById.get(s.intention.id);
    if (!prev || s.startMinutes < prev.startMinutes) {
      slotById.set(s.intention.id, s);
    }
  }

  for (const row of pendingIntentions) {
    if (!row.alarm_enabled) {
      await cancelIntentionRailAlarm(row.id);
      continue;
    }
    const slot = slotById.get(row.id);
    if (!slot) {
      await cancelIntentionRailAlarm(row.id);
      continue;
    }
    await scheduleSlotAlarm(row.id, row.title, slot.startMinutes, now);
  }
}
