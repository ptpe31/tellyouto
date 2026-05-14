import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from 'react-native-paper';

import { dealerCategoryIcon } from './dealerMaterialTheme';

export type DealerMaterializeCardProps = {
  cardId: string;
  slotKey: string;
  slotDx: number;
  slotDy: number;
  cw: number;
  ch: number;
  peekSnapshotRise: boolean;
  fromEnterY: number;
  categoryTag: string;
  predictedType: string;
  /** Pastel stable par intention (titre) — mixeur Talk. */
  titleAccentColor: string;
  /** Carte active : glow + léger relief. */
  selected?: boolean;
  lastWord: string;
  materialized: boolean;
  validated: boolean;
  materializeWave: number;
  onMaterialized: (id: string) => void;
  onValidated: (id: string) => void;
  suctionWave: number;
  suctionMode: 'timer' | 'micro';
  badgeTargetDx: number;
  badgeTargetDy: number;
  staggerIndex: number;
  onSuctionArrived: (id: string) => void;
};

const SUCTION_MS = 480;
const FILL_MS = 720;

const POSITION_SPRING = { damping: 18, stiffness: 210, mass: 0.72 };

function triggerHitHaptic(onArrived: (id: string) => void, id: string) {
  if (Platform.OS !== 'web') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  onArrived(id);
}

export function DealerMaterializeCard({
  cardId,
  slotDx,
  slotDy,
  cw,
  ch,
  peekSnapshotRise,
  fromEnterY,
  categoryTag,
  predictedType,
  titleAccentColor,
  selected,
  lastWord,
  materialized,
  validated,
  materializeWave,
  onMaterialized,
  onValidated,
  suctionWave,
  suctionMode,
  badgeTargetDx,
  badgeTargetDy,
  staggerIndex,
  onSuctionArrived,
}: DealerMaterializeCardProps) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(fromEnterY);
  const fillProgress = useSharedValue(0);
  const appliedMaterialRef = useRef(0);
  const appliedSuctionRef = useRef(0);
  const positionInitRef = useRef(false);

  const accent = titleAccentColor;
  const Icon = dealerCategoryIcon(categoryTag, predictedType);
  const iconSize = Math.max(22, Math.round(Math.min(cw, ch) * 0.22));

  const finishMaterialLine = useCallback(() => {
    onMaterialized(cardId);
    setTimeout(() => onValidated(cardId), 160);
  }, [cardId, onMaterialized, onValidated]);

  useEffect(() => {
    if (suctionWave > 0) return;
    if (!positionInitRef.current) {
      positionInitRef.current = true;
      translateY.value = fromEnterY;
      translateX.value = 0;
      if (peekSnapshotRise) {
        translateX.value = withTiming(slotDx, { duration: 1200, easing: Easing.out(Easing.cubic) });
        translateY.value = withTiming(slotDy, { duration: 1200, easing: Easing.out(Easing.cubic) });
      } else {
        translateX.value = withSpring(slotDx, POSITION_SPRING);
        translateY.value = withSpring(slotDy, POSITION_SPRING);
      }
      return;
    }
    translateX.value = withSpring(slotDx, POSITION_SPRING);
    translateY.value = withSpring(slotDy, POSITION_SPRING);
  }, [fromEnterY, peekSnapshotRise, slotDx, slotDy, suctionWave, translateX, translateY]);

  useEffect(() => {
    if (materialized || validated) return;
    if (materializeWave <= 0) return;
    if (appliedMaterialRef.current >= materializeWave) return;
    appliedMaterialRef.current = materializeWave;
    fillProgress.value = 0;
    fillProgress.value = withTiming(1, { duration: FILL_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(finishMaterialLine)();
    });
  }, [fillProgress, finishMaterialLine, materializeWave, materialized, validated]);

  useEffect(() => {
    if (!materialized) return;
    if (suctionWave <= 0) return;
    if (appliedSuctionRef.current >= suctionWave) return;
    appliedSuctionRef.current = suctionWave;
    const staggerMs = suctionMode === 'micro' ? 0 : staggerIndex * 72;
    const easing = Easing.out(Easing.cubic);
    translateX.value = withDelay(
      staggerMs,
      withTiming(
        badgeTargetDx,
        { duration: SUCTION_MS, easing },
        (finished) => {
          if (finished) runOnJS(triggerHitHaptic)(onSuctionArrived, cardId);
        },
      ),
    );
    translateY.value = withDelay(
      staggerMs,
      withTiming(badgeTargetDy, { duration: SUCTION_MS, easing }),
    );
  }, [
    badgeTargetDx,
    badgeTargetDy,
    cardId,
    materialized,
    onSuctionArrived,
    staggerIndex,
    suctionMode,
    suctionWave,
    translateX,
    translateY,
  ]);

  const rootStyle = useAnimatedStyle(() => {
    const scale = selected ? 1.04 : 1;
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: '0deg' },
        { scale },
      ],
    };
  }, [selected]);

  const fillStyle = useAnimatedStyle(() => ({
    height: ch * fillProgress.value,
    opacity: interpolate(fillProgress.value, [0, 0.03, 1], [0, 1, 1]),
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fillProgress.value, [0, 0.52, 0.86], [0, 0, 1]),
  }));

  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fillProgress.value, [0, 0.35, 0.75, 1], [1, 0.85, 0.35, 0.2]),
  }));

  const r = Math.max(10, Math.round(Math.min(cw, ch) * 0.08));
  const fsWord = Math.max(14, Math.round(cw * 0.19));

  const shadowSelected = selected
    ? Platform.select({
        ios: {
          shadowColor: accent,
          shadowOpacity: 0.48,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 5 },
        },
        android: { elevation: 14 },
        default: {},
      })
    : null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.shadowWrap, shadowSelected, rootStyle, { width: cw, height: ch }]}
    >
      <View
        style={[
          styles.cardShell,
          selected ? styles.cardShellSelected : null,
          {
            width: cw,
            height: ch,
            borderRadius: r,
            borderColor: accent,
            backgroundColor: materialized ? accent : 'transparent',
          },
        ]}
      >
        {!materialized ? (
          <View style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
            <Animated.View
              style={[
                styles.fillRise,
                {
                  width: cw,
                  backgroundColor: accent,
                  borderBottomLeftRadius: r,
                  borderBottomRightRadius: r,
                },
                fillStyle,
              ]}
            />
          </View>
        ) : null}

        {!materialized ? (
          <Animated.View style={[styles.iconLayer, iconStyle]}>
            <Icon size={iconSize} color={accent} strokeWidth={2.2} />
          </Animated.View>
        ) : null}

        {lastWord.trim().length > 0 ? (
          <Animated.View style={[styles.wordLayer, textStyle]} pointerEvents="none">
            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={[styles.keyword, { color: theme.colors.surface, fontSize: fsWord }]}
            >
              {lastWord}
            </Text>
          </Animated.View>
        ) : null}

        {validated ? (
          <View style={styles.okLayer} pointerEvents="none">
            <View style={[styles.okPill, { borderColor: 'rgba(255,255,255,0.85)' }]}>
              <Check size={13} color="rgba(255,255,255,0.95)" strokeWidth={3} />
            </View>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.26,
    shadowRadius: 10,
    elevation: 8,
  },
  cardShell: {
    borderWidth: 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** Léger relief type neumorphique quand la carte est sélectionnée (Talk). */
  cardShellSelected: Platform.select({
    ios: {
      borderWidth: 2.5,
      shadowColor: 'rgba(255,255,255,0.45)',
      shadowOffset: { width: -2, height: -2 },
      shadowOpacity: 0.5,
      shadowRadius: 3,
    },
    android: { borderWidth: 2.5, elevation: 4 },
    default: { borderWidth: 2.5 },
  }),
  fillRise: {
    position: 'absolute',
    bottom: 0,
    left: 0,
  },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wordLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  keyword: {
    fontWeight: '800',
    textAlign: 'center',
  },
  okLayer: {
    position: 'absolute',
    right: 5,
    bottom: 5,
  },
  okPill: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
