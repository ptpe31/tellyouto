import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';

import {
  formatBotPremiumChannelDenied,
  formatBotRailAck,
  formatBotRechargeAck,
  formatBotWelcomeConnect,
} from './botLocales';
import { buildDeepLink, sendBotReply } from './botReply';
import {
  extractHandshakeFirstName,
  isRailConnectionHandshake,
} from './railHandshake';
import type { GenericBotPayload } from './botTypes';

const DEFAULT_INTENTIONS_QUOTA = (() => {
  const n = parseInt(process.env.DEFAULT_INTENTIONS_QUOTA ?? '50', 10);
  return Number.isFinite(n) && n >= 0 ? n : 50;
})();

function bindingDocId(channel: string, messengerUserId: string): string {
  return `${channel}_${messengerUserId}`;
}

/** Pro surtout sur `users/{firebase_uid}` ; repli `devices.is_pro_user` pour anciens clients. */
async function resolveIsProUser(
  firestore: Firestore,
  deviceData: DocumentData,
): Promise<boolean> {
  const uid =
    typeof deviceData.firebase_uid === 'string' && deviceData.firebase_uid.trim()
      ? deviceData.firebase_uid.trim()
      : null;
  if (uid) {
    try {
      const userSnap = await firestore.collection('users').doc(uid).get();
      if (userSnap.exists && userSnap.data()?.is_pro_user === true) {
        return true;
      }
    } catch {
      /* indisponible ou règles */
    }
  }
  return deviceData.is_pro_user === true;
}

export type MessengerWebhookCoreResult = {
  status: number;
  json: Record<string, unknown>;
};

/**
 * Logique métier partagée (botWebhook HTTP générique + telegramWebhook natif).
 */
export async function runMessengerWebhookCore(
  firestore: Firestore,
  parsed: GenericBotPayload,
): Promise<MessengerWebhookCoreResult> {
  const bindRef = firestore
    .collection('messengerBindings')
    .doc(bindingDocId(parsed.channel, parsed.messengerUserId));
  const bindSnap = await bindRef.get();
  if (!bindSnap.exists) {
    return {
      status: 404,
      json: { ok: false, error: 'unknown_messenger_user' },
    };
  }

  const deviceId = bindSnap.data()?.deviceId;
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    return {
      status: 500,
      json: { ok: false, error: 'binding_invalid' },
    };
  }

  const deviceRef = firestore.collection('devices').doc(deviceId.trim());

  const deviceSnapPre = await deviceRef.get();
  const dPre = deviceSnapPre.data() ?? {};
  const isPro = await resolveIsProUser(firestore, dPre);
  const locPre =
    typeof dPre.locale === 'string' && dPre.locale.trim()
      ? dPre.locale.trim()
      : 'fr';
  const fnPre =
    typeof dPre.first_name === 'string' && dPre.first_name.trim()
      ? dPre.first_name.trim()
      : '';

  if (
    !isPro &&
    (parsed.channel === 'whatsapp' ||
      parsed.channel === 'slack' ||
      parsed.channel === 'line')
  ) {
    const msg = formatBotPremiumChannelDenied(locPre, fnPre);
    await sendBotReply(parsed.channel, parsed.messengerUserId, msg);
    const messengerMetaDenied = {
      last_messenger_channel: parsed.channel,
      last_messenger_user_id: parsed.messengerUserId,
      last_messenger_updated_at: Date.now(),
    };
    await deviceRef.set(messengerMetaDenied, { merge: true });
    return {
      status: 200,
      json: { ok: true, premium_channel_requires_pro: true },
    };
  }

  const messengerMeta = {
    last_messenger_channel: parsed.channel,
    last_messenger_user_id: parsed.messengerUserId,
    last_messenger_updated_at: Date.now(),
  };

  if (isRailConnectionHandshake(parsed.text)) {
    const deviceSnap = await deviceRef.get();
    const d = deviceSnap.data() ?? {};
    const loc =
      typeof d.locale === 'string' && d.locale.trim()
        ? d.locale.trim()
        : 'fr';
    const fromDevice =
      typeof d.first_name === 'string' ? d.first_name.trim() : '';
    const fromMsg = extractHandshakeFirstName(parsed.text);
    const firstName =
      fromDevice ||
      fromMsg ||
      (loc.split('-')[0]?.toLowerCase() === 'en' ? 'there' : 'toi');
    const radarUrl = buildDeepLink('radar', { from: 'whatsapp_init' });
    const timelineUrl = buildDeepLink('timeline', { from: 'whatsapp_init' });
    const welcome = formatBotWelcomeConnect(
      loc,
      firstName,
      radarUrl,
      timelineUrl,
    );
    await sendBotReply(parsed.channel, parsed.messengerUserId, welcome);
    await deviceRef.set(messengerMeta, { merge: true });
    return { status: 200, json: { ok: true, handshake: true } };
  }

  const docRef = deviceRef.collection('rail_inbox').doc();
  const now = Date.now();
  const ttlMs = now + 24 * 60 * 60 * 1000;

  const inboxPayload = {
    title: parsed.text.slice(0, 500),
    description: (parsed.description ?? '').slice(0, 2000),
    platform_type: parsed.channel,
    messenger_user_id: parsed.messengerUserId,
    created_at: now,
    transit_expires_at: ttlMs,
    /** Timestamp pour politique TTL Firestore (24h) — à activer dans la console GCP. */
    ttl_expires_at: Timestamp.fromMillis(ttlMs),
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

  if (outcome.kind === 'blocked') {
    const msg = formatBotRechargeAck(
      outcome.locale,
      buildDeepLink('recharge'),
    );
    await sendBotReply(parsed.channel, parsed.messengerUserId, msg);
    await deviceRef.set(messengerMeta, { merge: true });
    return {
      status: 200,
      json: {
        ok: true,
        inboxSkipped: true,
        reason: 'quota_exhausted',
      },
    };
  }

  const ack = formatBotRailAck(outcome.locale, buildDeepLink('radar'));
  await sendBotReply(parsed.channel, parsed.messengerUserId, ack);

  await deviceRef.set(messengerMeta, { merge: true });

  return { status: 200, json: { ok: true, inboxId: docRef.id } };
}
