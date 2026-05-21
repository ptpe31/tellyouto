/**
 * DEPRECATED — modale « 2 minutes disponibles » retirée du montage (`App.tsx`).
 * Implémentation d’origine archivée dans `nettoyage-code-mort.md` (§1).
 * Suppression définitive prévue après phase de debug.
 */
/** Stub : ne rien afficher. */
export function AvailabilityNudgeModal() {
  return null;
}

/* ========== IMPLÉMENTATION D’ORIGINE (commentée — ne pas décommenter sans remonter App.tsx) ==========
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Alert, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getTrankilV2UserStats,
  markTrankilV2IntentionDone,
  pickAvailabilityTask,
  type TrankilV2IntentionRow,
} from '../api/trankilV2Db';
import { STRINGS } from '../constants/Strings';
import { getOptimalReward, recordBonusReaction, triggerOptimalBonus } from '../services/BonusEngine';
import {
  markAppActiveStart,
  markAvailabilityNudged,
  recordAppInteraction,
  shouldTriggerAvailabilityNudge,
} from '../services/AvailabilityTimer';

export function AvailabilityNudgeModal() {
  const [visible, setVisible] = useState(false);
  const [task, setTask] = useState<TrankilV2IntentionRow | null>(null);
  const [working, setWorking] = useState(false);
  const [localAffinity, setLocalAffinity] = useState(0.5);

  useEffect(() => {
    void markAppActiveStart();
    const interval = setInterval(() => {
      void (async () => {
        const should = await shouldTriggerAvailabilityNudge();
        if (!should) return;
        const nextTask = await pickAvailabilityTask();
        if (!nextTask) return;
        const stats = await getTrankilV2UserStats();
        setLocalAffinity(0.5);
        setTask(nextTask);
        setVisible(true);
        await markAvailabilityNudged();
      })();
    }, 60_000);

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void markAppActiveStart();
      }
    });
    return () => {
      clearInterval(interval);
      appSub.remove();
    };
  }, []);

  const onLater = async () => {
    try {
      const stats = await getTrankilV2UserStats();
      const reward = getOptimalReward(stats);
      await recordBonusReaction(reward.bonusType, false);
    } catch {
    }
    await recordAppInteraction();
    setVisible(false);
  };

  const onDoNow = async () => {
    if (!task) return;
    setWorking(true);
    try {
      await markTrankilV2IntentionDone(task.id);
      const reward = await triggerOptimalBonus();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVisible(false);
      Alert.alert(STRINGS.nudges.availabilityTitle, reward.message);
    } finally {
      setWorking(false);
      await recordAppInteraction();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void onLater()}>
      ...
    </Modal>
  );
}
========== */
