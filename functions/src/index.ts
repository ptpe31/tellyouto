import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

import { handleBotWebhook } from './webhookHandler';

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
