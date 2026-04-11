import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { handleDisconnectMessenger } from './disconnectMessenger';
import { handleBotWebhook } from './webhookHandler';
import { handleTelegramWebhook } from './telegramWebhook';
import { purgeStaleTransitDocuments } from './purgeTransitData';
import { runProactiveReminders } from './scheduleProactiveReminders';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const botWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    await handleBotWebhook(db, req, res);
  },
);

/** Webhook natif Telegram Bot API (POST avec en-tête `X-Telegram-Bot-Api-Secret-Token`). */
export const telegramWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    await handleTelegramWebhook(db, req, res);
  },
);

/** Déconnexion messagerie (app → secret partagé optionnel). */
export const disconnectMessenger = onRequest(
  { cors: true, invoker: 'public' },
  async (req, res) => {
    await handleDisconnectMessenger(db, req, res);
  },
);

/** Rappels messagerie ~5 min avant créneau rail (montre / téléphone). */
export const scheduleProactiveReminders = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'UTC',
    memory: '256MiB',
  },
  async () => {
    await runProactiveReminders(db);
  },
);

/** Rétention zéro : efface les entrées de transit > 24h (file rail_inbox + copies sync). */
export const purgeStaleTransitData = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'UTC',
    memory: '512MiB',
  },
  async () => {
    await purgeStaleTransitDocuments(db);
  },
);

export {
  onDeviceIntentionTransitProcessed,
  onRailInboxMarkedProcessed,
} from './transitPurgeTriggers';
