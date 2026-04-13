import { Droplets, Flower2, Play, Sparkles } from 'lucide-react-native';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { NeumorphicSurface } from '../../components';

type Props = {
  onBoostPress: () => void;
  onVideoPress: () => void;
  projectCreditsCurrent: number;
  projectCreditsMax: number;
  boostLabel: string;
  videoLabel: string;
  panelTitle: string;
  quotaText: string;
  quotaAccessibilityLabel: string;
};

function QuotaBubbles({
  current,
  max,
  style,
}: {
  current: number;
  max: number;
  style?: ViewStyle;
}) {
  const bubbles = Array.from({ length: max }, (_, i) => i < current);
  return (
    <View style={[styles.quotaRow, style]} accessibilityRole="text">
      {bubbles.map((lit, i) => (
        <View
          key={i}
          style={[styles.bubble, lit ? styles.bubbleLit : styles.bubbleDim]}
        />
      ))}
    </View>
  );
}

export function RewardedActionPanel({
  onBoostPress,
  onVideoPress,
  projectCreditsCurrent,
  projectCreditsMax,
  boostLabel,
  videoLabel,
  panelTitle,
  quotaText,
  quotaAccessibilityLabel,
}: Props) {
  return (
    <NeumorphicSurface style={styles.panel}>
      <Text style={styles.panelTitle}>{panelTitle}</Text>
      <View style={styles.cardsRow}>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardBoost, pressed && styles.pressed]}
          onPress={onBoostPress}
          accessibilityRole="button"
          accessibilityLabel={boostLabel}
        >
          <View style={styles.iconRow}>
            <Droplets size={22} color="#0e7490" />
            <View style={styles.iconFade}>
              <Flower2 size={18} color="#9ca3af" />
            </View>
            <Text style={styles.iconArrow}>→</Text>
            <Flower2 size={22} color="#7c3aed" />
          </View>
          <Text style={styles.cardLabel}>{boostLabel}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardVideo, pressed && styles.pressed]}
          onPress={onVideoPress}
          accessibilityRole="button"
          accessibilityLabel={videoLabel}
        >
          <View style={styles.iconRow}>
            <View style={styles.playFrame}>
              <Play size={20} color="#f8fafc" fill="#f8fafc" />
            </View>
            <View style={styles.projectOrb}>
              <Sparkles size={14} color="#fef9c3" />
            </View>
          </View>
          <Text style={styles.cardLabelVideo}>{videoLabel}</Text>
        </Pressable>
      </View>
      <View
        style={styles.quotaFooter}
        accessibilityLabel={quotaAccessibilityLabel}
      >
        <QuotaBubbles current={projectCreditsCurrent} max={projectCreditsMax} />
        <Text style={styles.quotaDigits}>{quotaText}</Text>
      </View>
    </NeumorphicSurface>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  panelTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: '#2e5f68',
    textAlign: 'center',
    marginBottom: 14,
    opacity: 0.85,
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  card: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 10,
    minHeight: 112,
    justifyContent: 'space-between',
  },
  cardBoost: {
    backgroundColor: 'rgba(14, 116, 144, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(14, 116, 144, 0.22)',
  },
  cardVideo: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.14)',
  },
  pressed: { opacity: 0.88 },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  iconFade: { opacity: 0.62 },
  iconArrow: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '700',
  },
  playFrame: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#0d9488',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f766e',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  projectOrb: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ca8a04',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  cardLabel: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '700',
    color: '#134e4a',
    textAlign: 'center',
    lineHeight: 15,
  },
  cardLabelVideo: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '700',
    color: '#2e5f68',
    textAlign: 'center',
    lineHeight: 15,
  },
  quotaFooter: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  quotaRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  bubble: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bubbleLit: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#fff',
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.35)',
  },
  bubbleDim: {
    backgroundColor: 'rgba(120, 140, 130, 0.25)',
  },
  quotaDigits: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(46, 95, 104, 0.55)',
    letterSpacing: 0.5,
  },
});
