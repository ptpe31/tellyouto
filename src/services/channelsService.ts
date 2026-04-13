import { getDisconnectMessengerUrl } from '../config/cloudFunctions';
import { getOrCreateDeviceId } from '../api/syncService';
import type { PrivateChannelId } from '../data/privateChannels';

/**
 * Déconnexion serveur : message d’adieu via le bot, suppression du binding et des champs device.
 * URL : `EXPO_PUBLIC_DISCONNECT_MESSENGER_URL` ou repli `getDisconnectMessengerUrl()` (europe-west9).
 * Optionnel : `EXPO_PUBLIC_BOT_WEBHOOK_SECRET` (en-tête `x-webhook-secret`).
 */
export async function disconnectChannelRemote(
  channelId: PrivateChannelId,
): Promise<boolean> {
  const base = getDisconnectMessengerUrl();
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
    if (__DEV__) {
      console.warn('channelsService: disconnect request failed', e);
    }
    return false;
  }
}
