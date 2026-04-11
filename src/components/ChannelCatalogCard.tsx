import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import { NeumorphicSurface } from './NeumorphicSurface';
import { neumorphicRaised } from '../theme/neumorphism';

const GOLD = '#C9A227';
const GOLD_TEXT = '#1a1408';
const TEAL_ACTIVE = '#00897B';
const LED_GREEN = '#43A047';

type Props = {
  title: string;
  tagline: string;
  freeBadgeLabel?: string;
  recommendedBadgeLabel?: string;
  proBadgeLabel: string;
  /** Canal premium : affiche le badge PRO ; si true, aussi le cadenas (non abonné). */
  isPremiumChannel: boolean;
  showProLock: boolean;
  isActive: boolean;
  onPress: () => void;
  extraHint?: string;
  extraHintColor?: string;
};

export function ChannelCatalogCard({
  title,
  tagline,
  freeBadgeLabel,
  recommendedBadgeLabel,
  proBadgeLabel,
  isPremiumChannel,
  showProLock,
  isActive,
  onPress,
  extraHint,
  extraHintColor,
}: Props) {
  const theme = useTheme();
  const raised = neumorphicRaised(theme);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ marginBottom: 12, opacity: pressed ? 0.92 : 1 }]}
    >
      <View
        style={[
          raised,
          styles.card,
          {
            borderWidth: isActive ? 2 : 1,
            borderColor: isActive ? TEAL_ACTIVE : theme.colors.outline,
          },
        ]}
      >
        <View style={styles.headRow}>
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: theme.colors.onSurface }]}>
                {title}
              </Text>
              {isActive ? (
                <View
                  style={[styles.led, { backgroundColor: LED_GREEN }]}
                  accessibilityLabel="active-channel"
                />
              ) : null}
            </View>
            <Text
              style={[styles.tagline, { color: theme.colors.onSurfaceVariant }]}
            >
              {tagline}
            </Text>
            {extraHint ? (
              <Text
                style={[
                  styles.extraHint,
                  { color: extraHintColor ?? theme.colors.onSurfaceVariant },
                ]}
              >
                {extraHint}
              </Text>
            ) : null}
          </View>
          <View style={styles.rightBadges}>
            {isPremiumChannel ? (
              <>
                <View style={[styles.proGold, { borderColor: GOLD }]}>
                  <Text style={[styles.proGoldText, { color: GOLD_TEXT }]}>
                    {proBadgeLabel}
                  </Text>
                </View>
                {showProLock ? (
                  <NeumorphicSurface style={styles.lockChip}>
                    <Text style={styles.lockEmoji}>🔒</Text>
                  </NeumorphicSurface>
                ) : null}
              </>
            ) : null}
          </View>
        </View>

        {freeBadgeLabel || recommendedBadgeLabel ? (
          <View style={styles.pillRow}>
            {freeBadgeLabel ? (
              <View
                style={[
                  styles.pill,
                  { backgroundColor: theme.colors.secondaryContainer },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: theme.colors.onSecondaryContainer },
                  ]}
                >
                  {freeBadgeLabel}
                </Text>
              </View>
            ) : null}
            {recommendedBadgeLabel ? (
              <View style={[styles.pill, { backgroundColor: TEAL_ACTIVE }]}>
                <Text style={[styles.pillText, { color: '#fff' }]}>
                  {recommendedBadgeLabel}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 16,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  led: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  tagline: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  extraHint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  rightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  proGold: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(201, 162, 39, 0.22)',
  },
  proGoldText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  lockChip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 10,
  },
  lockEmoji: { fontSize: 14 },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, fontWeight: '700' },
});
