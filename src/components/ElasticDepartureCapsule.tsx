import { Navigation2 } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { MD3Theme } from 'react-native-paper';

import { TripNeumorphicOrb } from './TripNeumorphicOrb';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Couleurs système iOS — trafic / alerte. */
export const ELASTIC_CAPSULE_COLORS = {
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  graphite: '#1C1C1E',
  trackBg: 'rgba(120, 120, 128, 0.18)',
  thumbBorder: '#FFFFFF',
  wall: 'rgba(60, 60, 67, 0.55)',
  lateBgOrange: 'rgba(255, 149, 0, 0.14)',
  lateBgRed: 'rgba(255, 59, 48, 0.14)',
} as const;

export type ElasticDepartureCapsuleVariant = 'default' | 'compact';
export type ElasticDepartureCapsuleLateVariant = 'traffic' | 'graphite';

export type ElasticDepartureCapsuleProps = {
  startMs: number;
  endMs: number;
  nowMs: number;
  ratioD: number;
  onPress: () => void;
  /** Libellé bouton mode retard (défaut : Navigation). */
  navigationLabel?: string;
  variant?: ElasticDepartureCapsuleVariant;
  /** Style du bouton GPS en retard (`graphite` pour la timeline). */
  lateVariant?: ElasticDepartureCapsuleLateVariant;
  /** Requis pour l’orbe GPS (`TripNeumorphicOrb`, taille compact). */
  theme?: MD3Theme;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatHm(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Couleur de trafic selon le ratio D (Contrat de Départ). */
export function getElasticTrafficColor(ratioD: number): string {
  const d = Number(ratioD);
  if (!Number.isFinite(d) || d < 1.1) return ELASTIC_CAPSULE_COLORS.green;
  if (d < 1.3) return ELASTIC_CAPSULE_COLORS.orange;
  return ELASTIC_CAPSULE_COLORS.red;
}

function getLateButtonColors(ratioD: number): { background: string; foreground: string } {
  const fg = getElasticTrafficColor(ratioD);
  const background = fg === ELASTIC_CAPSULE_COLORS.red ? ELASTIC_CAPSULE_COLORS.lateBgRed : ELASTIC_CAPSULE_COLORS.lateBgOrange;
  return { background, foreground: fg };
}

const LAYOUT = {
  default: {
    trackHeight: 10,
    thumbSize: 16,
    radius: 22,
    navIcon: 20,
    navBadge: 36,
    padV: 12,
    padH: 14,
    gap: 10,
    edgeFont: 13,
    edgeMinW: 40,
    lateIcon: 22,
    lateFont: 17,
    latePadV: 16,
  },
  compact: {
    trackHeight: 6,
    thumbSize: 11,
    radius: 12,
    navIcon: 15,
    navBadge: 26,
    padV: 7,
    padH: 8,
    gap: 6,
    edgeFont: 11,
    edgeMinW: 30,
    lateIcon: 18,
    lateFont: 14,
    latePadV: 10,
  },
} as const;

type LateNavigationButtonProps = {
  endMs: number;
  ratioD: number;
  label: string;
  onPress: () => void;
  lateVariant: ElasticDepartureCapsuleLateVariant;
  theme?: MD3Theme;
  compact: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function LateNavigationButton({
  endMs,
  ratioD,
  label,
  onPress,
  lateVariant,
  theme,
  compact,
  style,
  testID,
}: LateNavigationButtonProps) {
  const layout = compact ? LAYOUT.compact : LAYOUT.default;
  const graphite = lateVariant === 'graphite';

  if (graphite && theme) {
    const endLabel = formatHm(endMs);

    return (
      <View
        style={[
          styles.capsuleOuter,
          compact ? styles.capsuleOuterCompact : null,
          styles.lateCapsuleShell,
          style,
        ]}
      >
        <View
          style={[
            styles.capsuleInner,
            styles.lateCapsuleInner,
            {
              paddingVertical: layout.padV,
              paddingHorizontal: layout.padH,
              gap: layout.gap,
            },
          ]}
        >
          <View style={styles.lateTrackSpacer} />
          <Text
            style={[styles.edgeLabel, styles.lateEndLabelGhost, { fontSize: layout.edgeFont, minWidth: layout.edgeMinW }]}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {endLabel}
          </Text>
          <TripNeumorphicOrb
            theme={theme}
            size="compact"
            backgroundColor={ELASTIC_CAPSULE_COLORS.graphite}
            onPress={onPress}
            accessibilityLabel={label}
            testID={testID}
          >
            <Navigation2 size={layout.navIcon} color="#FFFFFF" strokeWidth={2.5} />
          </TripNeumorphicOrb>
        </View>
      </View>
    );
  }

  const { background, foreground } = getLateButtonColors(ratioD);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.lateButton,
        {
          backgroundColor: background,
          borderColor: foreground,
          borderRadius: layout.radius,
          paddingVertical: layout.latePadV,
        },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Navigation2 size={layout.lateIcon} color={foreground} strokeWidth={2.5} />
      <Text style={[styles.lateButtonLabel, { color: foreground, fontSize: layout.lateFont }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Capsule « Contrat de Départ » — visualisation Apple-like du créneau élastique.
 * Réutilisable dans l’app et les layouts de notification (composant autonome).
 */
export function ElasticDepartureCapsule({
  startMs,
  endMs,
  nowMs,
  ratioD,
  onPress,
  navigationLabel = 'Navigation',
  variant = 'default',
  lateVariant = 'traffic',
  theme,
  style,
  testID,
}: ElasticDepartureCapsuleProps) {
  const compact = variant === 'compact';
  const layout = compact ? LAYOUT.compact : LAYOUT.default;
  const isLate = Number.isFinite(nowMs) && Number.isFinite(endMs) && nowMs > endMs;
  const trafficColor = getElasticTrafficColor(ratioD);

  const progress = useMemo(() => {
    const span = endMs - startMs;
    if (!Number.isFinite(span) || span <= 0) return 0;
    return clamp01((nowMs - startMs) / span);
  }, [startMs, endMs, nowMs]);

  const [trackWidth, setTrackWidth] = useState(0);
  const progressSv = useSharedValue(progress);

  useEffect(() => {
    progressSv.value = withTiming(progress, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, progressSv]);

  const fillStyle = useAnimatedStyle(() => {
    const w = Math.max(0, trackWidth * progressSv.value);
    return { width: w };
  }, [trackWidth]);

  const thumbStyle = useAnimatedStyle(() => {
    const maxX = Math.max(0, trackWidth - layout.thumbSize);
    return {
      transform: [{ translateX: progressSv.value * maxX }],
    };
  }, [layout.thumbSize, trackWidth]);

  if (isLate) {
    return (
      <LateNavigationButton
        endMs={endMs}
        ratioD={ratioD}
        label={navigationLabel}
        onPress={onPress}
        lateVariant={lateVariant}
        theme={theme}
        compact={compact}
        style={style}
        testID={testID}
      />
    );
  }

  const startLabel = formatHm(startMs);
  const endLabel = formatHm(endMs);
  const startLabelPassed = Number.isFinite(nowMs) && Number.isFinite(startMs) && nowMs > startMs;
  const accessibilityLabel = `Départ entre ${startLabel} et ${endLabel}. Ouvrir la navigation.`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [
        styles.capsuleOuter,
        compact ? styles.capsuleOuterCompact : null,
        { borderRadius: layout.radius },
        pressed && styles.pressed,
        style,
      ]}
    >
      <View
        style={[
          styles.capsuleInner,
          {
            paddingVertical: layout.padV,
            paddingHorizontal: layout.padH,
            gap: layout.gap,
          },
        ]}
      >
        <Text
          style={[
            styles.edgeLabel,
            { fontSize: layout.edgeFont, minWidth: layout.edgeMinW },
            startLabelPassed ? styles.edgeLabelPassed : null,
          ]}
        >
          {startLabel}
        </Text>

        <View
          style={[styles.trackWrap, { height: layout.thumbSize + 6 }]}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setTrackWidth(w);
          }}
        >
          <View style={[styles.trackBg, { height: layout.trackHeight, borderRadius: layout.trackHeight / 2 }]}>
            <Animated.View
              style={[styles.trackFill, fillStyle, { backgroundColor: trafficColor, borderRadius: layout.trackHeight / 2 }]}
            />
            <View style={styles.deadlineWall} />
          </View>

          <Animated.View
            style={[
              styles.thumb,
              thumbStyle,
              {
                borderColor: trafficColor,
                width: layout.thumbSize,
                height: layout.thumbSize,
                borderRadius: layout.thumbSize / 2,
                top: 3,
              },
            ]}
          >
            <View
              style={[
                styles.thumbCore,
                {
                  backgroundColor: trafficColor,
                  width: layout.thumbSize - 5,
                  height: layout.thumbSize - 5,
                  borderRadius: (layout.thumbSize - 5) / 2,
                },
              ]}
            />
          </Animated.View>
        </View>

        <Text style={[styles.edgeLabel, { fontSize: layout.edgeFont, minWidth: layout.edgeMinW }]}>{endLabel}</Text>

        {theme ? (
          <TripNeumorphicOrb theme={theme} size="compact" backgroundColor={trafficColor}>
            <Navigation2 size={layout.navIcon} color="#FFFFFF" strokeWidth={2.5} />
          </TripNeumorphicOrb>
        ) : (
          <View
            style={[
              styles.navBadgeFallback,
              {
                backgroundColor: trafficColor,
                width: layout.navBadge,
                height: layout.navBadge,
                borderRadius: layout.navBadge / 2,
              },
            ]}
          >
            <Navigation2 size={layout.navIcon} color="#FFFFFF" strokeWidth={2.5} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capsuleOuter: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  capsuleOuterCompact: {
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  capsuleInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  edgeLabel: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: 'rgba(60, 60, 67, 0.85)',
    textAlign: 'center',
  },
  edgeLabelPassed: {
    color: 'rgba(60, 60, 67, 0.22)',
  },
  trackWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  trackBg: {
    backgroundColor: ELASTIC_CAPSULE_COLORS.trackBg,
    overflow: 'hidden',
    position: 'relative',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    opacity: 0.92,
  },
  deadlineWall: {
    position: 'absolute',
    right: 0,
    top: -2,
    bottom: -2,
    width: 2,
    borderRadius: 1,
    backgroundColor: ELASTIC_CAPSULE_COLORS.wall,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    backgroundColor: ELASTIC_CAPSULE_COLORS.thumbBorder,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  thumbCore: {},
  navBadgeFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  lateCapsuleShell: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  lateCapsuleInner: {
    width: '100%',
  },
  lateTrackSpacer: {
    flex: 1,
    minWidth: 0,
  },
  lateEndLabelGhost: {
    opacity: 0,
  },
  lateButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5,
  },
  lateButtonLabel: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
