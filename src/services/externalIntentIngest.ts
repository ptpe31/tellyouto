import { randomUUID } from 'expo-crypto';
import { DeviceEventEmitter } from 'react-native';

import type { PlatformConnector } from '../api/connectors';
import {
  ensureRoutineIntentionInstancesForHorizon,
  insertIntention,
  insertRoutine,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import type { UserSpectrumState } from '../context/UserSpectrumContext';
import {
  analyzeNewIntentionSemantics,
  estimateDurationMinutes,
  inferStructuralRoutinePlan,
} from './agentLogic';
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
  const now = new Date();
  const estimated_duration = estimateDurationMinutes(
    parsed.title,
    parsed.description,
    spectrum,
  );
  const { priority, isMicroHabit, isLateNight, isHardConstraint } =
    analyzeNewIntentionSemantics(
      parsed.title,
      parsed.description,
      spectrum,
      now,
    );

  const uid = spectrum.platform_user_id || externalUserId;
  const id = randomUUID();
  const energyScore = Math.min(1, Math.max(0, priority / 100));

  if (isHardConstraint) {
    const plan = inferStructuralRoutinePlan(
      parsed.title,
      parsed.description,
      spectrum,
      now,
    );
    if (plan) {
      await insertRoutine({
        id,
        title: parsed.title,
        description: parsed.description,
        weekday: plan.weekday,
        start_minutes: plan.startMinutes,
        duration_min: plan.durationMin,
        weights: {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        },
        priority,
        platform_type: spectrum.platform_type,
        platform_user_id: uid,
        created_at: Date.now(),
      });
      await ensureRoutineIntentionInstancesForHorizon(id, uid);
    } else {
      await insertIntention({
        id,
        title: parsed.title,
        description: parsed.description,
        status: 'pending',
        priority,
        weights: {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        },
        platform_type: spectrum.platform_type,
        platform_user_id: uid,
        created_at: Date.now(),
        estimated_duration,
        user_forced_urgent: false,
        is_late_night: isLateNight,
        alarm_enabled: false,
        is_micro_habit: isMicroHabit,
        is_hard_constraint: false,
        raw_transcript: raw,
        energy_score: energyScore,
      });
    }
  } else {
    await insertIntention({
      id,
      title: parsed.title,
      description: parsed.description,
      status: 'pending',
      priority,
      weights: {
        structure: spectrum.structure,
        momentum: spectrum.momentum,
        zen: spectrum.zen,
        stats: spectrum.stats,
      },
      platform_type: spectrum.platform_type,
      platform_user_id: uid,
      created_at: Date.now(),
      estimated_duration,
      user_forced_urgent: false,
      is_late_night: isLateNight,
      alarm_enabled: false,
      is_micro_habit: isMicroHabit,
      is_hard_constraint: false,
      raw_transcript: raw,
      energy_score: energyScore,
    });
  }

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
