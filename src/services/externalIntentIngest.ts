import { randomUUID } from 'expo-crypto';
import { DeviceEventEmitter } from 'react-native';

import type { PlatformConnector } from '../api/connectors';
import { insertIntention } from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import type { UserSpectrumState } from '../context/UserSpectrumContext';
import { estimateDurationMinutes } from './agentLogic';
import {
  ensureNotificationPermissions,
  notifyExternalIntentionCaptured,
} from './notifications';

/** Émis après insertion locale (Radar / Timeline peuvent recharger). */
export const INTENTIONS_CHANGED_EVENT = 'tellyouto/intentions_changed';

/**
 * Si un `platform_user_id` est défini dans le profil, l’expéditeur externe doit correspondre.
 * Sinon (chaîne vide / non lié), l’acceptation reste possible pour démo / premier lien.
 */
export function isExternalUserAllowed(
  externalUserId: string,
  spectrum: UserSpectrumState,
): boolean {
  const stored = spectrum.platform_user_id?.trim() ?? '';
  if (!stored) return true;
  return externalUserId.trim() === stored;
}

export type IngestResult =
  | { ok: true; intentionId: string }
  | { ok: false; error: 'user_id_mismatch' };

/**
 * Pipeline webhook simulé : vérif utilisateur → parse connecteur → SQLite → notification.
 */
export async function ingestExternalRawMessage(options: {
  raw: string;
  connector: PlatformConnector;
  externalUserId: string;
  spectrum: UserSpectrumState;
  notify?: boolean;
}): Promise<IngestResult> {
  const { raw, connector, externalUserId, spectrum, notify = true } = options;

  if (!isExternalUserAllowed(externalUserId, spectrum)) {
    return { ok: false, error: 'user_id_mismatch' };
  }

  const parsed = connector.parseMessageToIntention(raw, spectrum);
  const estimated_duration = estimateDurationMinutes(
    parsed.title,
    parsed.description,
    spectrum,
  );

  const id = randomUUID();
  await insertIntention({
    id,
    title: parsed.title,
    description: parsed.description,
    status: 'pending',
    priority: parsed.suggestedPriority,
    weights: {
      structure: spectrum.structure,
      momentum: spectrum.momentum,
      zen: spectrum.zen,
      stats: spectrum.stats,
    },
    platform_type: spectrum.platform_type,
    platform_user_id: spectrum.platform_user_id || externalUserId,
    created_at: Date.now(),
    estimated_duration,
  });

  if (notify) {
    const granted = await ensureNotificationPermissions();
    if (granted) {
      await notifyExternalIntentionCaptured(parsed.title);
    }
  }

  void syncPendingIntentions();
  DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
  return { ok: true, intentionId: id };
}
