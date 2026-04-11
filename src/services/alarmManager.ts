import { Alert } from 'react-native';

import i18n from '../locales/i18n';
import { Platform } from '../utils/rnPlatform';

import {
  ensureNotificationPermissions,
  getNotifications,
} from './notifications';
import type { IntentionRow } from '../api/localDb';
import type { TimelineSlot } from './agentLogic';
import { nextOccurrenceAfter, nextOccurrenceFrom } from './recurrenceRrule';

/** Fichier listé dans app.json → plugin expo-notifications → sounds (rebuild natif requis). */
const RAIL_ALARM_SOUND_FILE = 'rail_alarm.wav';

const ANDROID_ALARM_CHANNEL = 'tellyouto_rail_alarms_v2';

/** Identifiant stable par intention — annulation / remplacement sans ambiguïté. */
export function intentionRailAlarmNotificationId(intentionId: string): string {
  return `tellyouto_rail_alarm_${intentionId}`;
}

let androidChannelReady = false;

let permissionDeniedAlertLastShown = 0;
const PERMISSION_ALERT_THROTTLE_MS = 45_000;

function maybeAlertAgentAlarmPermissionDenied(): void {
  const t = Date.now();
  if (t - permissionDeniedAlertLastShown < PERMISSION_ALERT_THROTTLE_MS) return;
  permissionDeniedAlertLastShown = t;
  Alert.alert(
    i18n.t('agent.alarmPermissionTitle'),
    i18n.t('agent.alarmPermissionBody'),
  );
}

async function ensureAndroidAlarmChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const n = getNotifications();
  if (!n) return;
  if (androidChannelReady) return;
  await n.setNotificationChannelAsync(ANDROID_ALARM_CHANNEL, {
    name: 'TellYouTo · Rail',
    importance: n.AndroidImportance.MAX,
    vibrationPattern: [0, 450, 200, 450, 200, 450, 200, 600],
    sound: RAIL_ALARM_SOUND_FILE,
    enableVibrate: true,
    bypassDnd: true,
    lockscreenVisibility: n.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
    audioAttributes: {
      usage: n.AndroidAudioUsage.ALARM,
      contentType: n.AndroidAudioContentType.SONIFICATION,
      flags: {
        enforceAudibility: true,
        requestHardwareAudioVideoSynchronization: false,
      },
    },
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

/** Minutes depuis minuit (heure locale). */
function minutesSinceMidnightLocal(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Si l’agent active l’alarme sans `fixed_start_minutes` et sans créneau rail calculé,
 * on propose un déclenchement ~15 min plus tard le même jour (plafonné avant minuit).
 */
function fallbackRailAlarmStartMinutes(now: Date): number {
  const m = minutesSinceMidnightLocal(now);
  return Math.min(m + 15, 23 * 60 + 45);
}

/** Minuit local du jour d’ancrage (ou du jour courant si pas d’ancre). */
function intentionAlarmAnchorMidnight(row: IntentionRow, now: Date): Date {
  if (row.anchor_date_ymd) {
    const parts = row.anchor_date_ymd.split('-').map(Number);
    const [y, m, d] = parts;
    if (
      parts.length === 3 &&
      Number.isFinite(y) &&
      Number.isFinite(m) &&
      Number.isFinite(d)
    ) {
      return new Date(y!, m! - 1, d!, 0, 0, 0, 0);
    }
  }
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  return t;
}

async function cancelScheduledIdsForIntention(
  intentionId: string,
  extraId: string | null | undefined,
): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  const stable = intentionRailAlarmNotificationId(intentionId);
  const ids = new Set<string>([stable]);
  if (extraId && extraId.trim()) ids.add(extraId.trim());
  for (const id of ids) {
    try {
      await n.cancelScheduledNotificationAsync(id);
    } catch {
      /* inconnu */
    }
  }
}

export async function cancelIntentionRailAlarm(intentionId: string): Promise<void> {
  const { getIntentionById, setIntentionLocalNotificationId } = await import(
    '../api/localDb'
  );
  const row = await getIntentionById(intentionId);
  await cancelScheduledIdsForIntention(
    intentionId,
    row?.local_notification_id ?? undefined,
  );
  await setIntentionLocalNotificationId(intentionId, null);
}

/** Après purge locale des intentions — annule toutes les notifs rail encore planifiées. */
export async function cancelAllScheduledRailAlarms(): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  const prefix = 'tellyouto_rail_alarm_';
  try {
    const pending = await n.getAllScheduledNotificationsAsync();
    for (const req of pending) {
      const id = req.identifier;
      if (typeof id === 'string' && id.startsWith(prefix)) {
        await n.cancelScheduledNotificationAsync(id);
      }
    }
  } catch {
    /* */
  }
  try {
    const { clearAllIntentionLocalNotificationHandles } = await import(
      '../api/localDb'
    );
    await clearAllIntentionLocalNotificationHandles();
  } catch {
    /* SQLite indisponible */
  }
}

/**
 * Demande la permission notification au premier besoin (case Alarme cochée).
 * Retourne `true` si le module est absent (Expo Go, etc.) pour ne pas bloquer l’enregistrement SQLite de la préférence.
 * Retourne `false` si l’utilisateur refuse explicitement la permission sur un build avec notifications.
 */
export async function requestAlarmPermissionIfNeeded(): Promise<boolean> {
  const n = getNotifications();
  if (!n) {
    if (__DEV__) {
      console.warn(
        '[TellYouTo] expo-notifications indisponible (souvent Expo Go). Préférence alarme enregistrable ; planification native après dev build.',
      );
    }
    return true;
  }
  return ensureNotificationPermissions();
}

async function persistScheduledId(intentionId: string, scheduledId: string): Promise<void> {
  const { setIntentionLocalNotificationId } = await import('../api/localDb');
  await setIntentionLocalNotificationId(intentionId, scheduledId);
}

/**
 * Planifie une alarme à une date absolue (RRULE ou rail).
 * Annule toujours l’ancienne poignée (`local_notification_id` + id stable) avant création.
 * Pilotage 100 % local : permission vérifiée ici avant tout accès OS.
 */
async function scheduleIntentionRailAlarmAtDate(
  row: IntentionRow,
  when: Date,
  now: Date,
): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const permitted = await requestAlarmPermissionIfNeeded();
  if (!permitted) {
    maybeAlertAgentAlarmPermissionDenied();
    return;
  }

  if (when.getTime() <= now.getTime() + 10_000) {
    await cancelIntentionRailAlarm(row.id);
    return;
  }

  const { getIntentionById } = await import('../api/localDb');
  const fresh = (await getIntentionById(row.id)) ?? row;
  await cancelScheduledIdsForIntention(
    fresh.id,
    fresh.local_notification_id ?? undefined,
  );

  await ensureAndroidAlarmChannel();

  const identifier = intentionRailAlarmNotificationId(row.id);
  const soundName = RAIL_ALARM_SOUND_FILE;
  const scheduledId = await n.scheduleNotificationAsync({
    identifier,
    content: {
      title: row.title,
      body: '',
      sound: soundName,
      data: {
        kind: 'rail_alarm',
        intentionId: row.id,
      },
      ...(Platform.OS === 'ios'
        ? {
            interruptionLevel: 'timeSensitive' as const,
          }
        : { priority: n.AndroidNotificationPriority.MAX }),
    },
    trigger: {
      type: n.SchedulableTriggerInputTypes.DATE,
      date: when,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_ALARM_CHANNEL } : {}),
    },
  });
  await persistScheduledId(row.id, scheduledId);
  const timeLabel = when.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  console.log(`[Hardware] Alarme programmée pour ${row.title} à ${timeLabel}`);
}

async function scheduleIntentionRailAlarm(
  row: IntentionRow,
  startMinutes: number,
  now: Date,
): Promise<void> {
  const dayStart = intentionAlarmAnchorMidnight(row, now);
  const when = dateAtLocalMinutes(dayStart, startMinutes);
  await scheduleIntentionRailAlarmAtDate(row, when, now);
}

function computeNextRruleAlarmDate(row: IntentionRow, now: Date): Date | null {
  if (!row.recurrence_rrule?.trim()) return null;
  return nextOccurrenceFrom(row, now);
}

/**
 * Re-synchronise les alarmes après écriture SQLite (toggle alarme, insert agent, etc.).
 * Lecture locale uniquement — aucune attente Cloud.
 */
export async function refreshRailAlarmsAfterLocalDbChange(): Promise<void> {
  const now = new Date();
  await syncRailAlarmsWithTimeline({ now });
}

/**
 * Replanifie les alarmes matérielles à partir **uniquement** de la table `intentions` (SQLite).
 * Les créneaux rail sont recalculés en mémoire sans calendrier externe ni état de sync Firebase.
 */
export async function syncRailAlarmsWithTimeline(args: { now: Date }): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const { listIntentionsDescending } = await import('../api/localDb');
  const { buildTimelineSlots } = await import('./agentLogic');
  const { now } = args;

  const pendingIntentions = (await listIntentionsDescending()).filter(
    (r) => r.status !== 'done',
  );
  if (pendingIntentions.length === 0) return;

  const slotById = new Map<string, TimelineSlot>();
  const spectrum = pendingIntentions[0]!.weights;
  const slots = buildTimelineSlots(pendingIntentions, spectrum, now, {
    busyIntervals: [],
  });
  for (const s of slots) {
    const prev = slotById.get(s.intention.id);
    if (!prev || s.startMinutes < prev.startMinutes) {
      slotById.set(s.intention.id, s);
    }
  }

  for (const row of pendingIntentions) {
    if (!row.alarm_enabled || row.is_micro_habit) {
      await cancelIntentionRailAlarm(row.id);
      continue;
    }

    if (row.recurrence_rrule?.trim()) {
      const when = computeNextRruleAlarmDate(row, now);
      if (!when) {
        await cancelIntentionRailAlarm(row.id);
        continue;
      }
      await scheduleIntentionRailAlarmAtDate(row, when, now);
      continue;
    }

    const slot = slotById.get(row.id);
    let startMinutes: number | undefined;
    if (row.fixed_start_minutes != null) {
      startMinutes = row.fixed_start_minutes;
    } else if (slot) {
      startMinutes = slot.startMinutes;
    } else {
      startMinutes = fallbackRailAlarmStartMinutes(now);
    }
    await scheduleIntentionRailAlarm(row, startMinutes, now);
  }
}

const lastRailAlarmHandledAt = new Map<string, number>();
const RAIL_ALARM_DEBOUNCE_MS = 2500;

/**
 * Réaction Agent / matériel : sonnerie ou interaction — avance RRULE dans SQLite
 * (`anchor_date_ymd`, `fixed_start_minutes`) puis reprogramme la prochaine occurrence native.
 */
export async function handleRailAlarmDelivered(intentionId: string): Promise<void> {
  const t = Date.now();
  const prev = lastRailAlarmHandledAt.get(intentionId) ?? 0;
  if (t - prev < RAIL_ALARM_DEBOUNCE_MS) return;
  lastRailAlarmHandledAt.set(intentionId, t);

  const { getIntentionById, advanceIntentionToNextRecurrenceSlot } = await import(
    '../api/localDb'
  );
  const row = await getIntentionById(intentionId);
  if (!row?.recurrence_rrule?.trim()) return;

  const advanced = await advanceIntentionToNextRecurrenceSlot(intentionId);
  if (!advanced) return;

  const fresh = await getIntentionById(intentionId);
  if (!fresh?.recurrence_rrule?.trim()) return;

  const now = new Date();
  const when = nextOccurrenceAfter(fresh, now);
  if (!when) return;
  await scheduleIntentionRailAlarmAtDate(fresh, when, now);
}

/**
 * Au cold start / après reboot : scan SQLite (intentions `pending` + alarme) puis replanification OS.
 */
export async function bootstrapNativeAlarmsOnAppStart(): Promise<void> {
  try {
    const { listIntentionsDescending } = await import('../api/localDb');
    const rows = await listIntentionsDescending();
    const count = rows.filter(
      (r) => r.status === 'pending' && r.alarm_enabled && !r.is_micro_habit,
    ).length;
    console.log(`[Hardware-Alarm] ${count} alarmes reprogrammées au démarrage`);
    await refreshRailAlarmsAfterLocalDbChange();
  } catch (e) {
    if (__DEV__) console.warn('[TellYouTo] bootstrapNativeAlarmsOnAppStart', e);
  }
}
