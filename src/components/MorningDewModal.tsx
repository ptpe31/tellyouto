import { BlurView } from 'expo-blur';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  applyMorningFocusChoice,
  morningGreeting,
  pickMorningDewItems,
  shouldTriggerMorningDew,
  type MorningDewPick,
} from '../services/MorningTrigger';
import { useSaturation } from '../context/SaturationContext';
import { STRINGS } from '../constants/Strings';

export function MorningDewModal() {
  const { animationMultiplier, runWithWeight } = useSaturation();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<MorningDewPick>({
    task: null,
    habit: null,
    inspiration: null,
  });
  const drops = useRef(
    Array.from({ length: 7 }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    void (async () => {
      const trigger = await shouldTriggerMorningDew();
      if (!trigger) return;
      const nextPick = await pickMorningDewItems();
      if (!nextPick.task && !nextPick.habit && !nextPick.inspiration) return;
      setPick(nextPick);
      setVisible(true);
    })();
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('DEBUG_FORCE_MORNING', () => {
      void (async () => {
        const nextPick = await pickMorningDewItems();
        setPick(nextPick);
        setVisible(true);
      })();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const loops = drops.map((v, idx) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(idx * 140),
          Animated.timing(v, {
            toValue: 1,
            duration: Math.round(1600 * animationMultiplier),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [visible, drops]);

  const cards = useMemo(
    () => [pick.task, pick.habit, pick.inspiration].filter(Boolean),
    [pick],
  );

  const onChoose = async (id: string) => {
    setLoading(true);
    try {
      await applyMorningFocusChoice(id);
      setVisible(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <BlurView intensity={55} tint="light" style={styles.overlay}>
        <View style={styles.container}>
          {drops.map((d, idx) => (
            <Animated.View
              key={idx}
              style={[
                styles.drop,
                {
                  left: `${8 + idx * 13}%`,
                  transform: [
                    {
                      translateY: d.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-28, 220],
                      }),
                    },
                  ],
                  opacity: d.interpolate({
                    inputRange: [0, 0.8, 1],
                    outputRange: [0.1, 0.65, 0],
                  }),
                },
              ]}
            />
          ))}
          <Text style={styles.title}>{morningGreeting(new Date())}</Text>
          <Text style={styles.subtitle}>{STRINGS.GARDEN_RITUALS.MORNING_CAPTAIN}</Text>

          {cards.map((item) =>
            item ? (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => runWithWeight(() => void onChoose(item.id))}
                disabled={loading}
              >
                <Text style={styles.cardType}>{item.type}</Text>
                <Text style={styles.cardTitle}>{item.title}</Text>
              </Pressable>
            ) : null,
          )}

          <Text style={styles.foot}>
            {loading ? STRINGS.CAPTURE.FOCUS_ACTIVATING : STRINGS.CAPTURE.TAP_CARD_TO_START}
          </Text>
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: {
    width: '90%',
    borderRadius: 22,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    overflow: 'hidden',
  },
  drop: {
    position: 'absolute',
    width: 7,
    height: 13,
    borderRadius: 7,
    backgroundColor: 'rgba(56,189,248,0.65)',
    top: -10,
  },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#164e63' },
  subtitle: { marginTop: 6, marginBottom: 12, fontSize: 15, color: '#0f766e', fontWeight: '600' },
  card: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.16)',
    marginBottom: 8,
  },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  cardType: { fontSize: 11, fontWeight: '800', color: '#0f766e', marginBottom: 2 },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: '#1f2937' },
  foot: { marginTop: 6, fontSize: 12, color: '#4b5563', textAlign: 'center', fontWeight: '600' },
});
