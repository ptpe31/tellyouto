import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { IconButton } from 'react-native-paper';

import { neumorphicRaised } from '../theme/neumorphism';

/** Diamètres standard TRIP (carte timeline + badge capsule). */
export const TRIP_ORB_SIZE = {
  /** Cercle transport / validation à gauche de `IntentionCard`. */
  card: 54,
  /** Badge GPS / scan actif sur capsule et actions secondaires. */
  compact: 26,
} as const;

export type TripNeumorphicOrbSize = keyof typeof TRIP_ORB_SIZE | number;

export type TripNeumorphicOrbProps = {
  theme: MD3Theme;
  size?: TripNeumorphicOrbSize;
  /** Par défaut : `theme.colors.surface`. */
  backgroundColor?: string;
  /** Icône Material (si `children` absent). */
  icon?: string;
  iconColor?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function resolveOrbDimension(size: TripNeumorphicOrbSize): number {
  return typeof size === 'number' ? size : TRIP_ORB_SIZE[size];
}

function resolveIconSize(diameter: number): number {
  if (diameter <= TRIP_ORB_SIZE.compact) return 15;
  return 22;
}

/**
 * Orbe néomorphique TRIP — transport, scan actif, GPS capsule, navigation en retard.
 */
export function TripNeumorphicOrb({
  theme,
  size = 'card',
  backgroundColor,
  icon,
  iconColor,
  children,
  onPress,
  disabled,
  accessibilityLabel,
  style,
  testID,
}: TripNeumorphicOrbProps) {
  const diameter = resolveOrbDimension(size);
  const iconSize = resolveIconSize(diameter);
  const bg = backgroundColor ?? theme.colors.surface;

  const orbStyle = [
    neumorphicRaised(theme),
    styles.orb,
    {
      width: diameter,
      height: diameter,
      borderRadius: diameter / 2,
      backgroundColor: bg,
    },
    disabled ? styles.disabled : null,
    style,
  ];

  const content =
    children ??
    (icon ? <IconButton icon={icon} size={iconSize} iconColor={iconColor ?? theme.colors.primary} style={styles.icon} /> : null);

  if (onPress) {
    return (
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        hitSlop={6}
        style={({ pressed }) => [orbStyle, pressed && !disabled ? styles.pressed : null]}
      >
        <View pointerEvents="none" style={styles.contentSlot}>
          {content}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={orbStyle} accessibilityLabel={accessibilityLabel} testID={testID}>
      <View style={styles.contentSlot}>{content}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { margin: 0, padding: 0 },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.45 },
});
