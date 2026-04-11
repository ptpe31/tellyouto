import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';

import { subscribeTimeToInteractive } from '../services/performance';

/** Affiche le TTI approximatif uniquement en build __DEV__ (aucun hook en prod). */
export function StartupPerfBanner() {
  if (!__DEV__) {
    return null;
  }
  return <StartupPerfBannerInner />;
}

function StartupPerfBannerInner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    return subscribeTimeToInteractive(setMs);
  }, []);

  if (ms === null) {
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
