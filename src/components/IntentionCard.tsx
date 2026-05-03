import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { generateSmartTitle } from '../services/smartTitle';
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import { neumorphicRaised } from '../theme/neumorphism';

type Props = {
  row: TrankilV2TimelineItemRow;
  theme: MD3Theme;
  pendingLocalDone: boolean;
  enabled: boolean;
  onToggleComplete: () => void;
};

function parseDueDate(raw: string | null | undefined): { date: Date; hasTime: boolean } | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    const date = new Date(y, m - 1, d, 12, 0, 0, 0);
    return Number.isFinite(date.getTime()) ? { date, hasTime: false } : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map((n) => Number(n));
    const date = new Date(y, m - 1, d, 12, 0, 0, 0);
    return Number.isFinite(date.getTime()) ? { date, hasTime: false } : null;
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const hasTime = /T\d{2}:\d{2}/.test(value) || /\d{2}:\d{2}/.test(value);
  return { date: d, hasTime };
}

function capitalizeFirst(raw: string): string {
  if (!raw) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function getCategoryIcon(categoryId: string | null | undefined, type: TrankilV2TimelineItemRow['type']): string {
  const up = String(categoryId ?? '').trim().toUpperCase();
  if (up === 'SHOP') return 'cart-outline';
  if (up === 'HEALTH') return 'heart-pulse';
  if (up === 'WORK' || up === 'PRO') return 'briefcase-outline';
  if (up === 'TRAVEL') return 'airplane';
  if (up === 'SOCIAL') return 'account-group-outline';
  if (up === 'FINANCE') return 'cash-multiple';
  if (up === 'LEARN') return 'book-open-variant';
  if (up === 'HOME' || up === 'PERSO' || up === 'FAMILLE') return 'home-outline';
  if (up === 'OTHER') return 'dots-horizontal-circle-outline';
  if (type === 'LIST') return 'format-list-bulleted';
  if (type === 'HABIT') return 'repeat';
  if (type === 'NOTE') return 'note-text-outline';
  if (type === 'AUDIO') return 'microphone-outline';
  if (type === 'PROJECT') return 'rocket-launch-outline';
  return 'check-circle-outline';
}

export function IntentionCard({ row, theme, pendingLocalDone, enabled, onToggleComplete }: Props) {
  const { t, i18n } = useTranslation();

  const titleText = useMemo(() => {
    const fallback = String(row.display_title || '').trim();
    if (fallback) return fallback;
    const loc = i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const smart = generateSmartTitle(row.content_raw || '', loc);
    if (smart) return smart;
    if (row.type === 'AUDIO') return t('timeline.memoAudio');
    if (row.type === 'NOTE') return t('timeline.note');
    return t('timeline.untitled');
  }, [i18n.language, row.content_raw, row.display_title, row.type, t]);

  const subtitle = useMemo(() => {
    const parsed = parseDueDate(row.due_date);
    if (!parsed) return '';
    const due = parsed.date;
    const loc = i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const now = new Date();
    const todayKey = formatYmdLocal(now);
    const tomorrowKey = addDaysYmd(now, 1);
    const dueKey = formatYmdLocal(due);
    const dayLabel =
      dueKey === todayKey
        ? t('horizons.today')
        : dueKey === tomorrowKey
          ? t('horizons.tomorrow')
          : capitalizeFirst(new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(due));
    if (!parsed.hasTime) return dayLabel;
    const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(due);
    return `${dayLabel} • ${time}`;
  }, [i18n.language, row.due_date, t]);

  const categoryIcon = useMemo(() => getCategoryIcon(row.category_id, row.type), [row.category_id, row.type]);
  const circleIcon = pendingLocalDone ? 'check' : categoryIcon;
  const iconColor = pendingLocalDone ? '#065f46' : theme.colors.primary;

  const titleOpacity = pendingLocalDone ? 0.5 : 1;

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('timeline.a11yTaskComplete')}
          disabled={!enabled}
          onPress={enabled ? onToggleComplete : undefined}
          hitSlop={8}
          style={({ pressed }) => [
            neumorphicRaised(theme),
            styles.circle,
            { opacity: !enabled ? 0.45 : pressed ? 0.9 : 1 },
          ]}
        >
          <View pointerEvents="none">
            <IconButton icon={circleIcon} size={22} iconColor={iconColor} style={styles.circleIcon} />
          </View>
        </Pressable>

        <View style={styles.textCol}>
          <Text style={[styles.title, { color: theme.colors.onSurface, opacity: titleOpacity }]} numberOfLines={1}>
            {titleText}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const CIRCLE_SIZE = 54;

const styles = StyleSheet.create({
  card: {
    height: 105,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginHorizontal: 0,
    marginBottom: 12,
  },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  circle: { width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  circleIcon: { margin: 0 },
  textCol: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '800', lineHeight: 20 },
  subtitle: { marginTop: 4, fontSize: 13, fontWeight: '700', opacity: 0.88 },
});
