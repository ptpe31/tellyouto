import { getOrCreateDeviceId } from '../api/syncService';
import type { PrivateChannelId } from '../data/privateChannels';

/**
 * Déconnexion serveur : message d’adieu via le bot, suppression du binding et des champs device.
 * Nécessite `EXPO_PUBLIC_DISCONNECT_MESSENGER_URL` (URL HTTPS de la Cloud Function) et
 * optionnellement le même secret que `BOT_WEBHOOK_SECRET` côté Functions, exposé en
 * `EXPO_PUBLIC_BOT_WEBHOOK_SECRET` pour l’en-tête `x-webhook-secret`.
 */
export async function disconnectChannelRemote(
  channelId: PrivateChannelId,
): Promise<boolean> {
  const base = process.env.EXPO_PUBLIC_DISCONNECT_MESSENGER_URL?.trim();
  if (!base) {
    console.warn(
      'channelsService: EXPO_PUBLIC_DISCONNECT_MESSENGER_URL is not set',
    );
    return false;
  }
  const deviceId = await getOrCreateDeviceId();
  const secret = process.env.EXPO_PUBLIC_BOT_WEBHOOK_SECRET?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['x-webhook-secret'] = secret;
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId, channelId }),
    });
    return res.ok;
  } catch (e) {
    console.warn('channelsService: disconnect request failed', e);
    return false;
  }
}
