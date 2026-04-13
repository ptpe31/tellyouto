import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export type OrbitalSlot = 'neutral' | 'quick' | 'deep';

export type IntentionOrbitalRef = {
  resetToNeutral: () => void;
};

type Props = {
  radius?: number;
  disabled?: boolean;
  onSlotChange: (slot: OrbitalSlot) => void;
  labelQuick: string;
  labelDeep: string;
};

const SPRING = { damping: 17, stiffness: 260, mass: 0.8 };

function snapTarget(angle: number): { target: number; slot: OrbitalSlot } {
  'worklet';
  const norm = (x: number) => {
    let v = x;
    while (v > Math.PI) v -= 2 * Math.PI;
    while (v < -Math.PI) v += 2 * Math.PI;
    return v;
  };
  const da = (u: number, v: number) => Math.abs(norm(u - v));
  const distTop = da(angle, -Math.PI / 2);
  const distRight = da(angle, 0);
  const distLeft = da(angle, Math.PI);
  const thresh = Math.PI / 4;

  if (distRight < thresh && distRight <= distLeft && distRight <= distTop) {
    return { target: 0, slot: 'quick' };
  }
  if (distLeft < thresh && distLeft <= distTop) {
    return { target: Math.PI, slot: 'deep' };
  }
  return { target: -Math.PI / 2, slot: 'neutral' };
}

export const IntentionOrbital = forwardRef<IntentionOrbitalRef, Props>(
  function IntentionOrbital(
    {
      radius = 118,
      disabled = false,
      onSlotChange,
      labelQuick,
      labelDeep,
    },
    ref,
  ) {
    const size = (radius + 36) * 2;
    const cx = size / 2;
    const cy = size / 2;

    const angle = useSharedValue(-Math.PI / 2);
    const startAngle = useSharedValue(-Math.PI / 2);
    const prevSlot = useSharedValue<OrbitalSlot>('neutral');

    const [displaySlot, setDisplaySlot] = useState<OrbitalSlot>('neutral');

    const syncLabels = useCallback((slot: OrbitalSlot) => {
      setDisplaySlot(slot);
    }, []);

    useAnimatedReaction(
      () => snapTarget(angle.value).slot,
      (slot, prev) => {
        if (slot !== prev) {
          runOnJS(syncLabels)(slot);
        }
      },
    );

    const snapHaptic = useCallback(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, []);

    const pan = Gesture.Pan()
      .hitSlop(14)
      .enabled(!disabled)
      .onStart(() => {
        startAngle.value = angle.value;
      })
      .onUpdate((e) => {
        const sa = startAngle.value;
        const sx = radius * Math.cos(sa);
        const sy = radius * Math.sin(sa);
        let nx = sx + e.translationX;
        let ny = sy + e.translationY;
        const len = Math.hypot(nx, ny);
        if (len < 6) return;
        nx = (nx / len) * radius;
        ny = (ny / len) * radius;
        angle.value = Math.atan2(ny, nx);
      })
      .onEnd(() => {
        const { target, slot } = snapTarget(angle.value);
        const changed = prevSlot.value !== slot;
        prevSlot.value = slot;
        angle.value = withSpring(target, SPRING, (finished) => {
          if (finished) {
            runOnJS(onSlotChange)(slot);
          }
        });
        if (changed) {
          runOnJS(snapHaptic)();
        }
      });

    useImperativeHandle(
      ref,
      () => ({
        resetToNeutral: () => {
          prevSlot.value = 'neutral';
          angle.value = withSpring(-Math.PI / 2, SPRING, (finished) => {
            if (finished) {
              runOnJS(onSlotChange)('neutral');
            }
          });
        },
      }),
      [angle, onSlotChange, prevSlot],
    );

    const ballStyle = useAnimatedStyle(() => {
      const x = cx + radius * Math.cos(angle.value) - 14;
      const y = cy + radius * Math.sin(angle.value) - 14;
      return {
        transform: [{ translateX: x }, { translateY: y }],
      };
    });

    const ballColorStyle = useAnimatedStyle(() => {
      const slot = snapTarget(angle.value).slot;
      const bg =
        slot === 'quick'
          ? '#2563eb'
          : slot === 'deep'
            ? '#ca8a04'
            : '#14b8a6';
      return { backgroundColor: bg };
    });

    const rightLabelLeft = cx + radius * 0.58;
    const leftLabelLeft = cx - radius * 0.58 - 72;

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="box-none">
      <View
        pointerEvents="none"
        style={[
          styles.rail,
          {
            width: radius * 2 + 28,
            height: radius * 2 + 28,
            borderRadius: radius + 14,
          },
        ]}
      />
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.ball, ballStyle, ballColorStyle]} />
      </GestureDetector>
        {displaySlot === 'quick' ? (
          <View style={[styles.slotLabel, { left: rightLabelLeft, top: cy - 8 }]}>
            <Text style={styles.slotLabelText}>{labelQuick}</Text>
          </View>
        ) : null}
        {displaySlot === 'deep' ? (
          <View style={[styles.slotLabel, { left: leftLabelLeft, top: cy - 8 }]}>
            <Text style={styles.slotLabelText}>{labelDeep}</Text>
          </View>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: 'rgba(45, 111, 112, 0.28)',
    backgroundColor: 'transparent',
  },
  ball: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
    zIndex: 10,
  },
  slotLabel: {
    position: 'absolute',
    width: 72,
  },
  slotLabelText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2e5f68',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
});
