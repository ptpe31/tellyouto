import * as admin from 'firebase-admin';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { handleDisconnectMessenger } from './disconnectMessenger';
import { handleBotWebhook } from './webhookHandler';
import { handleTelegramWebhook } from './telegramWebhook';
import { purgeStaleTransitDocuments } from './purgeTransitData';
import { runProactiveReminders } from './scheduleProactiveReminders';

/** Région Gen2 imposée (Paris / europe-west9) — alignée sur Firestore Western Europe. */
const REGION = 'europe-west9' as const;

setGlobalOptions({ region: REGION });

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * HTTPS Gen2 : `region` + `invoker: 'public'` pour déclencheurs HTTP explicites (évite « Déclencheur inconnu »).
 */
const publicHttpFn = {
  region: REGION,
  invoker: 'public' as const,
  cors: false,
  memory: '256MiB' as const,
  timeoutSeconds: 60,
};

export const botWebhook = onRequest(publicHttpFn, async (req, res) => {
  await handleBotWebhook(db, req, res);
});

export const telegramWebhook = onRequest(publicHttpFn, async (req, res) => {
  await handleTelegramWebhook(db, req, res);
});

export const disconnectMessenger = onRequest(
  {
    region: REGION,
    invoker: 'public' as const,
    cors: true,
    memory: '256MiB' as const,
    timeoutSeconds: 60,
  },
  async (req, res) => {
    await handleDisconnectMessenger(db, req, res);
  },
);

export const scheduleProactiveReminders = onSchedule(
  {
    region: REGION,
    schedule: 'every 1 minutes',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    await runProactiveReminders(db);
  },
);

export const purgeStaleTransitData = onSchedule(
  {
    region: REGION,
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

export const helloWorld = onRequest(
  {
    region: REGION,
    invoker: 'public' as const,
    cors: true,
    memory: '256MiB' as const,
    timeoutSeconds: 60,
  },
  async (_req, res) => {
    res.status(200).send('ok');
  },
);
