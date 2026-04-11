import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { DeviceEventEmitter } from 'react-native';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';

import type { UserSpectrumState } from '../context/UserSpectrumContext';
import {
  analyzeNewIntentionSemantics,
  estimateDurationMinutes,
  inferStructuralRoutinePlan,
} from '../services/agentLogic';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';

import { DEBUG_LAST_RAIL_INBOX_PURGE_MS } from '../config/transitPurgeKeys';
import { ensureFirebaseAnonymousAuth, getFirestoreDb } from './firebase';
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
 * Intentions poussées par le webhook (bots) — transit Firestore → SQLite puis
 * deleteDoc immédiat sur `rail_inbox` (rétention zéro côté Cloud une fois ingérée).
 */
export function subscribeRailInbox(getSpectrum: () => UserSpectrumState): () => void {
  const db = getFirestoreDb();
  if (!db) return () => {};

  let colUnsub: Unsubscribe | null = null;

  void (async () => {
    await ensureFirebaseAnonymousAuth();
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
          const rawTranscript =
            [title, description].filter((x) => String(x).trim()).join('\n') ||
            title;
          const energyScore = Math.min(1, Math.max(0, priority / 100));
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
                  raw_transcript: rawTranscript,
                  energy_score: energyScore,
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
                raw_transcript: rawTranscript,
                energy_score: energyScore,
              });
            }
          } catch {
            /* doublon SQLite / contrainte — retry au prochain snapshot */
            continue;
          }
          const inboxRef = doc(db, 'devices', deviceId, 'rail_inbox', c.id);
          try {
            await updateDoc(inboxRef, {
              processed: true,
              processed_at: serverTimestamp(),
            });
          } catch {
            /* règles Firestore : deleteDoc peut suffire */
          }
          try {
            await deleteDoc(inboxRef);
            await AsyncStorage.setItem(
              DEBUG_LAST_RAIL_INBOX_PURGE_MS,
              String(Date.now()),
            );
          } catch {
            /* purge planifiée côté serveur si l’effacement immédiat échoue */
          }
          void syncPendingIntentions();
          DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
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
