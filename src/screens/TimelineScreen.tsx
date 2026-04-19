import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { CalendarCheck, CalendarDays, PiggyBank } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listArchivedIntentions,
  listTrankilV2TimelineItemsByDate,
  listTrankilV2UndatedRootTasks,
  type TrankilIntentStatus,
  type TrankilV2TimelineDateMode,
  type TrankilV2TimelineItemRow,
} from '../api';
import { IdeaBankModal } from '../components/IdeaBankModal';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { generateSmartTitle } from '../services/smartTitle';
import { neumorphicRaised } from '../theme/neumorphism';

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

/** Texte affichable (contenu utilisateur ou clé i18n pour les titres dérivés). */
function resolveDisplayTitle(row: TrankilV2TimelineItemRow): string {
  const base = String(row.display_title || '').trim();
  if (base) return base;
  if (row.type === 'NOTE' || row.type === 'AUDIO') {
    return generateSmartTitle(row.content_raw || '') || (row.type === 'AUDIO' ? 'timeline.memoAudio' : 'timeline.note');
  }
  return 'timeline.untitled';
}

function displayHeading(textOrKey: string): string {
  if (
    textOrKey.startsWith('timeline.') ||
    textOrKey.startsWith('tabs.') ||
    textOrKey.startsWith('horizons.')
  ) {
    return textOrKey;
  }
  return '';
}

function typeBadge(type: TrankilV2TimelineItemRow['type']): string {
  if (type === 'AUDIO') return 'timeline.badgeAudio';
  if (type === 'NOTE') return 'timeline.badgeNote';
  if (type === 'HABIT') return 'timeline.badgeHabit';
  if (type === 'TASK') return 'timeline.badgeTask';
  return 'timeline.badgeProject';
}

function formatCreatedLine(createdAt: number, locale?: string): string {
  try {
    const d = new Date(createdAt);
    const loc = locale || Intl.DateTimeFormat().resolvedOptions().locale;
    return new Intl.DateTimeFormat(loc, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(d);
  } catch {
    return '';
  }
}

type RowSection = {
  kind: 'rows';
  listKey: string;
  titleKey: string;
  rows: TrankilV2TimelineItemRow[];
  dimmed?: boolean;
};

type IdeaBankEntry = {
  kind: 'ideaBank';
  listKey: 'ideaBank';
  count: number;
};

type ListEntry = RowSection | IdeaBankEntry;

export function TimelineScreen() {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [statusFilter, setStatusFilter] = useState<TrankilIntentStatus>('TODO');
  const [dateMode, setDateMode] = useState<TrankilV2TimelineDateMode>('DAY');
  const [items, setItems] = useState<TrankilV2TimelineItemRow[]>([]);
  const [undatedTasks, setUndatedTasks] = useState<TrankilV2TimelineItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [archivedItems, setArchivedItems] = useState<TrankilV2TimelineItemRow[]>([]);
  const [ideaBankOpen, setIdeaBankOpen] = useState(false);

  const selectedYmd = useMemo(() => toYmd(selectedDate), [selectedDate]);

  const load = useCallback(async (date: Date, status: TrankilIntentStatus, mode: TrankilV2TimelineDateMode) => {
    setLoading(true);
    try {
      const [rows, undated, archived] = await Promise.all([
        listTrankilV2TimelineItemsByDate(toYmd(date), status, mode),
        listTrankilV2UndatedRootTasks(status),
        listArchivedIntentions(120),
      ]);
      setItems(rows);
      setUndatedTasks(undated);
      setArchivedItems(archived);
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    void load(selectedDate, statusFilter, dateMode);
  }, [dateMode, load, selectedDate, statusFilter]);

  useFocusEffect(
    useCallback(() => {
      void load(selectedDate, statusFilter, dateMode);
    }, [dateMode, load, selectedDate, statusFilter]),
  );

  const stripDates = useMemo(() => buildDateStrip(selectedDate), [selectedDate]);

  const listEntries = useMemo((): ListEntry[] => {
    const taskHabit = items.filter((item) => item.section === 'TASK_HABIT');
    const mesTaches = taskHabit.filter((r) => r.type === 'TASK');
    const habitsDue = taskHabit.filter((r) => r.type === 'HABIT');
    const projectSubtasks = items.filter((item) => item.section === 'PROJECT_SUBTASK');
    const noteAudio = items.filter((item) => item.section === 'NOTE_AUDIO');

    const out: ListEntry[] = [];
    if (mesTaches.length > 0) {
      out.push({ kind: 'rows', listKey: 'tasks', titleKey: 'timeline.tasks.title', rows: mesTaches });
    }
    if (habitsDue.length > 0) {
      out.push({ kind: 'rows', listKey: 'habits', titleKey: 'timeline.habits.title', rows: habitsDue });
    }
    if (undatedTasks.length > 0) {
      out.push({ kind: 'ideaBank', listKey: 'ideaBank', count: undatedTasks.length });
    }
    if (projectSubtasks.length > 0) {
      out.push({
        kind: 'rows',
        listKey: 'projects',
        titleKey: 'timeline.projects.title',
        rows: projectSubtasks,
      });
    }
    if (noteAudio.length > 0) {
      out.push({
        kind: 'rows',
        listKey: 'notes',
        titleKey: 'timeline.notesAudio.title',
        rows: noteAudio,
      });
    }
    if (archivedItems.length > 0) {
      out.push({
        kind: 'rows',
        listKey: 'archives',
        titleKey: 'timeline.sections.archived',
        rows: archivedItems,
        dimmed: true,
      });
    }
    return out;
  }, [archivedItems, items, undatedTasks]);

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

  const renderRowCard = (row: TrankilV2TimelineItemRow, listKey: string, dimmed?: boolean) => {
    const resolved = resolveDisplayTitle(row);
    const headingKey = displayHeading(resolved);
    const titleText = headingKey ? t(headingKey) : resolved;
    const createdLine = formatCreatedLine(row.created_at, i18n.language);
    return (
      <View
        key={row.id}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.outlineVariant,
            opacity: dimmed ? 0.78 : 1,
          },
        ]}
      >
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>{titleText}</Text>
          {spectrum.isProUser && row.is_synced_calendar === 1 ? (
            <View style={styles.syncBadge}>
              <CalendarCheck size={listKey === 'archives' ? 16 : 14} color="#0ea5a4" />
              {listKey === 'archives' ? (
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
        <Text style={[styles.createdMeta, { color: theme.colors.onSurfaceVariant }]}>
          {t('timeline.createdOn', { date: createdLine })}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={listEntries}
        keyExtractor={(item) => item.listKey}
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
        renderItem={({ item }) => {
          if (item.kind === 'ideaBank') {
            return (
              <View style={[styles.section, { paddingHorizontal: 16 }]}>
                <Pressable
                  onPress={() => setIdeaBankOpen(true)}
                  style={[
                    neumorphicRaised(theme),
                    styles.ideaBankPressable,
                    { borderWidth: 1, borderColor: theme.colors.outlineVariant },
                  ]}
                >
                  <PiggyBank size={28} color="#FF8C00" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ideaBankLabel, { color: theme.colors.onSurface }]}>
                      {item.count} {t('timeline.ideaBank.button')}
                    </Text>
                  </View>
                </Pressable>
              </View>
            );
          }
          return (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>{t(item.titleKey)}</Text>
              {item.rows.map((row) => renderRowCard(row, item.listKey, item.dimmed))}
            </View>
          );
        }}
        ListEmptyComponent={
          listEntries.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                {loading ? t('stats.loading') : t('timeline.noContentForDate')}
              </Text>
            </View>
          ) : null
        }
      />

      <IdeaBankModal
        visible={ideaBankOpen}
        onClose={() => setIdeaBankOpen(false)}
        items={undatedTasks}
        status={statusFilter}
        anchorDate={selectedDate}
        onChanged={reload}
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
  createdMeta: { fontSize: 11, marginTop: 6 },
  syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncBadgeText: { color: '#0ea5a4', fontSize: 11, fontWeight: '700' },
  emptyWrap: { paddingHorizontal: 16, paddingVertical: 20 },
  ideaBankPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
  },
  ideaBankLabel: { fontSize: 16, fontWeight: '700' },
});
