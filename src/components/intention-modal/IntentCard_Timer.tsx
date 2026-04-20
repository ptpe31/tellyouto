import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TextInput, View } from 'react-native';
import type { IntentionDraftTimer } from '../../services/intention/IntentionStateMachine';

type Props = {
  draft: IntentionDraftTimer;
  onChange: (next: IntentionDraftTimer) => void;
};

export function IntentCardTimer({ draft, onChange }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(500, draft.durationSec * 100),
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [draft.durationSec, progress]);
  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Timer</Text>
      <TextInput
        value={draft.label}
        onChangeText={(label) => onChange({ ...draft, label })}
        placeholder="Label"
        style={styles.input}
      />
      <TextInput
        value={String(draft.durationSec)}
        keyboardType="number-pad"
        onChangeText={(v) => onChange({ ...draft, durationSec: Math.max(1, Number(v) || 1) })}
        placeholder="Duree (sec)"
        style={styles.input}
      />
      <View style={styles.circleWrap}>
        <Animated.View style={[styles.progressFill, { width }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  circleWrap: { height: 10, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  progressFill: { height: 10, borderRadius: 999, backgroundColor: '#14b8a6' },
});
