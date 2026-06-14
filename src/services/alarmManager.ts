/**
 * Pont **SQLite → Expo Notifications** pour les alarmes « rail » sur l’appareil.
 *
 * **Pourquoi** : la sonnerie doit survivre **sans Firebase** ; le OS ne connaît que les
 * planifications locales. Ce module est la seule couche autorisée à poser / retirer des triggers
 * `DATE` stables pour les intentions.
 *
 * ---
 * ### Loi du système — ne jamais dériver de la vérité SQLite
 *
 * - Les alarmes natives pour les intentions **non récurrentes** utilisent **uniquement**
 *   `fixed_start_minutes` + `anchor_date_ymd` lus en base — **pas** un second calcul « rail » qui
 *   pourrait différer de ce que l’utilisateur a validé (sinon retour de la **dérive temporelle**).
 * - Si `is_flexible === true`, **aucune** alarme matérielle n’est planifiée : le créneau peut bouger ;
 *   programmer le OS ici casserait la promesse produit.
 * - Toute modification du flux **doit** garder la cohérence avec la persistance des champs d'alarme
 *   dans `talkndone.db` (révision croisée obligatoire).
 *
 * @module alarmManager
 */
import { Alert } from 'react-native';

import i18n from '../locales/i18n';
import { Platform } from '../utils/rnPlatform';

import {
  ensureNotificationPermissions,
  getNotifications,
} from './notifications';
import {
  bootstrapTrankilV2Database,
  getTrankilV2IntentionById,
  listTrankilV2PendingAlarmIntentions,
  trankilV2SqliteBarrier,
  updateTrankilV2IntentionAlarmFields,
  waitForTrankilV2SqliteIdle,
  type TrankilV2IntentionRow,
} from '../api/trankilV2Db';
import {
  androidNotificationChannelIdForSound,
  bundledSoundFilenameForPreference,
  type RailAlarmSoundId,
} from './railAlarmSound';

/** Identifiant stable par intention — annulation / remplacement sans ambiguïté. */
export function intentionRailAlarmNotificationId(intentionId: string): string {
  return `tellyouto_rail_alarm_${intentionId}`;
}

/** Canaux Android déjà enregistrés cette session (un canal par variante de son). */
const androidRailChannelsReady = new Set<string>();

/**
 * À appeler après changement de préférence sonore : le prochain schedule recréera le canal si besoin.
 */
export function invalidateRailAlarmChannelCache(): void {
  androidRailChannelsReady.clear();
}

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

type NotificationsModule = NonNullable<ReturnType<typeof getNotifications>>;

async function ensureAndroidAlarmChannelForSound(
  n: NotificationsModule,
  soundId: RailAlarmSoundId,
): Promise<string> {
  if (Platform.OS !== 'android') return '';
  const channelId = androidNotificationChannelIdForSound(soundId);
  if (androidRailChannelsReady.has(channelId)) return channelId;

  const filename = bundledSoundFilenameForPreference(soundId);
  await n.setNotificationChannelAsync(channelId, {
    name: i18n.t('agent.railChannelName', { soundId }),
    importance: n.AndroidImportance.MAX,
    vibrationPattern: [0, 450, 200, 450, 200, 450, 200, 600],
    ...(filename ? { sound: filename } : {}),
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
  androidRailChannelsReady.add(channelId);
  return channelId;
}

/**
 * Planifie une notification date/heure style rail (même canal alarme Android, son selon préférence utilisateur).
 *
 * Le fichier `.wav` est lu depuis SQLite (`getPreferredRailAlarmSoundId`) pour rester cohérent hors React.
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
  const soundId: RailAlarmSoundId = 'default';
  const filename = bundledSoundFilenameForPreference(soundId);

  let channelId = '';
  if (Platform.OS === 'android') {
    channelId = await ensureAndroidAlarmChannelForSound(n, soundId);
  }

  return n.scheduleNotificationAsync({
    identifier: args.identifier,
    content: {
      title: args.title,
      body: '',
      ...(filename ? { sound: filename } : {}),
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
      ...(Platform.OS === 'android' && channelId
        ? { channelId }
        : {}),
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
function intentionAlarmAnchorMidnight(row: TrankilV2IntentionRow, now: Date): Date {
  if (row.due_date) {
    const parts = row.due_date.split('-').map(Number);
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
  const row = await getTrankilV2IntentionById(intentionId);
  await cancelScheduledIdsForIntention(
    intentionId,
    row?.local_notification_id ?? undefined,
  );
  await updateTrankilV2IntentionAlarmFields(intentionId, {
    local_notification_id: null,
  });
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
    const rows = await listTrankilV2PendingAlarmIntentions(0);
    for (const row of rows) {
      await updateTrankilV2IntentionAlarmFields(row.id, { local_notification_id: null });
    }
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
        '[TalkNDone] expo-notifications indisponible (souvent Expo Go). Préférence alarme enregistrable ; planification native après dev build.',
      );
    }
    return true;
  }
  return ensureNotificationPermissions();
}

/** Identifiant stable — remplace une planification debug précédente sans toucher SQLite. */
const DEBUG_AGENT_DIRECT_NOTIFICATION_ID = 'tellyouto_debug_agent_direct_alarm';

/**
 * DEPRECATED — aucun écran Debug ne l’appelle. Voir `nettoyage-code-mort.md` §11.
 * Réactiver depuis l’historique git si besoin de test alarme native.
 */
export async function scheduleDebugAgentDirectAlarmIn10Minutes(): Promise<string> {
  throw new Error('DEPRECATED: scheduleDebugAgentDirectAlarmIn10Minutes — voir nettoyage-code-mort.md §11');
}

/* scheduleDebugAgentDirectAlarmIn10Minutes — implémentation d’origine conservée dans git */

async function persistScheduledId(intentionId: string, scheduledId: string): Promise<void> {
  await updateTrankilV2IntentionAlarmFields(intentionId, {
    local_notification_id: scheduledId,
  });
}

/**
 * Planifie une alarme à une date absolue (RRULE ou rail).
 * Annule toujours l’ancienne poignée (`local_notification_id` + id stable) avant création.
 * Pilotage 100 % local : permission vérifiée ici avant tout accès OS.
 */
async function scheduleIntentionRailAlarmAtDate(
  row: TrankilV2IntentionRow,
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

  const fresh = (await getTrankilV2IntentionById(row.id)) ?? row;
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
  row: TrankilV2IntentionRow,
  startMinutes: number,
  now: Date,
): Promise<void> {
  const dayStart = intentionAlarmAnchorMidnight(row, now);
  const when = dateAtLocalMinutes(dayStart, startMinutes);
  await scheduleIntentionRailAlarmAtDate(row, when, now);
}

function computeNextRruleAlarmDate(row: TrankilV2IntentionRow, now: Date): Date | null {
  const rrule = String(row.recurrence_rrule ?? '').toUpperCase();
  if (!rrule) return null;
  const baseMs = Number(row.remind_at ?? 0);
  const base = baseMs > 0 ? new Date(baseMs) : now;
  const next = new Date(base);
  if (rrule.includes('FREQ=WEEKLY')) {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() > now.getTime() ? next : null;
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
 * Replanifie les alarmes matérielles à partir **uniquement** des lignes `intentions` (SQLite).
 *
 * **Pourquoi** : après toute écriture locale, le OS doit refléter exactement la base — pas l’inverse.
 * Il n’y a **pas** de recalcul de « rail graphique » ici : on lit `fixed_start_minutes` / RRULE et on
 * pose les `DATE` notifications correspondantes.
 */
export async function syncRailAlarmsWithTimeline(args: { now: Date }): Promise<void> {
  return enqueueRailAlarmSync(async () => {
    await runSyncRailAlarmsWithTimeline(args);
  });
}

/**
 * Implémentation séquentielle (file d’attente) : une intention à la fois pour éviter les courses
 * SQLite sur Android (`finalizeAsync`).
 *
 * **Loi du système** : annulation systématique des flex + alarmes sans `fixed_start_minutes` ;
 * ancres fixes uniquement pour le matériel.
 */
async function runSyncRailAlarmsWithTimeline(args: { now: Date }): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const { now } = args;

  const pendingIntentions = await listTrankilV2PendingAlarmIntentions(now.getTime());
  if (pendingIntentions.length === 0) return;

  for (const row of pendingIntentions) {
    if (Number(row.alarm_enabled ?? 0) !== 1) {
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

    if (typeof row.remind_at === 'number' && row.remind_at > now.getTime()) {
      await scheduleIntentionRailAlarmAtDate(row, new Date(row.remind_at), now);
      continue;
    }

    if (!row.due_date) {
      await cancelIntentionRailAlarm(row.id);
      continue;
    }

    await scheduleIntentionRailAlarm(row, fallbackRailAlarmStartMinutes(now), now);
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

  const row = await getTrankilV2IntentionById(intentionId);
  if (!row?.recurrence_rrule?.trim()) return;
  const now = new Date();
  const when = computeNextRruleAlarmDate(row, now);
  if (!when) return;
  await updateTrankilV2IntentionAlarmFields(intentionId, { remind_at: when.getTime() });
  const fresh = await getTrankilV2IntentionById(intentionId);
  if (!fresh) return;
  await scheduleIntentionRailAlarmAtDate(fresh, when, now);
}

/**
 * Au cold start / après reboot : scan SQLite (intentions `pending` + alarme) puis replanification OS.
 */
export async function bootstrapNativeAlarmsOnAppStart(): Promise<void> {
  try {
    await bootstrapTrankilV2Database();
    await waitForTrankilV2SqliteIdle();
    await trankilV2SqliteBarrier(300);
    await refreshRailAlarmsAfterLocalDbChange();
    const rows = await listTrankilV2PendingAlarmIntentions(Date.now());
    const count = rows.filter(
      (r) => Number(r.alarm_enabled ?? 0) === 1,
    ).length;
    if (__DEV__) {
      console.log(
        `[Hardware-Alarm] ${count} alarme(s) alignée(s) après bootstrap`,
      );
    }
  } catch (e) {
    if (__DEV__) console.warn('[TalkNDone] bootstrapNativeAlarmsOnAppStart', e);
  }
}

function guessReminderDateMs(row: TrankilV2IntentionRow): number | null {
  if (typeof row.remind_at === 'number' && row.remind_at > Date.now() + 10_000) {
    return row.remind_at;
  }
  if (row.due_date && /^\d{4}-\d{2}-\d{2}$/.test(row.due_date)) {
    const [y, m, d] = row.due_date.split('-').map((v) => Number(v));
    return new Date(y, m - 1, d, 9, 0, 0, 0).getTime();
  }
  return null;
}

/** DEPRECATED — seul appelant : `postCaptureEffects` (§10). Voir `nettoyage-code-mort.md` §11. */
export async function scheduleTrankilV2IntentionAlarmById(
  _intentionId: string,
): Promise<{ ok: boolean; notificationId: string | null }> {
  void _intentionId;
  return { ok: false, notificationId: null };
}

/** DEPRECATED — seul appelant : `postCaptureEffects` (§10). */
export async function disableTrankilV2IntentionAlarmById(_intentionId: string): Promise<void> {
  void _intentionId;
}

/* scheduleTrankilV2IntentionAlarmById / disableTrankilV2IntentionAlarmById — voir git */
