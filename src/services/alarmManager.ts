import { Alert } from 'react-native';

import i18n from '../locales/i18n';
import { Platform } from '../utils/rnPlatform';

import {
  ensureNotificationPermissions,
  getNotifications,
} from './notifications';
import type { IntentionRow } from '../api/localDb';
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

type NotificationsModule = NonNullable<ReturnType<typeof getNotifications>>;

/**
 * Payload unique pour alarmes rail et debug hardware : même `channelId`, son, priorité Android,
 * interruption iOS — seul `identifier` / `title` / `data` / `when` varient.
 */
async function scheduleRailStyleDateNotification(
  n: NotificationsModule,
  args: {
    identifier: string;
    title: string;
    when: Date;
    data: Record<string, unknown>;
  },
): Promise<string> {
  await ensureAndroidAlarmChannel();
  return n.scheduleNotificationAsync({
    identifier: args.identifier,
    content: {
      title: args.title,
      body: '',
      sound: RAIL_ALARM_SOUND_FILE,
      data: args.data,
      ...(Platform.OS === 'ios'
        ? {
            interruptionLevel: 'timeSensitive' as const,
          }
        : { priority: n.AndroidNotificationPriority.MAX }),
    },
    trigger: {
      type: n.SchedulableTriggerInputTypes.DATE,
      date: args.when,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_ALARM_CHANNEL } : {}),
    },
  });
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

/** Identifiant stable — remplace une planification debug précédente sans toucher SQLite. */
const DEBUG_AGENT_DIRECT_NOTIFICATION_ID = 'tellyouto_debug_agent_direct_alarm';

/**
 * Écran Debug uniquement : planifie une notification native dans 10 minutes (même canal /
 * priorité que les alarmes rail), sans lecture ni écriture SQLite.
 */
export async function scheduleDebugAgentDirectAlarmIn10Minutes(): Promise<string> {
  const n = getNotifications();
  if (!n) {
    throw new Error(
      'expo-notifications indisponible (Expo Go ou module absent — utiliser un dev build).',
    );
  }
  const permitted = await requestAlarmPermissionIfNeeded();
  if (!permitted) {
    throw new Error(
      'Permission notifications refusée ou non accordée (réglages système).',
    );
  }
  const now = new Date();
  const when = new Date(now.getTime() + 10 * 60 * 1000);
  if (when.getTime() <= now.getTime() + 10_000) {
    throw new Error('Date de déclenchement trop proche.');
  }
  try {
    await n.cancelScheduledNotificationAsync(DEBUG_AGENT_DIRECT_NOTIFICATION_ID);
  } catch {
    /* aucune planification précédente */
  }
  const scheduledId = await scheduleRailStyleDateNotification(n, {
    identifier: DEBUG_AGENT_DIRECT_NOTIFICATION_ID,
    title: '🚨 TEST AGENT DIRECT',
    when,
    data: { kind: 'debug_agent_direct' },
  });
  console.log(
    '[Debug-Agent] Ordre de planification envoyé pour dans 10 minutes.',
  );
  return scheduledId;
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

  const identifier = intentionRailAlarmNotificationId(row.id);
  const scheduledId = await scheduleRailStyleDateNotification(n, {
    identifier,
    title: row.title,
    when,
    data: {
      kind: 'rail_alarm',
      intentionId: row.id,
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
 * Une seule resync rail à la fois (bootstrap, Timeline, écritures SQLite). Sinon plusieurs
 * `syncRailAlarmsWithTimeline` entrelacés peuvent faire échouer expo-sqlite sur Android
 * (`NativeStatement.finalizeAsync` rejeté).
 */
let railSyncTail: Promise<void> = Promise.resolve();

function enqueueRailAlarmSync(run: () => Promise<void>): Promise<void> {
  const next = railSyncTail.then(run, run);
  railSyncTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Re-synchronise les alarmes après écriture SQLite (toggle alarme, insert agent, etc.).
 * Lecture locale uniquement — aucune attente Cloud.
 */
export async function refreshRailAlarmsAfterLocalDbChange(): Promise<void> {
  return enqueueRailAlarmSync(async () => {
    await runSyncRailAlarmsWithTimeline({ now: new Date() });
  });
}

/**
 * Replanifie les alarmes matérielles à partir **uniquement** de la table `intentions` (SQLite).
 * Les créneaux rail sont recalculés en mémoire sans calendrier externe ni état de sync Firebase.
 */
export async function syncRailAlarmsWithTimeline(args: { now: Date }): Promise<void> {
  return enqueueRailAlarmSync(async () => {
    await runSyncRailAlarmsWithTimeline(args);
  });
}

async function runSyncRailAlarmsWithTimeline(args: { now: Date }): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const { listIntentionsDescending } = await import('../api/localDb');
  const { now } = args;

  const pendingIntentions = (await listIntentionsDescending()).filter(
    (r) => r.status !== 'done',
  );
  if (pendingIntentions.length === 0) return;

  for (const row of pendingIntentions) {
    if (!row.alarm_enabled) {
      await cancelIntentionRailAlarm(row.id);
      continue;
    }

    /** Alarme native uniquement pour ancres fixes (pas de créneau flexible). */
    if (row.is_flexible) {
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

    if (row.fixed_start_minutes == null) {
      await cancelIntentionRailAlarm(row.id);
      continue;
    }

    await scheduleIntentionRailAlarm(row, row.fixed_start_minutes, now);
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
    await refreshRailAlarmsAfterLocalDbChange();
    const { listIntentionsDescending } = await import('../api/localDb');
    const rows = await listIntentionsDescending();
    const count = rows.filter(
      (r) => r.status === 'pending' && r.alarm_enabled,
    ).length;
    console.log(`[Hardware-Alarm] ${count} alarme(s) alignée(s) après bootstrap`);
  } catch (e) {
    if (__DEV__) console.warn('[TellYouTo] bootstrapNativeAlarmsOnAppStart', e);
  }
}
