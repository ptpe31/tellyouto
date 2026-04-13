import AsyncStorage from '@react-native-async-storage/async-storage';

export type PrivateChannelId =
  | 'telegram'
  | 'whatsapp'
  | 'slack'
  | 'discord'
  | 'teams'
  | 'signal'
  | 'line';

/** Canaux réservés à l’abonnement Pro (Telegram reste gratuit). */
export function isPremiumPrivateChannel(id: PrivateChannelId): boolean {
  return id !== 'telegram';
}

export const PRIVATE_CHANNEL_CHOICE_KEY = '@tellyouto/private_channel_id';
export const PRIVATE_CHANNEL_BOT_URL_KEY = '@tellyouto/private_channel_bot_url';

/** Ordre catalogue : Telegram d’abord, puis intégrations Pro. */
const CHANNEL_ORDER: PrivateChannelId[] = [
  'telegram',
  'whatsapp',
  'slack',
  'discord',
  'teams',
  'signal',
  'line',
];

/**
 * URLs des bots — variables `EXPO_PUBLIC_BOT_*_URL` (EAS / .env), sinon repli documentaire.
 */
export function resolvePrivateChannelBotUrl(id: PrivateChannelId): string {
  switch (id) {
    case 'whatsapp':
      return process.env.EXPO_PUBLIC_BOT_WHATSAPP_URL ?? '';
    case 'telegram':
      return process.env.EXPO_PUBLIC_BOT_TELEGRAM_URL ?? 'https://t.me/TalkNDoneBot';
    case 'slack':
      return process.env.EXPO_PUBLIC_BOT_SLACK_URL ?? '';
    case 'line':
      return process.env.EXPO_PUBLIC_BOT_LINE_URL ?? '';
    case 'discord':
      return process.env.EXPO_PUBLIC_BOT_DISCORD_URL ?? '';
    case 'teams':
      return process.env.EXPO_PUBLIC_BOT_TEAMS_URL ?? '';
    case 'signal':
      return process.env.EXPO_PUBLIC_BOT_SIGNAL_URL ?? '';
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

const KNOWN_IDS: PrivateChannelId[] = [
  'whatsapp',
  'telegram',
  'slack',
  'discord',
  'teams',
  'signal',
  'line',
];

export async function getStoredPrivateChannelId(): Promise<PrivateChannelId | null> {
  const v = await AsyncStorage.getItem(PRIVATE_CHANNEL_CHOICE_KEY);
  if (v && (KNOWN_IDS as string[]).includes(v)) {
    return v as PrivateChannelId;
  }
  return null;
}

export async function getStoredPrivateChannelBotUrl(): Promise<string> {
  return (await AsyncStorage.getItem(PRIVATE_CHANNEL_BOT_URL_KEY)) ?? '';
}

/** Efface le choix de canal local (déconnexion ou bascule). */
export async function clearPrivateChannelChoice(): Promise<void> {
  await AsyncStorage.multiRemove([
    PRIVATE_CHANNEL_CHOICE_KEY,
    PRIVATE_CHANNEL_BOT_URL_KEY,
  ]);
}
