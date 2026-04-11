import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';

import { formatBotDisconnect } from './botLocales';
import { sendBotReply, type BotOutboundChannel } from './botReply';

function isBotOutboundChannel(ch: string): ch is BotOutboundChannel {
  return (
    ch === 'whatsapp' ||
    ch === 'telegram' ||
    ch === 'slack' ||
    ch === 'line'
  );
}

/**
 * Déconnecte le canal messager : envoi du message d’adieu, suppression du binding,
 * effacement des champs `last_messenger_*` sur `devices/{deviceId}`.
 */
export async function handleDisconnectMessenger(
  firestore: Firestore,
  req: Request,
  res: Response,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const configuredSecret = process.env.BOT_WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const header = req.get('x-webhook-secret');
    if (header !== configuredSecret) {
      res.status(401).send('Unauthorized');
      return;
    }
  }

  const body = req.body as { deviceId?: string; channelId?: string };
  const deviceId =
    typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  const channelId =
    typeof body?.channelId === 'string' ? body.channelId.trim() : '';
  if (!deviceId || !channelId) {
    res.status(400).json({ ok: false, error: 'missing_params' });
    return;
  }

  const deviceRef = firestore.collection('devices').doc(deviceId);
  const snap = await deviceRef.get();
  if (!snap.exists) {
    res.status(404).json({ ok: false, error: 'unknown_device' });
    return;
  }

  const d = snap.data() ?? {};
  const ch =
    typeof d.last_messenger_channel === 'string'
      ? d.last_messenger_channel.trim()
      : '';
  const uid =
    typeof d.last_messenger_user_id === 'string'
      ? d.last_messenger_user_id.trim()
      : '';

  if (ch !== channelId || !uid) {
    res.status(400).json({ ok: false, error: 'channel_mismatch_or_unlinked' });
    return;
  }

  const loc =
    typeof d.locale === 'string' && d.locale.trim() ? d.locale.trim() : 'fr';
  const farewell = formatBotDisconnect(loc);

  if (isBotOutboundChannel(ch)) {
    await sendBotReply(ch, uid, farewell);
  }

  await firestore
    .collection('messengerBindings')
    .doc(`${ch}_${uid}`)
    .delete()
    .catch(() => undefined);

  await deviceRef.update({
    last_messenger_channel: FieldValue.delete(),
    last_messenger_user_id: FieldValue.delete(),
    last_messenger_updated_at: FieldValue.delete(),
  });

  res.json({ ok: true });
}
