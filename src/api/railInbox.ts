import { randomUUID } from 'expo-crypto';
import { DeviceEventEmitter } from 'react-native';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import type { UserSpectrumState } from '../context/UserSpectrumContext';
import {
  analyzeNewIntentionSemantics,
  estimateDurationMinutes,
  inferStructuralRoutinePlan,
} from '../services/agentLogic';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';

import { getFirestoreDb } from './firebase';
import {
  ensureRoutineIntentionInstancesForHorizon,
  insertIntention,
  insertRoutine,
} from './localDb';
import { getOrCreateDeviceId, syncPendingIntentions } from './syncService';

type RailInboxPayload = {
  title?: string;
  description?: string;
  platform_type?: string;
  messenger_user_id?: string;
  created_at?: number;
};

/**
 * Intentions poussées par le webhook (bots) — consommées puis doc supprimé.
 * Aucune donnée calendrier : uniquement titre/description issues du message bot.
 */
export function subscribeRailInbox(getSpectrum: () => UserSpectrumState): () => void {
  const db = getFirestoreDb();
  if (!db) return () => {};

  let colUnsub: Unsubscribe | null = null;

  void (async () => {
    const deviceId = await getOrCreateDeviceId();
    const col = collection(db, 'devices', deviceId, 'rail_inbox');
    colUnsub = onSnapshot(
      col,
      async (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue;
          const c = change.doc;
          const d = c.data() as RailInboxPayload;
          const spectrum = getSpectrum();
          const title = (d.title ?? '').trim() || 'Intention';
          const description = d.description ?? '';
          const now = new Date();
          const estimated_duration = estimateDurationMinutes(
            title,
            description,
            spectrum,
          );
          const { priority, isMicroHabit, isLateNight, isHardConstraint } =
            analyzeNewIntentionSemantics(title, description, spectrum, now);
          const is_late_night = isLateNight;
          const uid =
            spectrum.platform_user_id?.trim() ||
            (d.messenger_user_id ?? '').trim() ||
            '';
          const id = randomUUID();

          try {
            if (isHardConstraint) {
              const plan = inferStructuralRoutinePlan(
                title,
                description,
                spectrum,
                now,
              );
              if (plan) {
                await insertRoutine({
                  id,
                  title,
                  description,
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
                  platform_type: d.platform_type ?? 'bot',
                  platform_user_id: uid,
                  created_at:
                    typeof d.created_at === 'number' ? d.created_at : Date.now(),
                });
                await ensureRoutineIntentionInstancesForHorizon(id, uid);
              } else {
                await insertIntention({
                  id,
                  title,
                  description,
                  status: 'pending',
                  priority,
                  weights: {
                    structure: spectrum.structure,
                    momentum: spectrum.momentum,
                    zen: spectrum.zen,
                    stats: spectrum.stats,
                  },
                  platform_type: d.platform_type ?? 'bot',
                  platform_user_id: uid,
                  created_at:
                    typeof d.created_at === 'number' ? d.created_at : Date.now(),
                  estimated_duration,
                  user_forced_urgent: false,
                  is_late_night,
                  alarm_enabled: false,
                  is_micro_habit: isMicroHabit,
                  is_hard_constraint: false,
                });
              }
            } else {
              await insertIntention({
                id,
                title,
                description,
                status: 'pending',
                priority,
                weights: {
                  structure: spectrum.structure,
                  momentum: spectrum.momentum,
                  zen: spectrum.zen,
                  stats: spectrum.stats,
                },
                platform_type: d.platform_type ?? 'bot',
                platform_user_id: uid,
                created_at:
                  typeof d.created_at === 'number' ? d.created_at : Date.now(),
                estimated_duration,
                user_forced_urgent: false,
                is_late_night,
                alarm_enabled: false,
                is_micro_habit: isMicroHabit,
                is_hard_constraint: false,
              });
            }
            await deleteDoc(doc(db, 'devices', deviceId, 'rail_inbox', c.id));
            void syncPendingIntentions();
            DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
          } catch {
            /* doublon ou règle Firestore — retry au prochain snapshot */
          }
        }
      },
      () => {
        /* hors ligne ou règles : ignoré */
      },
    );
  })();

  return () => {
    colUnsub?.();
  };
}
