import { Check } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { MD3Theme } from 'react-native-paper';

import { neumorphicInset } from '../theme/neumorphism';

type Props = {
  theme: MD3Theme;
  size?: number;
  strokeWidth?: number;
  /** Avancement sous-tâches 0–1 (hors animation « fait »). */
  progress: number;
  /** Afficher l’arc de progression partiel (sous-tâches présentes). */
  hasChildBreakdown: boolean;
  accentColor: string;
  /** Tâche en attente de validation finale (remplissage + check). */
  pendingComplete: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
};

const AnimatedView = Animated.createAnimatedComponent(View);

export function TaskCompletionOrb({
  theme,
  size = 46,
  strokeWidth = 3,
  progress,
  hasChildBreakdown,
  accentColor,
  pendingComplete,
  disabled,
  onPress,
  accessibilityLabel,
}: Props) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const arcLen = Math.max(0, Math.min(1, progress)) * circ;

  const fillScale = useSharedValue(0);
  const fillOpacity = useSharedValue(0);

  useEffect(() => {
    if (pendingComplete) {
      fillScale.value = withTiming(1, { duration: 280 });
      fillOpacity.value = withTiming(1, { duration: 220 });
    } else {
      fillScale.value = withTiming(0, { duration: 180 });
      fillOpacity.value = withTiming(0, { duration: 180 });
    }
  }, [pendingComplete]);

  const innerFillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fillScale.value }],
    opacity: fillOpacity.value,
  }));

  const trackColor = theme.colors.outlineVariant;
  const softGreen = '#6ee7b7';

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.wrap,
        neumorphicInset(theme),
        {
          width: size + 8,
          height: size + 8,
          borderRadius: (size + 8) / 2,
          opacity: disabled ? 0.35 : pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={[styles.innerSlot, { width: size, height: size }]}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <G rotation="-90" origin={`${cx}, ${cy}`}>
            <Circle
              cx={cx}
              cy={cy}
              r={r}
              stroke={trackColor}
              strokeWidth={strokeWidth}
              fill="none"
            />
            {hasChildBreakdown ? (
              <Circle
                cx={cx}
                cy={cy}
                r={r}
                stroke={accentColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={`${arcLen} ${circ}`}
                strokeLinecap="round"
              />
            ) : null}
          </G>
        </Svg>
        <View pointerEvents="none" style={styles.overlayCenter}>
          <AnimatedView
            style={[
              {
                width: size * 0.62,
                height: size * 0.62,
                borderRadius: (size * 0.62) / 2,
                backgroundColor: softGreen,
              },
              innerFillStyle,
            ]}
          />
          {pendingComplete ? (
            <View style={styles.checkLayer}>
              <Check size={Math.round(size * 0.38)} color="#065f46" strokeWidth={2.8} />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  innerSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  overlayCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
