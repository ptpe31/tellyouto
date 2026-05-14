import React from 'react';
import { Animated, Modal, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  title: string;
  displayedPct: number;
  barColor: string;
  contentOpacity: Animated.Value;
};

/**
 * Overlay central Talk : titre d’étape, barre 0–100 %, pourcentage (pipeline OneTap Pass 1).
 * Le micro reste **hors** de ce `Modal` (bouton « échap » séparé).
 */
export function TalkPipelineProgressDashboard({ visible, title, displayedPct, barColor, contentOpacity }: Props) {
  const pct = Math.max(0, Math.min(100, displayedPct));
  const rounded = Math.round(pct);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: contentOpacity }]}>
        <View style={styles.card} pointerEvents="box-none">
          <Text style={styles.title}>{title}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: barColor }]} />
          </View>
          <Text style={styles.pctLabel}>{`${rounded}%`}</Text>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    paddingVertical: 28,
    paddingHorizontal: 22,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
  },
  title: {
    color: '#f1f5f9',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 22,
  },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(51,65,85,0.85)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  pctLabel: {
    marginTop: 14,
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
