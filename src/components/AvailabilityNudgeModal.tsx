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
        setLocalAffinity(stats.local_affinity);
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
      /* ignore profiling failure on passive close */
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
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{STRINGS.nudges.availabilityTitle}</Text>
          <Text style={styles.body}>
            {task
              ? localAffinity >= 0.72
                ? `Mode rapide: "${task.title}" en 2 minutes.`
                : STRINGS.nudges.availabilityBody(task.title)
              : STRINGS.nudges.availabilityMissingTask}
          </Text>
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnSecondary]} onPress={() => void onLater()} disabled={working}>
              <Text style={styles.btnSecondaryText}>{STRINGS.nudges.availabilitySecondary}</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => void onDoNow()} disabled={working || !task}>
              <Text style={styles.btnPrimaryText}>{STRINGS.nudges.availabilityPrimary}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.38)',
    paddingHorizontal: 18,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.22)',
  },
  title: { fontSize: 20, fontWeight: '800', color: '#0f766e' },
  body: { marginTop: 8, fontSize: 15, lineHeight: 21, color: '#334155' },
  actions: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  btnSecondary: { backgroundColor: '#e2e8f0' },
  btnPrimary: { backgroundColor: '#008080' },
  btnSecondaryText: { color: '#334155', fontWeight: '700' },
  btnPrimaryText: { color: '#f8fafc', fontWeight: '700' },
});

