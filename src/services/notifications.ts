/**
 * Accès paresseux à **expo-notifications** : chargement conditionnel pour éviter les erreurs Expo Go.
 *
 * **Pourquoi** : les builds de prod ont besoin du module ; Expo Go ne l’expose pas complètement.
 * Les appelants doivent gérer `null` comme « pas de notifications ».
 *
 * @module notifications
 */
import Constants from 'expo-constants';

/* DEPRECATED notif helpers : i18n + getTrankilV2UserStats retirés tant que §6–§8 commentés */

/**
 * Dans Expo Go (SDK 53+), le module notifications est limité et log ERROR/WARN au chargement.
 * On ne l’importe donc pas en Expo Go — dev build / standalone : require() classique.
 */
const isExpoGo = Constants.appOwnership === 'expo';

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;

export function getNotifications(): NotificationsModule | null {
  if (isExpoGo) return null;
  if (notificationsModule !== undefined) return notificationsModule;
  try {
    notificationsModule = require('expo-notifications') as NotificationsModule;
  } catch {
    notificationsModule = null;
  }
  return notificationsModule;
}

const mod = getNotifications();
if (mod) {
  mod.setNotificationHandler({
    handleNotification: async (notification) => {
      const kind = notification.request.content.data?.kind;
      const isRailAlarm = kind === 'rail_alarm';
      const isDebugAgentDirect = kind === 'debug_agent_direct';
      const isDepartureSignalA = kind === 'departure_signal_a';
      return {
        shouldShowAlert: true,
        shouldPlaySound: isRailAlarm || isDebugAgentDirect || isDepartureSignalA,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    },
  });
}

/**
 * Annule **toutes** les notifications planifiées locales (`cancelAllScheduledNotificationsAsync`).
 *
 * **Pourquoi** : reset usine / purge — le système ne doit garder aucune sonnerie résiduelle.
 */
export async function cancelAllLocalScheduledNotifications(): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  try {
    await n.cancelAllScheduledNotificationsAsync();
  } catch {
    /* module indisponible */
  }
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  const n = getNotifications();
  if (!n) return false;
  const { status: existing } = await n.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await n.requestPermissionsAsync();
  return status === 'granted';
}

/** DEPRECATED — jamais branché. Voir `nettoyage-code-mort.md` §6. */
export async function notifyExternalIntentionCaptured(_intentionTitle: string): Promise<void> {
  void _intentionTitle;
}

/* notifyExternalIntentionCaptured — original :
export async function notifyExternalIntentionCaptured(intentionTitle: string): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  await n.scheduleNotificationAsync({
    content: {
      title: i18n.t('notifications.externalIntentionTitle'),
      body: i18n.t('notifications.externalIntentionBody', { title: intentionTitle }),
    },
    trigger: null,
  });
}
*/

/** DEPRECATED — `EveningStarModal` retiré de App.tsx. Voir `nettoyage-code-mort.md` §8. */
export async function notifyChargingEveningPrompt(_body: string): Promise<void> {
  void _body;
}

/* notifyChargingEveningPrompt — original :
export async function notifyChargingEveningPrompt(body: string): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  await n.scheduleNotificationAsync({ content: { title: 'Trankil', body }, trigger: null });
}
*/

