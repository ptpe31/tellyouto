import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';

import type { GenericBotPayload } from './botTypes';
import { formatBotWelcomeConnect } from './botLocales';
import { buildDeepLink, sendBotReply } from './botReply';
import { runMessengerWebhookCore } from './messengerWebhookCore';

/** En-tête envoyé par les serveurs Telegram si `secret_token` a été défini dans setWebhook. */
const TG_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** `TELEGRAM_BOT_TOKEN` est obligatoire (configurer dans la console Firebase / secrets). */
function requireTelegramEnv(): { token: string; botName: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.error('Erreur : Token Telegram manquant');
    return null;
  }
  const botName =
    process.env.TELEGRAM_BOT_NAME?.trim() || 'TellYouToBot';
  return { token, botName };
}

/**
 * Vérifie le jeton secret : seuls les appels qui incluent le même `secret_token`
 * que celui enregistré via setWebhook sont acceptés (Telegram ajoute cet en-tête).
 * @see https://core.telegram.org/bots/api#setwebhook
 */
function verifyTelegramSecret(req: Request): boolean {
  if (process.env.ALLOW_INSECURE_TELEGRAM_WEBHOOK === '1') {
    console.warn(
      'telegramWebhook: ALLOW_INSECURE_TELEGRAM_WEBHOOK=1 — à usage local uniquement',
    );
    return true;
  }
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) {
    console.warn(
      'telegramWebhook: TELEGRAM_WEBHOOK_SECRET absent — refuse les POST (utilisez setWebhook avec secret_token)',
    );
    return false;
  }
  const got = req.get(TG_SECRET_HEADER)?.trim();
  return got === expected;
}

type TgUser = { id?: number; is_bot?: boolean };
type TgChat = { id?: number; type?: string };
type TgVoice = { file_id?: string; duration?: number };

type TgMessage = {
  message_id?: number;
  from?: TgUser;
  chat?: TgChat;
  text?: string;
  voice?: TgVoice;
  caption?: string;
};

function extractFromUpdate(body: unknown): {
  message?: TgMessage;
} | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const message = (b.message ?? b.edited_message ?? b.channel_post) as
    | TgMessage
    | undefined;
  return message ? { message } : null;
}

function telegramMessageToPayload(
  msg: TgMessage,
): { payload: GenericBotPayload; chatId: string } | null {
  const from = msg.from;
  if (!from || typeof from.id !== 'number') return null;
  const messengerUserId = String(from.id);
  const chatId =
    typeof msg.chat?.id === 'number' ? String(msg.chat.id) : messengerUserId;

  if (typeof msg.text === 'string' && msg.text.trim()) {
    return {
      chatId,
      payload: {
        channel: 'telegram',
        messengerUserId,
        text: msg.text.trim(),
      },
    };
  }
  if (msg.voice && msg.voice.file_id) {
    return {
      chatId,
      payload: {
        channel: 'telegram',
        messengerUserId,
        text: '[voice]',
        description: `voice_file_id:${msg.voice.file_id}`,
      },
    };
  }
  if (typeof msg.caption === 'string' && msg.caption.trim()) {
    return {
      chatId,
      payload: {
        channel: 'telegram',
        messengerUserId,
        text: msg.caption.trim(),
      },
    };
  }
  return null;
}

/**
 * `/start` avec paramètre deep-link = userId (deviceId côté app — liaison Firebase).
 */
async function handleStartWithPayload(
  firestore: Firestore,
  messengerUserId: string,
  userId: string,
  telegramChatId: string,
): Promise<void> {
  const uid = userId.trim();

  await firestore
    .collection('users')
    .doc(uid)
    .set(
      {
        telegramChatId,
        telegram_user_id: messengerUserId,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  const bindRef = firestore
    .collection('messengerBindings')
    .doc(`telegram_${messengerUserId}`);
  await bindRef.set(
    {
      deviceId: uid,
      channel: 'telegram',
      updated_at: Date.now(),
    },
    { merge: true },
  );

  const deviceRef = firestore.collection('devices').doc(uid);
  const messengerMeta = {
    last_messenger_channel: 'telegram',
    last_messenger_user_id: messengerUserId,
    last_messenger_updated_at: Date.now(),
  };
  await deviceRef.set(messengerMeta, { merge: true });

  const deviceSnap = await deviceRef.get();
  const d = deviceSnap.data() ?? {};
  const loc =
    typeof d.locale === 'string' && d.locale.trim()
      ? d.locale.trim()
      : 'fr';
  const fromDevice =
    typeof d.first_name === 'string' ? d.first_name.trim() : '';
  const firstName =
    fromDevice || (loc.split('-')[0]?.toLowerCase() === 'en' ? 'there' : 'toi');
  const radarUrl = buildDeepLink('radar', { from: 'telegram_start' });
  const timelineUrl = buildDeepLink('timeline', { from: 'telegram_start' });
  const welcome = formatBotWelcomeConnect(
    loc,
    firstName,
    radarUrl,
    timelineUrl,
  );
  await sendBotReply('telegram', messengerUserId, welcome);
}

export async function handleTelegramWebhook(
  firestore: Firestore,
  req: Request,
  res: Response,
): Promise<void> {
  if (req.method === 'GET') {
    res.status(200).type('text/plain').send('TellYouTo telegramWebhook');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const env = requireTelegramEnv();
  if (!env) {
    res.status(503).json({ ok: false, error: 'telegram_not_configured' });
    return;
  }

  if (!verifyTelegramSecret(req)) {
    res.status(401).send('Unauthorized');
    return;
  }

  console.log(
    'telegramWebhook brut reçu (Telegram Update):',
    JSON.stringify(req.body),
  );

  const extracted = extractFromUpdate(req.body);
  const msg = extracted?.message;
  if (!msg) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const from = msg.from;
  if (!from || typeof from.id !== 'number' || from.is_bot) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const messengerUserId = String(from.id);
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';

  const telegramChatId =
    typeof msg.chat?.id === 'number' ? String(msg.chat.id) : messengerUserId;

  const startMatch = text.match(/^\/start(?:\s+(\S+))?/);
  if (startMatch) {
    const payload = startMatch[1]?.trim();
    if (payload) {
      try {
        await handleStartWithPayload(
          firestore,
          messengerUserId,
          payload,
          telegramChatId,
        );
      } catch (e) {
        console.error('telegramWebhook: handleStartWithPayload', e);
      }
      res.status(200).json({ ok: true, start: true });
      return;
    }
    await sendBotReply(
      'telegram',
      messengerUserId,
      'Bienvenue ! Ouvre TellYouTo et appuie sur le canal Telegram pour recevoir ton lien de liaison.',
    );
    res.status(200).json({ ok: true, start_empty: true });
    return;
  }

  const parsed = telegramMessageToPayload(msg);
  if (!parsed) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const result = await runMessengerWebhookCore(firestore, parsed.payload);
  /** Toujours 200 pour Telegram (évite les retries agressifs) ; le détail reste dans `json`. */
  const body =
    result.status >= 400
      ? { ok: false, relay: result.json, relayStatus: result.status }
      : result.json;
  res.status(200).json(body);
}
