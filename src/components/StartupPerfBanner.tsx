import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';

import { subscribeTimeToInteractive } from '../services/performance';

/** Affiche le TTI approximatif uniquement en build __DEV__. */
export function StartupPerfBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    if (!__DEV__) return undefined;
    return subscribeTimeToInteractive(setMs);
  }, []);

  if (!__DEV__ || ms === null) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          bottom: Math.max(8, insets.bottom + 4),
          backgroundColor: theme.colors.surfaceVariant,
        },
      ]}
    >
      <Text style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>
        TTI ~ {ms} ms
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    opacity: 0.92,
  },
  text: { fontSize: 11 },
});
