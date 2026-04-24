import { Linking } from 'react-native';

import { Platform } from './rnPlatform';

/** App Store (iOS) — Telegram Messenger */
const TELEGRAM_IOS_APP_STORE =
  'https://apps.apple.com/app/telegram-messenger/id68221321';

const TELEGRAM_ANDROID_MARKET = 'market://details?id=org.telegram.messenger';
const TELEGRAM_ANDROID_WEB =
  'https://play.google.com/store/apps/details?id=org.telegram.messenger';

const TG_SCHEME = 'tg://';

/**
 * Ouvre la fiche Telegram sur le store (iOS App Store, Android Play / market:).
 */
export async function openTelegramStore(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openURL(TELEGRAM_IOS_APP_STORE);
    return;
  }
  if (Platform.OS === 'android') {
    try {
      const canMarket = await Linking.canOpenURL(TELEGRAM_ANDROID_MARKET);
      await Linking.openURL(canMarket ? TELEGRAM_ANDROID_MARKET : TELEGRAM_ANDROID_WEB);
    } catch {
      await Linking.openURL(TELEGRAM_ANDROID_WEB);
    }
    return;
  }
  await Linking.openURL('https://telegram.org/dl');
}

/** Indique si l’app Telegram est installée (schéma `tg://`). */
export async function canOpenTelegramNative(): Promise<boolean> {
  try {
    return await Linking.canOpenURL(TG_SCHEME);
  } catch {
    return false;
  }
}
