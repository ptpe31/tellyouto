import Constants from 'expo-constants';

import i18n from '../locales/i18n';

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
      const isRailAlarm =
        notification.request.content.data?.kind === 'rail_alarm';
      return {
        shouldShowAlert: true,
        shouldPlaySound: isRailAlarm,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    },
  });
}

/** Annule toutes les notifications planifiées locales (rail, rappels). */
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

/** Notification locale quand une intention arrive via connecteur externe (webhook simulé). */
export async function notifyExternalIntentionCaptured(
  intentionTitle: string,
): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  await n.scheduleNotificationAsync({
    content: {
      title: i18n.t('notifications.externalIntentionTitle'),
      body: i18n.t('notifications.externalIntentionBody', {
        title: intentionTitle,
      }),
    },
    trigger: null,
  });
}

