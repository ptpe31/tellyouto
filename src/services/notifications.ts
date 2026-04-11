import * as Notifications from 'expo-notifications';

import i18n from '../locales/i18n';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** Notification locale quand une intention arrive via connecteur externe (webhook simulé). */
export async function notifyExternalIntentionCaptured(
  intentionTitle: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t('notifications.externalIntentionTitle'),
      body: i18n.t('notifications.externalIntentionBody', {
        title: intentionTitle,
      }),
    },
    trigger: null,
  });
}
