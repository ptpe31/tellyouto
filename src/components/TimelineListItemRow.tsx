import { CalendarCheck } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
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
          <Text style={[styles.createdMeta, { color: theme.colors.onSurfaceVariant }]}>
            {createdCaption}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncBadgeText: { color: '#0ea5a4', fontSize: 11, fontWeight: '700' },
});
