import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DesignTokens } from '../../theme/TalkThemeRegistry';
import type { HubBlock } from './buildLivingHubBlocks';
import { LivingHubBlockShell } from './LivingHubBlockShell';

type Props = {
  visible: boolean;
  title: string;
  blocks: HubBlock[];
  totalCount: number;
  designTokens: DesignTokens;
  accentColor: string;
  errorColor: string;
  onClose: () => void;
  onPressBlock?: (block: HubBlock) => void;
  onPressLine?: (rowId: string) => void;
  onClearAll?: () => void;
  clearAllLabel?: string;
  emptyMessage: string;
  closeLabel: string;
  variant?: 'default' | 'routine';
};

/** Vue catégories hub (Box / Routines) — même rendu que le corps EMAIL_HUB. */
export function LivingHubCategoryModal({
  visible,
  title,
  blocks,
  totalCount,
  designTokens,
  accentColor,
  errorColor,
  onClose,
  onPressBlock,
  onPressLine,
  onClearAll,
  clearAllLabel,
  emptyMessage,
  closeLabel,
  variant = 'default',
}: Props) {
  const insets = useSafeAreaInsets();
  const showClearAll = variant === 'default' && totalCount > 0 && onClearAll && clearAllLabel;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { paddingTop: insets.top + 8 }]}>
        <View
          style={[
            designTokens.cardShadowStyle,
            styles.sheet,
            {
              backgroundColor: designTokens.backgroundColor,
              borderColor: `${designTokens.accentColor}44`,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: designTokens.textPrimary }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: accentColor, fontWeight: '700' }}>{closeLabel}</Text>
            </Pressable>
          </View>

          {blocks.length === 0 ? (
            <Text style={[styles.empty, { color: designTokens.textSecondary }]}>{emptyMessage}</Text>
          ) : (
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {blocks.map((block) => (
                <View key={block.categoryId} style={styles.blockWrap}>
                  <LivingHubBlockShell
                    block={block}
                    designTokens={designTokens}
                    variant={variant}
                    onPress={onPressBlock ? () => onPressBlock(block) : undefined}
                    onPressLine={onPressLine}
                  />
                </View>
              ))}
            </ScrollView>
          )}

          {showClearAll ? (
            <Pressable
              onPress={onClearAll}
              style={[
                styles.clearAllBtn,
                {
                  borderColor: errorColor,
                  borderRadius: designTokens.borderRadius * 0.5,
                },
              ]}
            >
              <Text style={{ color: errorColor, fontWeight: '800', textAlign: 'center' }}>{clearAllLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: '92%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 20, fontWeight: '800' },
  scroll: { maxHeight: 520 },
  blockWrap: { marginBottom: 10 },
  empty: { fontSize: 14, paddingVertical: 24, textAlign: 'center' },
  clearAllBtn: {
    marginTop: 12,
    borderWidth: 1.5,
    paddingVertical: 14,
  },
});
