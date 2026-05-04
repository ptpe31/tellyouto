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

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function hasTruthyRecurrence(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  const rr = str(meta, 'recurrence_rrule');
  if (rr) return true;
  const rec = meta.recurrence;
  if (rec && typeof rec === 'object' && !Array.isArray(rec) && Object.keys(rec as object).length > 0) return true;
  const cadence = str(meta, 'cadenceDescription');
  if (cadence) return true;
  const recurringTask = meta.recurring_task;
  if (recurringTask && typeof recurringTask === 'object' && !Array.isArray(recurringTask)) return true;
  const trip = meta.trip;
  if (trip && typeof trip === 'object' && !Array.isArray(trip)) {
    const tr = trip as Record<string, unknown>;
    const tripRec = tr.recurrence;
    if (tripRec && typeof tripRec === 'object' && !Array.isArray(tripRec) && Object.keys(tripRec as object).length > 0) return true;
    const tripCadence = str(tr, 'cadenceDescription');
    if (tripCadence) return true;
    const tripRRule = str(tr, 'recurrence_rrule');
    if (tripRRule) return true;
  }
  return false;
}

function parseHm(raw: string | null): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [hh, mm] = s.split(':').map((n) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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
    const meta = safeParseJsonObject(row.metadata_json);
    const trip = meta && meta.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip) ? (meta.trip as Record<string, unknown>) : null;
    const loc = i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const now = new Date();
    const todayKey = formatYmdLocal(now);
    const tomorrowKey = addDaysYmd(now, 1);

    const rootDueIso = str(meta, 'dueDateTime');
    const rootYmd = str(meta, 'dueDateYmd');
    const rootHm = parseHm(str(meta, 'dueTimeHm'));

    const tripArrivalIso = str(trip, 'arrivalDue');
    const tripDueIso = str(trip, 'dueDateTime');
    const tripYmd = str(trip, 'dueDateYmd');
    const tripHm = parseHm(str(trip, 'dueTimeHm'));

    const baseParsed = parseDueDate(row.due_date);
    const isoSource = row.type === 'TASK' && trip ? tripArrivalIso || tripDueIso : rootDueIso;
    const parsedIso = isoSource ? parseDueDate(isoSource) : rootDueIso ? parseDueDate(rootDueIso) : null;
    const dateRef =
      parsedIso?.date ??
      (tripYmd ? parseDueDate(tripYmd)?.date : null) ??
      (rootYmd ? parseDueDate(rootYmd)?.date : null) ??
      baseParsed?.date ??
      null;
    if (!dateRef) return null;
    const dueKey = formatYmdLocal(dateRef);
    const dayLabel =
      dueKey === todayKey
        ? t('horizons.today')
        : dueKey === tomorrowKey
          ? t('horizons.tomorrow')
          : capitalizeFirst(new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(dateRef));
    const isoTimeLabel =
      parsedIso?.hasTime && parsedIso.date
        ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsedIso.date)
        : null;
    const baseTimeLabel =
      baseParsed?.hasTime && baseParsed.date
        ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(baseParsed.date)
        : null;
    const timeLabel =
      row.type === 'TASK' && trip
        ? tripHm || isoTimeLabel || rootHm || baseTimeLabel || t('timeline.allDuration')
        : rootHm || baseTimeLabel || t('timeline.allDuration');
    const showRecurrence = hasTruthyRecurrence(meta) || row.type === 'HABIT';
    return { dayLabel, timeLabel, showRecurrence };
  }, [i18n.language, row.due_date, row.metadata_json, row.type, t]);

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
            <View style={styles.subtitleRow}>
              <Text
                style={[styles.subtitle, styles.subtitleLead, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}
              >
                {subtitle.dayLabel} •
              </Text>
              {subtitle.showRecurrence ? (
                <View pointerEvents="none" style={styles.subtitleIconWrap}>
                  <IconButton icon="repeat" size={14} iconColor={theme.colors.onSurfaceVariant} style={styles.subtitleIcon} />
                </View>
              ) : null}
              <Text style={[styles.subtitle, styles.subtitleTail, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                {subtitle.timeLabel}
              </Text>
            </View>
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
  subtitleRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  subtitleLead: { marginTop: 0, flexShrink: 0 },
  subtitleIconWrap: { marginLeft: 4, marginRight: 2 },
  subtitleIcon: { margin: 0, padding: 0 },
  subtitleTail: { marginTop: 0, flexShrink: 1, minWidth: 0 },
});
