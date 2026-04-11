const APP_SCHEME = 'tellyouto';

export function buildDeepLink(tab: 'radar' | 'timeline' | 'recharge'): string {
  return `${APP_SCHEME}://${tab}`;
}

export async function sendTelegramText(
  chatId: string,
  text: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn('botReply: TELEGRAM_BOT_TOKEN missing, skip Telegram send');
    return;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    console.warn('botReply: Telegram send failed', res.status, err);
  }
}
