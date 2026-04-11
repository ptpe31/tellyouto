import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useTheme } from 'react-native-paper';

type Props = {
  message: string;
  eyebrow: string;
};

/**
 * Bulle de pensée légère — pas de modal, pas de CTA bloquant.
 */
export function AllyThoughtBubble({ message, eyebrow }: Props) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.colors.surfaceVariant,
          borderColor: theme.colors.outlineVariant,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${eyebrow}. ${message}`}
    >
      <View style={styles.row}>
        <Sparkles
          color={theme.colors.primary}
          size={16}
          style={styles.icon}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>
          {eyebrow}
        </Text>
      </View>
      <Text style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    opacity: 0.94,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  icon: { marginRight: 6 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  body: { fontSize: 13, lineHeight: 19 },
});
