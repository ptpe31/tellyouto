import { BlurView } from 'expo-blur';
import { Droplets, Flower2, Play, Sparkles } from 'lucide-react-native';
import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
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
  onQuotaPress?: () => void;
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
  onQuotaPress,
}: Props) {
  const { width: w, height: h } = useWindowDimensions();
  const padH = Math.max(14, w * 0.042);
  const padV = Math.max(18, h * 0.022);
  const cardMinH = Math.max(120, h * 0.14);

  return (
    <BlurView
      intensity={Platform.OS === 'ios' ? 48 : 32}
      tint="light"
      style={[styles.blurOuter, { width: '100%', maxWidth: 420 }]}
    >
      <NeumorphicSurface
        style={[
          styles.panel,
          {
            paddingVertical: padV,
            paddingHorizontal: padH,
            backgroundColor: 'rgba(245, 245, 240, 0.58)',
          },
        ]}
      >
        <Text style={styles.panelTitle}>{panelTitle}</Text>
        <View style={styles.cardsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.card,
              styles.cardBoost,
              { minHeight: cardMinH },
              pressed && styles.pressed,
            ]}
            onPress={onBoostPress}
            accessibilityRole="button"
            accessibilityLabel={boostLabel}
          >
            <View style={styles.iconRow}>
              <Droplets size={24} color="#0e7490" />
              <View style={styles.iconFade}>
                <Flower2 size={20} color="#9ca3af" />
              </View>
              <Text style={styles.iconArrow}>→</Text>
              <Flower2 size={24} color="#7c3aed" />
            </View>
            <Text style={styles.cardLabel}>{boostLabel}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.card,
              styles.cardVideo,
              { minHeight: cardMinH },
              pressed && styles.pressed,
            ]}
            onPress={onVideoPress}
            accessibilityRole="button"
            accessibilityLabel={videoLabel}
          >
            <View style={styles.iconRow}>
              <View style={styles.playFrame}>
                <Play size={22} color="#f8fafc" fill="#f8fafc" />
              </View>
              <View style={styles.projectOrb}>
                <Sparkles size={15} color="#fef9c3" />
              </View>
            </View>
            <Text style={styles.cardLabelVideo}>{videoLabel}</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.quotaFooter}
          accessibilityLabel={quotaAccessibilityLabel}
          onPress={onQuotaPress}
        >
          <QuotaBubbles current={projectCreditsCurrent} max={projectCreditsMax} />
          <Text style={styles.quotaDigits}>{quotaText}</Text>
        </Pressable>
      </NeumorphicSurface>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  blurOuter: {
    borderRadius: 26,
    overflow: 'hidden',
  },
  panel: {
    borderRadius: 22,
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: '#2e5f68',
    textAlign: 'center',
    marginBottom: 16,
    opacity: 0.88,
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: '4%',
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  cardBoost: {
    backgroundColor: 'rgba(14, 116, 144, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(14, 116, 144, 0.24)',
  },
  cardVideo: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.16)',
  },
  pressed: { opacity: 0.88 },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  iconFade: { opacity: 0.62 },
  iconArrow: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
  },
  playFrame: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#0d9488',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f766e',
    shadowOpacity: 0.38,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  projectOrb: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ca8a04',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  cardLabel: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#134e4a',
    textAlign: 'center',
    lineHeight: 18,
  },
  cardLabelVideo: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#2e5f68',
    textAlign: 'center',
    lineHeight: 18,
  },
  quotaFooter: {
    marginTop: 18,
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
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(46, 95, 104, 0.55)',
    letterSpacing: 0.5,
  },
});
