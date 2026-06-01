import { AlarmClock, Navigation2 } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { MD3Theme } from 'react-native-paper';

import { TRIP_ORB_SIZE } from './TripNeumorphicOrb';

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
  /** Action GPS (zone exécution — hors capsule si gérée par la carte). */
  onNavigationPress: () => void;
  /** Action réveil (zone planification, droite de la barre). */
  onAlarmPress?: () => void;
  /** Affiche l’icône réveil (promesse P1 validée, masquée après `endMs`). */
  showAlarmIcon?: boolean;
  /** Libellé bouton mode retard (défaut : Navigation). */
  navigationLabel?: string;
  /** Libellé accessibilité réveil. */
  alarmA11yLabel?: string;
  variant?: ElasticDepartureCapsuleVariant;
  /** Style du bouton GPS en retard (`graphite` pour la timeline). */
  lateVariant?: ElasticDepartureCapsuleLateVariant;
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
    variant: 'default' as const,
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
    variant: 'compact' as const,
  },
} as const;

type CapsuleLayout = (typeof LAYOUT)[keyof typeof LAYOUT];

type AlarmSlotProps = {
  layout: CapsuleLayout;
  visible: boolean;
  onPress?: () => void;
  alarmA11yLabel?: string;
};

function AlarmSlot({ layout, visible, onPress, alarmA11yLabel }: AlarmSlotProps) {
  const slotSize = layout.navBadge;
  if (!visible) {
    return <View style={{ width: slotSize, height: slotSize, opacity: 0 }} pointerEvents="none" />;
  }

  const iconSize = layout.variant === 'compact' ? 20 : 22;
  const enabled = Boolean(onPress);

  return (
    <Pressable
      onPress={(e) => {
        e?.stopPropagation?.();
        onPress?.();
      }}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={alarmA11yLabel}
      accessibilityState={{ disabled: !enabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.alarmSlot,
        { width: slotSize, height: slotSize },
        !enabled && styles.alarmSlotDisabled,
        pressed && enabled ? styles.pressed : null,
      ]}
    >
      <AlarmClock size={iconSize} color="rgba(60, 60, 67, 0.85)" strokeWidth={2.2} />
    </Pressable>
  );
}

type LateNavigationButtonProps = {
  endMs: number;
  ratioD: number;
  label: string;
  onPress: () => void;
  lateVariant: ElasticDepartureCapsuleLateVariant;
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
  compact,
  style,
  testID,
}: LateNavigationButtonProps) {
  const layout = compact ? LAYOUT.compact : LAYOUT.default;
  const graphite = lateVariant === 'graphite';

  if (graphite) {
    return null;
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
 * Capsule « Contrat de Départ » — barre de progression statique + réveil à droite.
 */
export function ElasticDepartureCapsule({
  startMs,
  endMs,
  nowMs,
  ratioD,
  onNavigationPress,
  onAlarmPress,
  showAlarmIcon = false,
  navigationLabel = 'Navigation',
  alarmA11yLabel = 'Alarm',
  variant = 'default',
  lateVariant = 'traffic',
  theme,
  style,
  testID,
}: ElasticDepartureCapsuleProps) {
  const compact = variant === 'compact';
  const layout = compact ? LAYOUT.compact : LAYOUT.default;
  const isLate = Number.isFinite(nowMs) && Number.isFinite(endMs) && nowMs > endMs;
  const alarmVisible = showAlarmIcon && !isLate;
  const trafficColor = getElasticTrafficColor(ratioD);

  const progress = useMemo(() => {
    const span = endMs - startMs;
    if (!Number.isFinite(span) || span <= 0) return 0;
    return clamp01((nowMs - startMs) / span);
  }, [startMs, endMs, nowMs]);

  const [trackWidth, setTrackWidth] = useState(0);
  const fillWidth = Math.max(0, trackWidth * progress);
  const thumbMaxX = Math.max(0, trackWidth - layout.thumbSize);
  const thumbX = progress * thumbMaxX;

  if (isLate && lateVariant === 'traffic') {
    return (
      <LateNavigationButton
        endMs={endMs}
        ratioD={ratioD}
        label={navigationLabel}
        onPress={onNavigationPress}
        lateVariant={lateVariant}
        compact={compact}
        style={style}
        testID={testID}
      />
    );
  }

  const startLabel = formatHm(startMs);
  const endLabel = formatHm(endMs);
  const startLabelPassed = Number.isFinite(nowMs) && Number.isFinite(startMs) && nowMs > startMs;

  return (
    <View
      style={[
        styles.capsuleOuter,
        compact ? styles.capsuleOuterCompact : null,
        { borderRadius: layout.radius },
        style,
      ]}
      testID={testID}
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
            <View
              style={[
                styles.trackFill,
                {
                  width: fillWidth,
                  backgroundColor: trafficColor,
                  borderRadius: layout.trackHeight / 2,
                },
              ]}
            />
            <View style={styles.deadlineWall} />
          </View>

          <View
            style={[
              styles.thumb,
              {
                transform: [{ translateX: thumbX }],
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
          </View>
        </View>

        <Text style={[styles.edgeLabel, { fontSize: layout.edgeFont, minWidth: layout.edgeMinW }]}>{endLabel}</Text>

        <AlarmSlot
          layout={layout}
          visible={alarmVisible}
          onPress={alarmVisible ? onAlarmPress : undefined}
          alarmA11yLabel={alarmA11yLabel}
        />
      </View>
    </View>
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
  alarmSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmSlotDisabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.88,
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

export { TRIP_ORB_SIZE };
