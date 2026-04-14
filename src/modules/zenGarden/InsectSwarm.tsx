import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

type FlyConfig = {
  x: number;
  y: number;
  size: number;
  dur: number;
  delay: number;
  ampX: number;
  ampY: number;
};

type Props = {
  count: number;
  dismissSignal: number;
  onDismissed?: () => void;
};

function makeFly(seed: number): FlyConfig {
  return {
    x: (Math.random() - 0.5) * 170,
    y: (Math.random() - 0.5) * 170,
    size: 3 + (seed % 3),
    dur: 1800 + (seed % 5) * 260,
    delay: (seed % 7) * 70,
    ampX: 6 + (seed % 4) * 2,
    ampY: 5 + (seed % 5) * 2,
  };
}

export function InsectSwarm({ count, dismissSignal, onDismissed }: Props) {
  const flies = useMemo(
    () => Array.from({ length: count }, (_, i) => makeFly(i + Math.floor(Math.random() * 50))),
    [count],
  );
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);
  const valRefs = useRef(
    flies.map(() => ({ x: new Animated.Value(0), y: new Animated.Value(0), o: new Animated.Value(0.88) })),
  );
  const groupOpacity = useRef(new Animated.Value(1)).current;
  const lastDismissSignal = useRef(dismissSignal);

  useEffect(() => {
    loopsRef.current.forEach((l) => l.stop());
    loopsRef.current = [];
    groupOpacity.setValue(1);
    valRefs.current = flies.map(() => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      o: new Animated.Value(0.88),
    }));
    flies.forEach((fly, idx) => {
      const values = valRefs.current[idx];
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(fly.delay),
          Animated.parallel([
            Animated.timing(values.x, {
              toValue: fly.ampX,
              duration: fly.dur,
              useNativeDriver: true,
            }),
            Animated.timing(values.y, {
              toValue: -fly.ampY,
              duration: fly.dur,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(values.x, {
              toValue: -fly.ampX,
              duration: fly.dur,
              useNativeDriver: true,
            }),
            Animated.timing(values.y, {
              toValue: fly.ampY,
              duration: fly.dur,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );
      loopsRef.current.push(loop);
      loop.start();
    });
    return () => {
      loopsRef.current.forEach((l) => l.stop());
    };
  }, [flies]);

  useEffect(() => {
    if (count <= 0) return;
    if (dismissSignal === lastDismissSignal.current) return;
    lastDismissSignal.current = dismissSignal;
    loopsRef.current.forEach((l) => l.stop());
    const exits = valRefs.current.map((values, idx) =>
      Animated.parallel([
        Animated.timing(values.x, {
          toValue: (idx % 2 === 0 ? 1 : -1) * (180 + (idx % 5) * 22),
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(values.y, {
          toValue: -220 - (idx % 4) * 28,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(values.o, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]),
    );
    Animated.parallel([
      Animated.timing(groupOpacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      Animated.stagger(10, exits),
    ]).start(() => {
      onDismissed?.();
    });
  }, [dismissSignal, count, groupOpacity, onDismissed]);

  if (count <= 0) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity: groupOpacity }]}>
      {flies.map((fly, idx) => {
        const v = valRefs.current[idx];
        return (
          <Animated.View
            key={`${idx}-${fly.size}`}
            style={[
              styles.fly,
              {
                width: fly.size * 2,
                height: fly.size * 2,
                borderRadius: fly.size,
                left: '50%',
                top: '50%',
                transform: [
                  { translateX: fly.x },
                  { translateY: fly.y },
                  { translateX: v.x },
                  { translateY: v.y },
                ],
                opacity: v.o,
              },
            ]}
          />
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
  },
  fly: {
    position: 'absolute',
    backgroundColor: '#111827',
  },
});

