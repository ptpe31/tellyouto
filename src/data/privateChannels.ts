import AsyncStorage from '@react-native-async-storage/async-storage';

export type PrivateChannelId = 'whatsapp' | 'telegram' | 'slack' | 'line';

/** Canaux réservés à l’abonnement Pro (Telegram reste gratuit). */
export function isPremiumPrivateChannel(id: PrivateChannelId): boolean {
  return id === 'whatsapp' || id === 'slack' || id === 'line';
}

export const PRIVATE_CHANNEL_CHOICE_KEY = '@tellyouto/private_channel_id';
export const PRIVATE_CHANNEL_BOT_URL_KEY = '@tellyouto/private_channel_bot_url';

/** Telegram en tête (recommandé) ; WhatsApp secondaire ; LINE / Slack pour pros. */
const CHANNEL_ORDER: PrivateChannelId[] = [
  'telegram',
  'whatsapp',
  'line',
  'slack',
];

/**
 * URLs des bots — variables `EXPO_PUBLIC_BOT_*_URL` (EAS / .env), sinon repli documentaire.
 */
export function resolvePrivateChannelBotUrl(id: PrivateChannelId): string {
  switch (id) {
    case 'whatsapp':
      return process.env.EXPO_PUBLIC_BOT_WHATSAPP_URL ?? '';
    case 'telegram':
      return process.env.EXPO_PUBLIC_BOT_TELEGRAM_URL ?? 'https://t.me/TellYouToBot';
    case 'slack':
      return process.env.EXPO_PUBLIC_BOT_SLACK_URL ?? '';
    case 'line':
      return process.env.EXPO_PUBLIC_BOT_LINE_URL ?? '';
    default:
      return '';
  }
}

export function listPrivateChannelIds(): PrivateChannelId[] {
  return CHANNEL_ORDER;
}

export async function savePrivateChannelChoice(
  id: PrivateChannelId,
  resolvedBotUrl?: string,
): Promise<void> {
  const url = resolvedBotUrl ?? resolvePrivateChannelBotUrl(id);
  await AsyncStorage.multiSet([
    [PRIVATE_CHANNEL_CHOICE_KEY, id],
    [PRIVATE_CHANNEL_BOT_URL_KEY, url],
  ]);
}

export async function getStoredPrivateChannelId(): Promise<PrivateChannelId | null> {
  const v = await AsyncStorage.getItem(PRIVATE_CHANNEL_CHOICE_KEY);
  if (
    v === 'whatsapp' ||
    v === 'telegram' ||
    v === 'slack' ||
    v === 'line'
  ) {
    return v;
  }
  return null;
}

export async function getStoredPrivateChannelBotUrl(): Promise<string> {
  return (await AsyncStorage.getItem(PRIVATE_CHANNEL_BOT_URL_KEY)) ?? '';
}
