import React, { useEffect, useState } from 'react';
import { LayoutAnimation, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

type Props = {
  /** Minutes depuis minuit (début de la plage affichée) */
  rangeStartMin: number;
  /** Minutes depuis minuit (fin de la plage affichée) */
  rangeEndMin: number;
  label?: string;
};

/**
 * Repère visuel « où l’on est » dans la journée sur un rail horizontal (soft neumorphisme).
 */
export function TimeIndicator({
  rangeStartMin,
  rangeEndMin,
  label,
}: Props) {
  const theme = useTheme();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTick((t) => t + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const span = Math.max(1, rangeEndMin - rangeStartMin);
  const raw = (nowMin - rangeStartMin) / span;
  const position = Math.min(1, Math.max(0, raw));

  return (
    <View style={[styles.wrap, { width: '100%' }]}>
      {label ? (
        <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.track,
          {
            backgroundColor: theme.colors.surfaceVariant,
            borderColor: theme.colors.outlineVariant,
          },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${position * 100}%`,
              backgroundColor: theme.colors.primary,
              opacity: 0.35,
            },
          ]}
        />
        <View
          style={[
            styles.cursor,
            {
              left: `${position * 100}%`,
              backgroundColor: theme.colors.secondary,
              borderColor: theme.colors.background,
            },
          ]}
        />
      </View>
      <Text style={[styles.time, { color: theme.colors.onSurface }]}>
        {`${pad(now.getHours())}:${pad(now.getMinutes())}`}
      </Text>
    </View>
  );
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  label: { fontSize: 12, marginBottom: 6, fontWeight: '500' },
  track: {
    height: 12,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 8,
  },
  cursor: {
    position: 'absolute',
    marginLeft: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    top: -2,
    borderWidth: 2,
  },
  time: {
    marginTop: 6,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    alignSelf: 'flex-end',
  },
});
