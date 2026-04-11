#!/usr/bin/env node
/**
 * Enregistre l’URL HTTPS de la Cloud Function `telegramWebhook` auprès de Telegram.
 *
 * Prérequis (variables d’environnement ou fichier .env chargé manuellement) :
 *   TELEGRAM_BOT_TOKEN       — jeton du bot (@BotFather)
 *   TELEGRAM_WEBHOOK_SECRET  — même valeur que côté Functions (en-tête secret Telegram)
 *   TELEGRAM_WEBHOOK_URL     — URL complète (Gen2, région europe-west9), ex.
 *     https://europe-west9-tellmeto-4f3c7.cloudfunctions.net/telegramWebhook
 *
 * Usage :
 *   cd functions && TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... TELEGRAM_WEBHOOK_URL=... node scripts/setTelegramWebhook.mjs
 *
 * @see https://core.telegram.org/bots/api#setwebhook
 */

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const url = process.env.TELEGRAM_WEBHOOK_URL?.trim();

if (!token) {
  console.error('Erreur : Token Telegram manquant (TELEGRAM_BOT_TOKEN)');
  process.exit(1);
}
if (!secret) {
  console.error(
    'Erreur : définir TELEGRAM_WEBHOOK_SECRET (identique à la variable des Functions)',
  );
  process.exit(1);
}
if (!url) {
  console.error('Erreur : définir TELEGRAM_WEBHOOK_URL (URL HTTPS de telegramWebhook)');
  process.exit(1);
}

const api = `https://api.telegram.org/bot${token}/setWebhook`;

const body = {
  url,
  secret_token: secret,
  allowed_updates: ['message', 'edited_message'],
};

const res = await fetch(api, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || !json.ok) {
  console.error('setWebhook a échoué', res.status, json);
  process.exit(1);
}

console.log('setWebhook OK :', json.description ?? json);
