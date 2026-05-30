import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HabitOccurrenceState, HabitStreakData } from './getHabitStreakData';

type Props = {
  data: HabitStreakData;
  accentColor: string;
  mutedColor: string;
};

function OccurrenceSquare({
  state,
  accentColor,
  mutedColor,
}: {
  state: HabitOccurrenceState;
  accentColor: string;
  mutedColor: string;
}) {
  if (state === 'skip') {
    return <View style={[styles.square, styles.squareSkip, { backgroundColor: mutedColor }]} />;
  }
  if (state === 'today') {
    return <View style={[styles.square, { borderWidth: 2, borderColor: accentColor, backgroundColor: 'transparent' }]} />;
  }
  if (state === 'done') {
    return <View style={[styles.square, { backgroundColor: accentColor }]} />;
  }
  return <View style={[styles.square, { backgroundColor: mutedColor, opacity: 0.45 }]} />;
}

/** Semainier compact : cases d'occurrence + 🔥 {count}. */
export function HabitStreakCompact({ data, accentColor, mutedColor }: Props) {
  if (!data.history.length && data.streakCount <= 0) return null;

  return (
    <View style={styles.row}>
      <View style={styles.squares}>
        {data.history.map((state, index) => (
          <OccurrenceSquare key={`${state}-${index}`} state={state} accentColor={accentColor} mutedColor={mutedColor} />
        ))}
      </View>
      {data.streakCount > 0 ? (
        <Text style={[styles.count, { color: accentColor }]} numberOfLines={1}>
          🔥 {data.streakCount}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  squares: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    flexWrap: 'wrap',
    gap: 4,
  },
  square: {
    width: 14,
    height: 14,
    borderRadius: 4,
  },
  squareSkip: {
    opacity: 0.2,
  },
  count: {
    fontSize: 12,
    fontWeight: '800',
    minWidth: 28,
    textAlign: 'right',
  },
});
