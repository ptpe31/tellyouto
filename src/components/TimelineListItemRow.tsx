import { CalendarCheck } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MD3Theme } from 'react-native-paper';

import type { TrankilV2ChildTaskStats, TrankilV2TimelineItemRow } from '../api';
import { TaskCompletionOrb } from './TaskCompletionOrb';

export type TimelineListItemRowProps = {
  row: TrankilV2TimelineItemRow;
  listKey: string;
  dimmed?: boolean;
  theme: MD3Theme;
  titleText: string;
  badgeLabel: string;
  projectSuffix: string | null;
  createdCaption: string;
  isPro: boolean;
  showCompleteOrb: boolean;
  /** Clé pour lire `childStats` (id tâche racine ou id projet). */
  progressLookupId: string | null;
  childStats: Map<string, TrankilV2ChildTaskStats>;
  pendingLocalDone: boolean;
  onToggleComplete: () => void;
  offlineAiChipLabel?: string | null;
  onRetryAiSort?: () => void;
  retryAiSortBusy?: boolean;
};

function statsForLookup(
  map: Map<string, TrankilV2ChildTaskStats>,
  key: string | null,
): TrankilV2ChildTaskStats | undefined {
  if (!key) return undefined;
  return map.get(key);
}

export function TimelineListItemRow({
  row,
  listKey,
  dimmed,
  theme,
  titleText,
  badgeLabel,
  projectSuffix,
  createdCaption,
  isPro,
  showCompleteOrb,
  progressLookupId,
  childStats,
  pendingLocalDone,
  onToggleComplete,
  offlineAiChipLabel,
  onRetryAiSort,
  retryAiSortBusy,
}: TimelineListItemRowProps) {
  const { t } = useTranslation();
  const st = statsForLookup(childStats, progressLookupId);
  const total = st?.total ?? 0;
  const done = st?.done ?? 0;
  const hasBreakdown = total > 0;
  const progress = hasBreakdown ? Math.min(1, done / total) : 0;
  const showArc = hasBreakdown && !pendingLocalDone;

  const titleStyle = pendingLocalDone
    ? [styles.cardTitle, styles.titleDone, { color: theme.colors.onSurfaceVariant }]
    : [styles.cardTitle, { color: theme.colors.onSurface }];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.outlineVariant,
          opacity: dimmed ? 0.78 : 1,
        },
      ]}
    >
      <View style={styles.cardMainRow}>
        {showCompleteOrb ? (
          <TaskCompletionOrb
            theme={theme}
            progress={progress}
            hasChildBreakdown={showArc}
            accentColor={theme.colors.primary}
            pendingComplete={pendingLocalDone}
            onPress={onToggleComplete}
            accessibilityLabel={t('timeline.a11yTaskComplete')}
          />
        ) : null}
        <View style={[styles.cardBody, pendingLocalDone && styles.bodyMuted]}>
          <View style={styles.cardTitleRow}>
            <Text style={titleStyle} numberOfLines={3}>
              {titleText}
            </Text>
            {row.is_dirty === 1 ? <View style={styles.dirtyDot} /> : null}
            {isPro && row.is_synced_calendar === 1 ? (
              <View style={styles.syncBadge}>
                <CalendarCheck size={listKey === 'archives' ? 16 : 14} color="#0ea5a4" />
                {listKey === 'archives' ? (
                  <Text style={styles.syncBadgeText}>{t('timeline.syncedBadge')}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
            {badgeLabel}
            {projectSuffix ? ` • ${projectSuffix}` : ''}
          </Text>
          {offlineAiChipLabel ? (
            <View style={styles.offlineChipWrap}>
              <Text style={[styles.offlineChip, { borderColor: '#008080', color: '#006666' }]}>
                {offlineAiChipLabel}
              </Text>
            </View>
          ) : null}
          {onRetryAiSort ? (
            <Pressable
              accessibilityRole="button"
              onPress={onRetryAiSort}
              disabled={retryAiSortBusy}
              style={({ pressed }) => [
                styles.retryBtn,
                {
                  opacity: retryAiSortBusy ? 0.55 : pressed ? 0.85 : 1,
                  borderColor: '#FF8C00',
                  backgroundColor: 'rgba(255, 140, 0, 0.12)',
                },
              ]}
            >
              <Text style={[styles.retryBtnText, { color: '#cc7000' }]}>
                {retryAiSortBusy ? '…' : t('timeline.retryAiSort')}
              </Text>
            </Pressable>
          ) : null}
          <Text style={[styles.createdMeta, { color: theme.colors.onSurfaceVariant }]}>
            {createdCaption}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  offlineChipWrap: { marginTop: 6, alignSelf: 'flex-start' },
  offlineChip: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  retryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  retryBtnText: { fontSize: 12, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8 },
  cardMainRow: { flexDirection: 'row', alignItems: 'flex-start' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4, flex: 1 },
  titleDone: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  bodyMuted: { opacity: 0.55 },
  createdMeta: { fontSize: 11, marginTop: 6 },
  dirtyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f59e0b' },
  syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncBadgeText: { color: '#0ea5a4', fontSize: 11, fontWeight: '700' },
});
