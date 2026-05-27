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

/** Bloc thématique style email — titre, compteur, 2 puces prioritaires. */
export function LivingHubBlockShell({ block, designTokens, onPress }: Props) {
  const { t } = useTranslation();
  const count = block.items.length;
  const isEmpty = count === 0;

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
          {t(block.titleI18nKey)}
        </Text>
        {!isEmpty ? (
          <View style={[styles.countBadge, { backgroundColor: `${designTokens.accentColor}22` }]}>
            <Text style={[styles.countText, { color: designTokens.accentColor }]}>{count}</Text>
          </View>
        ) : null}
      </View>

      {isEmpty ? (
        <Text style={[styles.emptyText, { color: designTokens.textSecondary }]}>
          {t(block.emptyI18nKey)}
        </Text>
      ) : (
        <View style={styles.previewStack}>
          {block.previewTitles.map((title) => (
            <View key={title} style={styles.previewRow}>
              <Text style={[styles.bullet, { color: designTokens.accentColor }]}>•</Text>
              <Text style={[styles.previewText, { color: designTokens.textPrimary }]} numberOfLines={1}>
                {title}
              </Text>
            </View>
          ))}
          {count > block.previewTitles.length ? (
            <Text style={[styles.moreText, { color: designTokens.textSecondary }]}>
              {t('livingHub.moreItems', { count: count - block.previewTitles.length })}
            </Text>
          ) : null}
        </View>
      )}
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
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  previewStack: {
    gap: 4,
    paddingLeft: 28,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bullet: {
    fontSize: 14,
    fontWeight: '800',
  },
  previewText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  moreText: {
    fontSize: 12,
    marginTop: 2,
    paddingLeft: 14,
  },
});
