import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';

import type { BotChannel, GenericBotPayload } from './botTypes';
import { runMessengerWebhookCore } from './messengerWebhookCore';

export type { BotChannel, GenericBotPayload } from './botTypes';

/**
 * Extrait canal + identifiant messager + texte depuis le corps (générique ou Telegram).
 */
export function parseBotRequestBody(body: unknown): GenericBotPayload | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  if (typeof b.channel === 'string' && typeof b.messengerUserId === 'string') {
    const text = typeof b.text === 'string' ? b.text : '';
    if (!text.trim()) return null;
    const ch = b.channel as BotChannel;
    if (!['whatsapp', 'telegram', 'slack', 'line'].includes(ch)) return null;
    return {
      channel: ch,
      messengerUserId: b.messengerUserId,
      text: text.trim(),
      description: typeof b.description === 'string' ? b.description : undefined,
    };
  }

  const msg = b.message as Record<string, unknown> | undefined;
  if (msg && typeof msg.text === 'string' && msg.text.trim()) {
    const from = msg.from as Record<string, unknown> | undefined;
    const chat = msg.chat as Record<string, unknown> | undefined;
    const uid =
      (from && typeof from.id === 'number' && String(from.id)) ||
      (chat && typeof chat.id === 'number' && String(chat.id)) ||
      '';
    if (!uid) return null;
    return {
      channel: 'telegram',
      messengerUserId: uid,
      text: (msg.text as string).trim(),
    };
  }

  return null;
}

/**
 * Reçoit les messages des bots, résout l’appareil via `messengerBindings/{channel}_{id}`,
 * pousse une intention volatile dans `devices/{deviceId}/rail_inbox` (transit uniquement).
 * La liaison appareil repose sur `deviceId` issu du binding ; le texte n’est pas stocké
 * durablement côté Cloud une fois l’app ingérée (deleteDoc client + purge planifiée).
 *
 * Sécurité : définir `BOT_WEBHOOK_SECRET` et envoyer l’en-tête `x-webhook-secret`
 * (ou query `?secret=`) pour les tests ; pour Telegram natif, préférer `telegramWebhook`.
 */
export async function handleBotWebhook(
  firestore: Firestore,
  req: Request,
  res: Response,
): Promise<void> {
  if (req.method === 'GET') {
    res.status(200).send('TellYouTo bot webhook');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const configuredSecret = process.env.BOT_WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const header = req.get('x-webhook-secret');
    const q = req.query.secret;
    const querySecret = typeof q === 'string' ? q : Array.isArray(q) ? q[0] : '';
    if (header !== configuredSecret && querySecret !== configuredSecret) {
      res.status(401).send('Unauthorized');
      return;
    }
  }

  const parsed = parseBotRequestBody(req.body);
  if (!parsed) {
    res.status(400).json({ ok: false, error: 'invalid_payload' });
    return;
  }

  const result = await runMessengerWebhookCore(firestore, parsed);
  res.status(result.status).json(result.json);
}
