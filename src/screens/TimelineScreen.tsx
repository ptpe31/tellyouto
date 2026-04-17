import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { CalendarCheck, CalendarDays } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listArchivedIntentions,
  listTrankilV2TimelineItemsByDate,
  type TrankilIntentStatus,
  type TrankilV2TimelineDateMode,
  type TrankilV2TimelineItemRow,
} from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { generateSmartTitle } from '../services/smartTitle';

type QuickRange = 'TODAY' | 'TOMORROW' | 'WEEK';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function labelShort(date: Date): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || undefined;
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit' }).format(date);
  } catch {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
  }
}

function buildDateStrip(center: Date, total: number = 15): Date[] {
  const half = Math.floor(total / 2);
  return Array.from({ length: total }, (_, idx) => addDays(center, idx - half));
}

function sectionTitle(section: TrankilV2TimelineItemRow['section']): string {
  if (section === 'TASK_HABIT') return 'timeline.sectionTaskHabit';
  if (section === 'PROJECT_SUBTASK') return 'timeline.sectionProjectSubtasks';
  return 'timeline.sectionNoteAudio';
}

function resolveDisplayTitle(row: TrankilV2TimelineItemRow): string {
  const base = String(row.display_title || '').trim();
  if (base) return base;
  if (row.type === 'NOTE' || row.type === 'AUDIO') {
    return generateSmartTitle(row.content_raw || '') || (row.type === 'AUDIO' ? 'timeline.memoAudio' : 'timeline.note');
  }
  return 'timeline.untitled';
}

function typeBadge(type: TrankilV2TimelineItemRow['type']): string {
  if (type === 'AUDIO') return 'timeline.badgeAudio';
  if (type === 'NOTE') return 'timeline.badgeNote';
  if (type === 'HABIT') return 'timeline.badgeHabit';
  if (type === 'TASK') return 'timeline.badgeTask';
  return 'timeline.badgeProject';
}

export function TimelineScreen() {
  const { t } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [statusFilter, setStatusFilter] = useState<TrankilIntentStatus>('TODO');
  const [dateMode, setDateMode] = useState<TrankilV2TimelineDateMode>('DAY');
  const [items, setItems] = useState<TrankilV2TimelineItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [archivedItems, setArchivedItems] = useState<TrankilV2TimelineItemRow[]>([]);

  const selectedYmd = useMemo(() => toYmd(selectedDate), [selectedDate]);

  const load = useCallback(
    async (date: Date, status: TrankilIntentStatus, mode: TrankilV2TimelineDateMode) => {
      setLoading(true);
      try {
        const rows = await listTrankilV2TimelineItemsByDate(toYmd(date), status, mode);
        setItems(rows);
        const archived = await listArchivedIntentions(120);
        setArchivedItems(archived);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void load(selectedDate, statusFilter, dateMode);
    }, [dateMode, load, selectedDate, statusFilter]),
  );

  const stripDates = useMemo(() => buildDateStrip(selectedDate), [selectedDate]);

  const grouped = useMemo(() => {
    const taskHabit = items.filter((item) => item.section === 'TASK_HABIT');
    const projectSubtasks = items.filter((item) => item.section === 'PROJECT_SUBTASK');
    const noteAudio = items.filter((item) => item.section === 'NOTE_AUDIO');
    return [
      { key: 'TASK_HABIT' as const, rows: taskHabit },
      { key: 'PROJECT_SUBTASK' as const, rows: projectSubtasks },
      { key: 'NOTE_AUDIO' as const, rows: noteAudio },
      { key: 'ARCHIVED_EXPORTS' as const, rows: archivedItems },
    ];
  }, [archivedItems, items]);

  const onQuickSelect = (range: QuickRange) => {
    const now = new Date();
    if (range === 'TODAY') {
      setSelectedDate(now);
      setDateMode('DAY');
      return;
    }
    if (range === 'TOMORROW') {
      setSelectedDate(addDays(now, 1));
      setDateMode('DAY');
      return;
    }
    setSelectedDate(now);
    setDateMode('WEEK');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={grouped}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headTitleRow}>
              <CalendarDays color={theme.colors.primary} size={20} />
              <Text style={[styles.title, { color: theme.colors.onBackground }]}>{t('tabs.timeline')}</Text>
            </View>

            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={stripDates}
              keyExtractor={(d) => toYmd(d)}
              contentContainerStyle={styles.dateStrip}
              renderItem={({ item }) => {
                const ymd = toYmd(item);
                const selected = ymd === selectedYmd;
                return (
                  <Pressable
                    onPress={() => {
                      setSelectedDate(item);
                      setDateMode('DAY');
                    }}
                    style={[
                      styles.dateChip,
                      {
                        backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceVariant,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: selected ? theme.colors.onPrimary : theme.colors.onSurfaceVariant,
                        fontWeight: selected ? '700' : '500',
                      }}
                    >
                      {labelShort(item)}
                    </Text>
                  </Pressable>
                );
              }}
            />

            <View style={styles.quickRow}>
              <Pressable
                style={[styles.quickBtn, { borderColor: theme.colors.outline }]}
                onPress={() => onQuickSelect('TODAY')}
              >
                <Text style={{ color: theme.colors.onSurface }}>{t('horizons.today')}</Text>
              </Pressable>
              <Pressable
                style={[styles.quickBtn, { borderColor: theme.colors.outline }]}
                onPress={() => onQuickSelect('TOMORROW')}
              >
                <Text style={{ color: theme.colors.onSurface }}>{t('horizons.tomorrow')}</Text>
              </Pressable>
              <Pressable
                style={[styles.quickBtn, { borderColor: theme.colors.outline }]}
                onPress={() => onQuickSelect('WEEK')}
              >
                <Text style={{ color: theme.colors.onSurface }}>{t('horizons.thisWeek')}</Text>
              </Pressable>
            </View>

            <View style={styles.filterRow}>
              <Pressable
                onPress={() => setStatusFilter('TODO')}
                style={[
                  styles.filterToggle,
                  {
                    backgroundColor:
                      statusFilter === 'TODO' ? theme.colors.primary : theme.colors.surfaceVariant,
                  },
                ]}
              >
                <Text
                  style={{
                    color: statusFilter === 'TODO' ? theme.colors.onPrimary : theme.colors.onSurface,
                    fontWeight: '600',
                  }}
                >
                  {t('timeline.todoFilter')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setStatusFilter('DONE')}
                style={[
                  styles.filterToggle,
                  {
                    backgroundColor:
                      statusFilter === 'DONE' ? theme.colors.primary : theme.colors.surfaceVariant,
                  },
                ]}
              >
                <Text
                  style={{
                    color: statusFilter === 'DONE' ? theme.colors.onPrimary : theme.colors.onSurface,
                    fontWeight: '600',
                  }}
                >
                  {t('timeline.doneFilter')}
                </Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
              {item.key === 'ARCHIVED_EXPORTS'
                ? t('timeline.sectionArchivedExports')
                : t(sectionTitle(item.key as TrankilV2TimelineItemRow['section']))}
            </Text>
            {item.rows.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('timeline.noItems')}</Text>
            ) : (
              item.rows.map((row) => (
                <View
                  key={row.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.outlineVariant,
                    },
                  ]}
                >
                  <View style={styles.cardTitleRow}>
                    <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
                      {t(resolveDisplayTitle(row))}
                    </Text>
                    {spectrum.isProUser && row.is_synced_calendar === 1 ? (
                      <View style={styles.syncBadge}>
                        <CalendarCheck size={item.key === 'ARCHIVED_EXPORTS' ? 16 : 14} color="#0ea5a4" />
                        {item.key === 'ARCHIVED_EXPORTS' ? (
                          <Text style={styles.syncBadgeText}>{t('timeline.syncedBadge')}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                    {t(typeBadge(row.type))}
                    {row.section === 'PROJECT_SUBTASK' && row.project_title
                      ? ` • ${t('timeline.projectPrefix')}: ${row.project_title}`
                      : ''}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              {loading ? t('stats.loading') : t('timeline.noContentForDate')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  headTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  dateStrip: { paddingBottom: 8, gap: 8 },
  dateChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  quickRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  quickBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  filterToggle: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  section: { paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncBadgeText: { color: '#0ea5a4', fontSize: 11, fontWeight: '700' },
  emptyWrap: { paddingHorizontal: 16, paddingVertical: 20 },
});
