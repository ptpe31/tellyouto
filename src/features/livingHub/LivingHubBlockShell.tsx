import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { DesignTokens } from '../../theme/TalkThemeRegistry';
import type { HubBlock } from './buildLivingHubBlocks';

type Props = {
  block: HubBlock;
  designTokens: DesignTokens;
  onPress: () => void;
};

function formatTimeHm(hm: string): string {
  const [h, m] = hm.split(':');
  return `${h}h${m}`;
}

/** Bloc catégorie IA — lignes avec heure et marqueur habitude inline. */
export function LivingHubBlockShell({ block, designTokens, onPress }: Props) {
  const { t } = useTranslation();
  const categoryLabel = t(`category.${block.categoryId}`, { defaultValue: block.categoryId }).toUpperCase();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        designTokens.cardShadowStyle,
        styles.shell,
        {
          borderRadius: designTokens.borderRadius,
          backgroundColor: designTokens.cardBackground,
          borderColor: `${designTokens.accentColor}55`,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.emoji}>{block.emoji}</Text>
        <Text style={[styles.title, { color: designTokens.textPrimary }]} numberOfLines={2}>
          {categoryLabel}
        </Text>
        <View style={[styles.countBadge, { backgroundColor: `${designTokens.accentColor}22` }]}>
          <Text style={[styles.countText, { color: designTokens.accentColor }]}>{block.items.length}</Text>
        </View>
      </View>

      <View style={styles.lineStack}>
        {block.lines.map((line) => {
          const prefix = line.timeHm ? `${formatTimeHm(line.timeHm)} • ` : '';
          const habitSuffix = line.isHabit ? ' 🔁' : '';
          return (
            <View key={line.rowId} style={styles.lineRow}>
              <Text style={[styles.bullet, { color: designTokens.accentColor }]}>•</Text>
              <Text style={[styles.lineText, { color: designTokens.textPrimary }]} numberOfLines={2}>
                {prefix}
                {line.title}
                {habitSuffix}
              </Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emoji: {
    fontSize: 20,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  countBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    fontSize: 13,
    fontWeight: '800',
  },
  lineStack: {
    gap: 6,
    paddingLeft: 4,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingLeft: 24,
  },
  bullet: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  lineText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
  },
});
