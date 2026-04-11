const APP_SCHEME = 'tellyouto';

export type DeepLinkTab = 'radar' | 'timeline' | 'recharge';

export type BotOutboundChannel =
  | 'whatsapp'
  | 'telegram'
  | 'slack'
  | 'line';

/** Lien profond avec paramètres (ex. `?from=whatsapp_init` pour la célébration dans l’app). */
export function buildDeepLink(
  tab: DeepLinkTab,
  query?: Record<string, string>,
): string {
  let url = `${APP_SCHEME}://${tab}`;
  if (query && Object.keys(query).length > 0) {
    const qs = new URLSearchParams(query).toString();
    url += `?${qs}`;
  }
  return url;
}

export type TelegramSendOptions = {
  /** true = pas de vibration / notification (ne pas utiliser pour les rappels rail). */
  disableNotification?: boolean;
};

export async function sendTelegramText(
  chatId: string,
  text: string,
  options?: TelegramSendOptions,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.error('Erreur : Token Telegram manquant');
    return;
  }
  const disableNotification = options?.disableNotification === true;
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
        disable_notification: disableNotification,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    console.warn('botReply: Telegram send failed', res.status, err);
  }
}

export async function sendWhatsAppText(
  to: string,
  text: string,
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !token) {
    console.warn(
      'botReply: WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN missing, skip WhatsApp send',
    );
    return;
  }
  const digits = to.replace(/\D/g, '');
  if (!digits) {
    console.warn('botReply: empty WhatsApp recipient, skip');
    return;
  }
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: digits,
        type: 'text',
        text: { body: text },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    console.warn('botReply: WhatsApp send failed', res.status, err);
  }
}

export async function sendBotReply(
  channel: BotOutboundChannel,
  messengerUserId: string,
  text: string,
): Promise<void> {
  if (channel === 'telegram') {
    await sendTelegramText(messengerUserId, text);
    return;
  }
  if (channel === 'whatsapp') {
    await sendWhatsAppText(messengerUserId, text);
    return;
  }
  console.warn(
    `botReply: no sender for channel ${channel}, message not delivered`,
  );
}
