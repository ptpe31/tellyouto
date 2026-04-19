import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { CalendarDays, PiggyBank } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { FlatList, LayoutAnimation, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  bulkTrankilV2TaskChildStatsByParentIds,
  listArchivedIntentions,
  listTrankilV2TimelineItemsByDate,
  listTrankilV2UndatedRootTasks,
  markTrankilV2IntentionDone,
  syncNativeRailAlarmsAfterIntentionWrite,
  type TrankilIntentStatus,
  type TrankilV2ChildTaskStats,
  type TrankilV2TimelineDateMode,
  type TrankilV2TimelineItemRow,
} from '../api';
import { IdeaBankModal } from '../components/IdeaBankModal';
import { TimelineListItemRow } from '../components/TimelineListItemRow';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { generateSmartTitle } from '../services/smartTitle';
import { neumorphicRaised } from '../theme/neumorphism';
import { Platform as RPlatform } from '../utils/rnPlatform';

if (RPlatform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

async function safeSuccessHaptic(): Promise<void> {
  try {
    if (RPlatform.OS === 'web') return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    /* ignore */
  }
}

async function safeMediumHaptic(): Promise<void> {
  try {
    if (RPlatform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    /* ignore */
  }
}

function progressLookupIdForRow(row: TrankilV2TimelineItemRow): string | null {
  if (row.section === 'PROJECT_SUBTASK') {
    const pid = String(row.parent_id ?? '').trim();
    return pid.length > 0 ? pid : null;
  }
  if (row.section === 'TASK_HABIT' && (row.type === 'TASK' || row.type === 'HABIT')) {
    return row.id;
  }
  return null;
}

function canShowCompleteOrb(listKey: string, status: TrankilIntentStatus, dimmed?: boolean): boolean {
  if (dimmed) return false;
  if (status !== 'TODO') return false;
  return listKey === 'tasks' || listKey === 'habits' || listKey === 'projects';
}

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
  const [childStats, setChildStats] = useState(() => new Map<string, TrankilV2ChildTaskStats>());
  const [pendingLocalDone, setPendingLocalDone] = useState(() => new Set<string>());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const selectedYmd = useMemo(() => toYmd(selectedDate), [selectedDate]);

  const syncPendingSet = useCallback((next: Set<string>) => {
    pendingLocalDoneRef.current = next;
    setPendingLocalDone(next);
  }, []);

  const flushPendingCommits = useCallback(async () => {
    const ids = [...pendingLocalDoneRef.current];
    if (ids.length === 0) return;
    for (const id of ids) {
      const tm = pendingTimersRef.current.get(id);
      if (tm) clearTimeout(tm);
      pendingTimersRef.current.delete(id);
    }
    syncPendingSet(new Set());
    for (const id of ids) {
      await markTrankilV2IntentionDone(id);
      await syncNativeRailAlarmsAfterIntentionWrite('timelineFlushPendingDone');
    }
  }, [syncPendingSet]);

  const load = useCallback(
    async (date: Date, status: TrankilIntentStatus, mode: TrankilV2TimelineDateMode) => {
      await flushPendingCommits();
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
    },
    [flushPendingCommits],
  );

  const reload = useCallback(() => {
    void load(selectedDate, statusFilter, dateMode);
  }, [dateMode, load, selectedDate, statusFilter]);

  const finalizeSingleDone = useCallback(
    async (rowId: string) => {
      if (!pendingLocalDoneRef.current.has(rowId)) return;
      const tm = pendingTimersRef.current.get(rowId);
      if (tm) clearTimeout(tm);
      pendingTimersRef.current.delete(rowId);
      const next = new Set(pendingLocalDoneRef.current);
      next.delete(rowId);
      syncPendingSet(next);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      await markTrankilV2IntentionDone(rowId);
      await syncNativeRailAlarmsAfterIntentionWrite('timelineTaskDone');
      setItems((prev) => prev.filter((i) => i.id !== rowId));
      setUndatedTasks((prev) => prev.filter((i) => i.id !== rowId));
    },
    [syncPendingSet],
  );

  const cancelPendingCommit = useCallback(
    (rowId: string) => {
      const tm = pendingTimersRef.current.get(rowId);
      if (tm) clearTimeout(tm);
      pendingTimersRef.current.delete(rowId);
      if (!pendingLocalDoneRef.current.has(rowId)) return;
      const next = new Set(pendingLocalDoneRef.current);
      next.delete(rowId);
      syncPendingSet(next);
    },
    [syncPendingSet],
  );

  const schedulePendingCommit = useCallback(
    (rowId: string) => {
      const next = new Set(pendingLocalDoneRef.current);
      next.add(rowId);
      syncPendingSet(next);
      const tm = setTimeout(() => {
        pendingTimersRef.current.delete(rowId);
        void finalizeSingleDone(rowId);
      }, 3000);
      pendingTimersRef.current.set(rowId, tm);
    },
    [finalizeSingleDone, syncPendingSet],
  );

  const handleToggleRowComplete = useCallback(
    async (row: TrankilV2TimelineItemRow) => {
      if (pendingLocalDoneRef.current.has(row.id)) {
        await safeMediumHaptic();
        cancelPendingCommit(row.id);
        return;
      }
      await safeSuccessHaptic();
      schedulePendingCommit(row.id);
    },
    [cancelPendingCommit, schedulePendingCommit],
  );

  useEffect(() => {
    const ids = new Set<string>();
    for (const r of items) {
      if (r.section === 'TASK_HABIT' && (r.type === 'TASK' || r.type === 'HABIT')) {
        ids.add(r.id);
      }
      const pid = String(r.parent_id ?? '').trim();
      if (r.section === 'PROJECT_SUBTASK' && pid.length > 0) {
        ids.add(pid);
      }
    }
    const arr = [...ids];
    let cancelled = false;
    if (arr.length === 0) {
      setChildStats(new Map());
      return () => {
        cancelled = true;
      };
    }
    void bulkTrankilV2TaskChildStatsByParentIds(arr).then((m) => {
      if (!cancelled) setChildStats(m);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  useFocusEffect(
    useCallback(() => {
      void load(selectedDate, statusFilter, dateMode);
      return () => {
        void flushPendingCommits();
      };
    }, [dateMode, flushPendingCommits, load, selectedDate, statusFilter]),
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
    const showOrb = canShowCompleteOrb(listKey, statusFilter, dimmed);
    const progressKey = progressLookupIdForRow(row);
    const projectSuffix =
      row.section === 'PROJECT_SUBTASK' && row.project_title
        ? `${t('timeline.projectPrefix')}: ${row.project_title}`
        : null;

    return (
      <TimelineListItemRow
        key={row.id}
        row={row}
        listKey={listKey}
        dimmed={dimmed}
        theme={theme}
        titleText={titleText}
        badgeLabel={t(typeBadge(row.type))}
        projectSuffix={projectSuffix}
        createdCaption={t('timeline.createdOn', { date: createdLine })}
        isPro={spectrum.isProUser}
        showCompleteOrb={showOrb}
        progressLookupId={progressKey}
        childStats={childStats}
        pendingLocalDone={pendingLocalDone.has(row.id)}
        onToggleComplete={() => void handleToggleRowComplete(row)}
      />
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
