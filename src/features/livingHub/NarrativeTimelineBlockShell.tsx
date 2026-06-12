import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { DesignTokens } from '../../theme/TalkThemeRegistry';
import type { NarrativeTimelineBlock } from './buildNarrativeTimelineBlocks';
import { timeSegmentDisplayTitle } from './timeSegmentRegistry';

const SUBTITLE_INDENT = 30;

type Props = {
  block: NarrativeTimelineBlock;
  designTokens: DesignTokens;
  onPress?: () => void;
  isPast?: boolean;
};

function formatTimeHm(hm: string): string {
  const [h, m] = hm.split(':');
  return `${h}h${m}`;
}

export function NarrativeTimelineBlockShell({ block, designTokens, onPress, isPast = false }: Props) {
  const { t } = useTranslation();
  const segmentLabel = timeSegmentDisplayTitle(block.segmentId, t).toUpperCase();
  const textPrimary = isPast ? designTokens.textSecondary : designTokens.textPrimary;
  const textMuted = `${designTokens.textSecondary}${isPast ? '99' : 'CC'}`;

  const shellContent = (
    <>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: textPrimary }]} numberOfLines={1}>
          {segmentLabel}
        </Text>
        <View style={[styles.progressBadge, { backgroundColor: `${designTokens.accentColor}22` }]}>
          <Text style={[styles.progressText, { color: designTokens.accentColor }]}>
            {t('timeline.narrativeTimeline.progress', {
              done: block.doneCount,
              total: block.totalCount,
            })}
          </Text>
        </View>
      </View>

      <View style={styles.lineStack}>
        {block.lines.map((line) => {
          const prefix = line.timeHm ? `${formatTimeHm(line.timeHm)} • ` : '';
          const habitSuffix = line.isHabit ? ' 🔁' : '';
          const showDaysBadge =
            block.segmentId === 'REMINDER' && line.daysUntil !== null && Number.isFinite(line.daysUntil);
          return (
            <View key={line.rowId} style={styles.itemBlock}>
              <View style={styles.lineRow}>
                <Text style={[styles.bullet, { color: designTokens.accentColor }]}>•</Text>
                <Text style={[styles.lineText, { color: textPrimary }]} numberOfLines={2}>
                  {prefix}
                  {line.title}
                  {habitSuffix}
                </Text>
                {showDaysBadge ? (
                  <View style={[styles.daysBadge, { backgroundColor: `${designTokens.accentColor}22` }]}>
                    <Text style={[styles.daysBadgeText, { color: designTokens.accentColor }]}>
                      {t('timeline.narrativeTimeline.daysBadge', { days: line.daysUntil })}
                    </Text>
                  </View>
                ) : null}
              </View>
              {line.subtitle ? (
                <Text
                  style={[styles.subtitleText, { color: textMuted, marginLeft: SUBTITLE_INDENT }]}
                  numberOfLines={2}
                >
                  📍 {line.subtitle}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </>
  );

  const shellBaseStyle = {
    borderRadius: designTokens.borderRadius,
    backgroundColor: isPast ? `${designTokens.cardBackground}CC` : designTokens.cardBackground,
    borderColor: `${designTokens.accentColor}${isPast ? '33' : '55'}`,
    opacity: isPast ? 0.72 : 1,
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        designTokens.cardShadowStyle,
        styles.shell,
        shellBaseStyle,
        pressed && {
          opacity: (isPast ? 0.72 : 1) * designTokens.pressedOpacity,
          transform: [{ scale: designTokens.pressedScale }],
        },
      ]}
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
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  progressBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
  },
  lineStack: {
    gap: 10,
    paddingLeft: 4,
  },
  itemBlock: {
    gap: 2,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingLeft: 4,
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
  daysBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 1,
  },
  daysBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subtitleText: {
    fontSize: 12,
    lineHeight: 17,
  },
});
