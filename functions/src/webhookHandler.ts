import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';

import { formatBotRailAck, formatBotRechargeAck } from './botLocales';
import { buildDeepLink, sendTelegramText } from './botReply';

const DEFAULT_INTENTIONS_QUOTA = (() => {
  const n = parseInt(process.env.DEFAULT_INTENTIONS_QUOTA ?? '50', 10);
  return Number.isFinite(n) && n >= 0 ? n : 50;
})();

export type BotChannel = 'whatsapp' | 'telegram' | 'slack' | 'line';

export type GenericBotPayload = {
  channel: BotChannel;
  messengerUserId: string;
  text: string;
  description?: string;
};

function bindingDocId(channel: string, messengerUserId: string): string {
  return `${channel}_${messengerUserId}`;
}

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
 * pousse une intention dans `devices/{deviceId}/rail_inbox`.
 *
 * Sécurité : définir `BOT_WEBHOOK_SECRET` et envoyer l’en-tête `x-webhook-secret`
 * (ou query `?secret=`) pour les tests ; adapter par fournisseur (signature Telegram, etc.).
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

  const bindRef = firestore
    .collection('messengerBindings')
    .doc(bindingDocId(parsed.channel, parsed.messengerUserId));
  const bindSnap = await bindRef.get();
  if (!bindSnap.exists) {
    res.status(404).json({ ok: false, error: 'unknown_messenger_user' });
    return;
  }

  const deviceId = bindSnap.data()?.deviceId;
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    res.status(500).json({ ok: false, error: 'binding_invalid' });
    return;
  }

  const deviceRef = firestore.collection('devices').doc(deviceId.trim());
  const docRef = deviceRef.collection('rail_inbox').doc();

  const inboxPayload = {
    title: parsed.text.slice(0, 500),
    description: (parsed.description ?? '').slice(0, 2000),
    platform_type: parsed.channel,
    messenger_user_id: parsed.messengerUserId,
    created_at: Date.now(),
  };

  const outcome = await firestore.runTransaction(async (txn) => {
    const snap = await txn.get(deviceRef);
    const d = snap.data() ?? {};
    const loc =
      typeof d.locale === 'string' && d.locale.trim()
        ? d.locale.trim()
        : 'fr';
    const qRaw = d.intentions_quota;
    const q =
      typeof qRaw === 'number' && Number.isFinite(qRaw)
        ? Math.max(0, Math.floor(qRaw))
        : DEFAULT_INTENTIONS_QUOTA;
    if (q <= 0) {
      return { kind: 'blocked' as const, locale: loc };
    }
    txn.set(deviceRef, { intentions_quota: q - 1 }, { merge: true });
    txn.set(docRef, inboxPayload);
    return { kind: 'ok' as const, locale: loc };
  });

  const messengerMeta = {
    last_messenger_channel: parsed.channel,
    last_messenger_user_id: parsed.messengerUserId,
    last_messenger_updated_at: Date.now(),
  };

  if (outcome.kind === 'blocked') {
    const msg = formatBotRechargeAck(
      outcome.locale,
      buildDeepLink('recharge'),
    );
    if (parsed.channel === 'telegram') {
      await sendTelegramText(parsed.messengerUserId, msg);
    }
    await deviceRef.set(messengerMeta, { merge: true });
    res.status(200).json({
      ok: true,
      inboxSkipped: true,
      reason: 'quota_exhausted',
    });
    return;
  }

  const ack = formatBotRailAck(outcome.locale, buildDeepLink('radar'));
  if (parsed.channel === 'telegram') {
    await sendTelegramText(parsed.messengerUserId, ack);
  }

  await deviceRef.set(messengerMeta, { merge: true });

  res.status(200).json({ ok: true, inboxId: docRef.id });
}
