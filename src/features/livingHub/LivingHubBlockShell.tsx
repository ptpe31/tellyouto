import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { DesignTokens } from '../../theme/TalkThemeRegistry';
import type { HubBlock } from './buildLivingHubBlocks';
import { HabitStreakCompact } from './HabitStreakCompact';
import type { RoutineHubItemLine } from './formatRoutineItemLine';

type Props = {
  block: HubBlock;
  designTokens: DesignTokens;
  onPress?: () => void;
  variant?: 'default' | 'routine';
};

function formatTimeHm(hm: string): string {
  const [h, m] = hm.split(':');
  return `${h}h${m}`;
}

function RoutineLinePreview({ line, designTokens }: { line: RoutineHubItemLine; designTokens: DesignTokens }) {
  return (
    <View style={styles.routineItem}>
      <View style={[styles.lineRow, styles.routineLineRow]}>
        <Text style={[styles.bullet, { color: designTokens.accentColor }]}>•</Text>
        <View style={styles.routineLineBody}>
          <Text style={[styles.lineText, { color: designTokens.textPrimary }]} numberOfLines={2}>
            {line.title}
            <Text style={[styles.cadenceText, { color: designTokens.textSecondary }]}>
              {' '}
              • {line.cadenceLabel}
            </Text>
          </Text>
          {line.trackStreak && line.streakData ? (
            <HabitStreakCompact
              data={line.streakData}
              accentColor={designTokens.accentColor}
              mutedColor={`${designTokens.textSecondary}33`}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function hubShellStyle(
  designTokens: DesignTokens,
  base: {
    borderRadius: number;
    backgroundColor: string;
    borderColor: string;
  },
  pressed: boolean,
) {
  return [
    designTokens.cardShadowStyle,
    styles.shell,
    base,
    pressed && {
      opacity: designTokens.pressedOpacity,
      transform: [{ scale: designTokens.pressedScale }],
    },
  ];
}

/** Bloc catégorie IA — lignes avec heure et marqueur habitude inline. */
export function LivingHubBlockShell({ block, designTokens, onPress, variant = 'default' }: Props) {
  const { t } = useTranslation();
  const categoryLabel = t(`category.${block.categoryId}`, { defaultValue: block.categoryId }).toUpperCase();
  const isRoutine = variant === 'routine';
  const routineLines = block.routineLines ?? [];

  const shellContent = (
    <>
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
        {isRoutine
          ? routineLines.map((line) => <RoutineLinePreview key={line.rowId} line={line} designTokens={designTokens} />)
          : block.lines.map((line) => {
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
    </>
  );

  const shellBaseStyle = {
    borderRadius: designTokens.borderRadius,
    backgroundColor: designTokens.cardBackground,
    borderColor: `${designTokens.accentColor}55`,
  };

  if (isRoutine && onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => hubShellStyle(designTokens, shellBaseStyle, pressed)}
      >
        {shellContent}
      </Pressable>
    );
  }

  if (isRoutine) {
    return (
      <View
        style={[
          designTokens.cardShadowStyle,
          styles.shell,
          {
            borderRadius: designTokens.borderRadius,
            backgroundColor: designTokens.cardBackground,
            borderColor: `${designTokens.accentColor}55`,
          },
        ]}
      >
        {shellContent}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => hubShellStyle(designTokens, shellBaseStyle, pressed)}
    >
      {shellContent}
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
    gap: 8,
    paddingLeft: 4,
  },
  routineItem: {
    paddingLeft: 20,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingLeft: 4,
  },
  routineLineRow: {
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  routineLineBody: {
    flex: 1,
  },
  bullet: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    marginTop: 1,
  },
  lineText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
  },
  cadenceText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
