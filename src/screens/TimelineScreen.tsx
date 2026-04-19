import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { CalendarDays } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import {
  DeviceEventEmitter,
  FlatList,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { SegmentedButtons, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  bulkTrankilV2TaskChildStatsByParentIds,
  getTrankilV2UnorganizedCount,
  listTrankilV2IsArchivedIntentions,
  listTrankilV2LowPressureRootTasks,
  listTrankilV2TimelineItemsByDate,
  listTrankilV2UndatedRootTasks,
  listTrankilV2UnorganizedIntentions,
  mapTrankilIntentionToTimelineItemRow,
  syncNativeRailAlarmsAfterIntentionWrite,
  toggleIntentionDone,
  type TrankilIntentStatus,
  type TrankilV2ChildTaskStats,
  type TrankilV2IntentionRow,
  type TrankilV2TimelineDateMode,
  type TrankilV2TimelineItemRow,
} from '../api';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import { IdeaBankModal } from '../components/IdeaBankModal';
import { IntentInteractionWrapper } from '../components/IntentInteractionWrapper';
import { NeumorphicCard } from '../components/NeumorphicCard';
import { TalkCaptureMicButton } from '../components/TalkCaptureMicButton';
import { TimelineListItemRow } from '../components/TimelineListItemRow';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { generateSmartTitle } from '../services/smartTitle';
import { neumorphicInset, neumorphicRaised } from '../theme/neumorphism';
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

type TimeNav = 'TODAY' | 'TOMORROW' | 'WEEK';
type ContextBubble = 'ALL' | 'HOME' | 'WORK' | 'PIGGY' | 'ARCHIVES';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function normalizeDueDateLocal(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function resolveAnchor(timeNav: TimeNav): { anchor: Date; mode: TrankilV2TimelineDateMode } {
  const now = startOfToday();
  if (timeNav === 'TODAY') return { anchor: now, mode: 'DAY' };
  if (timeNav === 'TOMORROW') return { anchor: addDays(now, 1), mode: 'DAY' };
  return { anchor: now, mode: 'WEEK' };
}

function normalizeCat(c: string | null | undefined): string {
  return (c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function matchesHomeCategory(c: string | null | undefined): boolean {
  return /maison|home|famille/.test(normalizeCat(c));
}

function matchesWorkCategory(c: string | null | undefined): boolean {
  return /travail|work|pro/.test(normalizeCat(c));
}

function filterRowsByContext(rows: TrankilV2TimelineItemRow[], ctx: ContextBubble): TrankilV2TimelineItemRow[] {
  if (ctx === 'ALL' || ctx === 'PIGGY' || ctx === 'ARCHIVES') return rows;
  if (ctx === 'HOME') return rows.filter((r) => matchesHomeCategory(r.category_id));
  if (ctx === 'WORK') return rows.filter((r) => matchesWorkCategory(r.category_id));
  return rows;
}

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
  rowVariant?: 'default' | 'noPressure';
};

type IdeaBankEntry = {
  kind: 'ideaBank';
  listKey: 'ideaBank';
  count: number;
};

type ListEntry = RowSection | IdeaBankEntry;

type DataPack = {
  todoTimeline: TrankilV2TimelineItemRow[];
  doneTimeline: TrankilV2TimelineItemRow[];
  /** Vrac Timeline : `is_organized = 0`, sans catégorie ni date (tâches, notes, habitudes). */
  unorganizedTodo: TrankilV2TimelineItemRow[];
  unorganizedCount: number;
  doneUndated: TrankilV2TimelineItemRow[];
  todoLowPressure: TrankilV2TimelineItemRow[];
  doneLowPressure: TrankilV2TimelineItemRow[];
  archivedIntentions: TrankilV2IntentionRow[];
};

const EMPTY_PACK: DataPack = {
  todoTimeline: [],
  doneTimeline: [],
  unorganizedTodo: [],
  unorganizedCount: 0,
  doneUndated: [],
  todoLowPressure: [],
  doneLowPressure: [],
  archivedIntentions: [],
};

export function TimelineScreen() {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [timeNav, setTimeNav] = useState<TimeNav>('TODAY');
  const [contextBubble, setContextBubble] = useState<ContextBubble>('ALL');
  const [statusFilter, setStatusFilter] = useState<TrankilIntentStatus>('TODO');
  const [pack, setPack] = useState<DataPack>(EMPTY_PACK);
  const [loading, setLoading] = useState(false);
  const [ideaBankOpen, setIdeaBankOpen] = useState(false);
  const [childStats, setChildStats] = useState(() => new Map<string, TrankilV2ChildTaskStats>());
  const [pendingLocalDone, setPendingLocalDone] = useState(() => new Set<string>());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const anchorDate = useMemo(() => resolveAnchor(timeNav).anchor, [timeNav]);

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
      await toggleIntentionDone(id);
      await syncNativeRailAlarmsAfterIntentionWrite('timelineFlushPendingDone');
    }
  }, [syncPendingSet]);

  const loadPack = useCallback(async () => {
    await flushPendingCommits();
    const { anchor, mode } = resolveAnchor(timeNav);
    const ymd = toYmd(anchor);
    setLoading(true);
    try {
      const [
        todoTimeline,
        doneTimeline,
        unorganizedTodo,
        unorganizedCount,
        doneUndated,
        todoLowPressure,
        doneLowPressure,
        archivedIntentions,
      ] = await Promise.all([
        listTrankilV2TimelineItemsByDate(ymd, 'TODO', mode),
        listTrankilV2TimelineItemsByDate(ymd, 'DONE', mode),
        listTrankilV2UnorganizedIntentions().then((rows) => rows.map(mapTrankilIntentionToTimelineItemRow)),
        getTrankilV2UnorganizedCount(),
        listTrankilV2UndatedRootTasks('DONE'),
        listTrankilV2LowPressureRootTasks('TODO'),
        listTrankilV2LowPressureRootTasks('DONE'),
        listTrankilV2IsArchivedIntentions(),
      ]);
      setPack({
        todoTimeline,
        doneTimeline,
        unorganizedTodo,
        unorganizedCount,
        doneUndated,
        todoLowPressure,
        doneLowPressure,
        archivedIntentions,
      });
    } finally {
      setLoading(false);
    }
  }, [flushPendingCommits, timeNav]);

  const reload = useCallback(() => {
    void loadPack();
  }, [loadPack]);

  const removeRowFromPack = useCallback((rowId: string) => {
    setPack((prev) => {
      const wasInUnorganized = prev.unorganizedTodo.some((r) => r.id === rowId);
      return {
        todoTimeline: prev.todoTimeline.filter((r) => r.id !== rowId),
        doneTimeline: prev.doneTimeline.filter((r) => r.id !== rowId),
        unorganizedTodo: prev.unorganizedTodo.filter((r) => r.id !== rowId),
        unorganizedCount: wasInUnorganized ? Math.max(0, prev.unorganizedCount - 1) : prev.unorganizedCount,
        doneUndated: prev.doneUndated.filter((r) => r.id !== rowId),
        todoLowPressure: prev.todoLowPressure.filter((r) => r.id !== rowId),
        doneLowPressure: prev.doneLowPressure.filter((r) => r.id !== rowId),
        archivedIntentions: prev.archivedIntentions.filter((r) => r.id !== rowId),
      };
    });
  }, []);

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
      await toggleIntentionDone(rowId);
      await syncNativeRailAlarmsAfterIntentionWrite('timelineTaskDone');
      removeRowFromPack(rowId);
    },
    [removeRowFromPack, syncPendingSet],
  );

  const cancelPendingCommit = useCallback(
    (rowId: string) => {
      const tm = pendingTimersRef.current.get(rowId);
      if (tm) clearTimeout(tm);
      pendingTimersRef.current.delete(rowId);
      if (!pendingLocalDoneRef.current.has(rowId)) return;
      const n = new Set(pendingLocalDoneRef.current);
      n.delete(rowId);
      syncPendingSet(n);
    },
    [syncPendingSet],
  );

  const schedulePendingCommit = useCallback(
    (rowId: string) => {
      const n = new Set(pendingLocalDoneRef.current);
      n.add(rowId);
      syncPendingSet(n);
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

  const filteredPool = useMemo((): TrankilV2TimelineItemRow[] => {
    const timelineSlice = statusFilter === 'TODO' ? pack.todoTimeline : pack.doneTimeline;
    const piggySlice = statusFilter === 'TODO' ? pack.unorganizedTodo : pack.doneUndated;
    const lowPressureSlice = statusFilter === 'TODO' ? pack.todoLowPressure : pack.doneLowPressure;

    if (contextBubble === 'PIGGY') {
      return filterRowsByContext(piggySlice, contextBubble);
    }
    if (contextBubble === 'ARCHIVES') {
      const mapped = pack.archivedIntentions
        .filter((it) => (it.is_archived ?? 0) === 1)
        .map(mapTrankilIntentionToTimelineItemRow);
      const statusFiltered =
        statusFilter === 'TODO'
          ? mapped.filter((r) => r.status === 'TODO' || r.status === 'ARCHIVED')
          : mapped.filter((r) => r.status === 'DONE');
      return filterRowsByContext(statusFiltered, 'ALL');
    }
    let base = filterRowsByContext(timelineSlice, contextBubble);
    if (timeNav === 'TODAY') {
      const extra = filterRowsByContext(lowPressureSlice, contextBubble);
      const seen = new Set(base.map((r) => r.id));
      for (const r of extra) {
        if (!seen.has(r.id)) {
          base = [...base, r];
          seen.add(r.id);
        }
      }
    }
    return base;
  }, [contextBubble, pack, statusFilter, timeNav]);

  const hiddenUnorganizedForIdeaBank = useMemo(() => {
    const visible = new Set(filteredPool.map((r) => r.id));
    return pack.unorganizedTodo.filter((r) => !visible.has(r.id));
  }, [filteredPool, pack.unorganizedTodo]);

  const listEntries = useMemo((): ListEntry[] => {
    const taskHabit = filteredPool.filter((item) => item.section === 'TASK_HABIT');
    const habitsDue = taskHabit.filter((r) => r.type === 'HABIT');
    const allTasks = taskHabit.filter((r) => r.type === 'TASK');
    const projectSubtasks = filteredPool.filter((item) => item.section === 'PROJECT_SUBTASK');
    const noteAudio = filteredPool.filter((item) => item.section === 'NOTE_AUDIO');

    const todayYmd = toYmd(anchorDate);
    const splitTodayTasks =
      timeNav === 'TODAY' &&
      statusFilter === 'TODO' &&
      contextBubble !== 'PIGGY' &&
      contextBubble !== 'ARCHIVES';

    let tasksScheduled: TrankilV2TimelineItemRow[] = [];
    let tasksNoPressure: TrankilV2TimelineItemRow[] = [];
    if (splitTodayTasks) {
      for (const r of allTasks) {
        const d = normalizeDueDateLocal(r.due_date);
        if (d === todayYmd) tasksScheduled.push(r);
        else tasksNoPressure.push(r);
      }
    }

    const out: ListEntry[] = [];
    if (habitsDue.length > 0) {
      out.push({ kind: 'rows', listKey: 'habits', titleKey: 'timeline.habits.title', rows: habitsDue });
    }
    if (splitTodayTasks) {
      if (tasksScheduled.length > 0) {
        out.push({
          kind: 'rows',
          listKey: 'tasks',
          titleKey: 'timeline.tasks.scheduledToday',
          rows: tasksScheduled,
        });
      }
      if (tasksNoPressure.length > 0) {
        out.push({
          kind: 'rows',
          listKey: 'tasks',
          titleKey: 'timeline.tasks.noPressure',
          rows: tasksNoPressure,
          rowVariant: 'noPressure',
        });
      }
    } else if (allTasks.length > 0) {
      out.push({ kind: 'rows', listKey: 'tasks', titleKey: 'timeline.tasks.title', rows: allTasks });
    }
    if (contextBubble === 'ALL' && statusFilter === 'TODO' && hiddenUnorganizedForIdeaBank.length > 0) {
      out.push({ kind: 'ideaBank', listKey: 'ideaBank', count: hiddenUnorganizedForIdeaBank.length });
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
    return out;
  }, [
    anchorDate,
    contextBubble,
    filteredPool,
    hiddenUnorganizedForIdeaBank.length,
    statusFilter,
    timeNav,
  ]);

  const todayTodoCount = useMemo(() => {
    if (timeNav !== 'TODAY' || statusFilter !== 'TODO') return 0;
    return filteredPool.filter((r) => r.type === 'TASK' || r.type === 'HABIT' || r.type === 'PROJECT').length;
  }, [filteredPool, statusFilter, timeNav]);

  const flatRowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of listEntries) {
      if (e.kind !== 'rows') continue;
      for (const r of e.rows) {
        if (r.section === 'TASK_HABIT' && (r.type === 'TASK' || r.type === 'HABIT')) {
          ids.add(r.id);
        }
        const pid = String(r.parent_id ?? '').trim();
        if (r.section === 'PROJECT_SUBTASK' && pid.length > 0) {
          ids.add(pid);
        }
      }
    }
    return [...ids];
  }, [listEntries]);

  useEffect(() => {
    let cancelled = false;
    if (flatRowIds.length === 0) {
      setChildStats(new Map());
      return () => {
        cancelled = true;
      };
    }
    void bulkTrankilV2TaskChildStatsByParentIds(flatRowIds).then((m) => {
      if (!cancelled) setChildStats(m);
    });
    return () => {
      cancelled = true;
    };
  }, [flatRowIds]);

  useFocusEffect(
    useCallback(() => {
      void loadPack();
      return () => {
        void flushPendingCommits();
      };
    }, [flushPendingCommits, loadPack]),
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => {
      void loadPack();
    });
    return () => sub.remove();
  }, [loadPack]);

  const timeNavButtons = useMemo(
    () => [
      {
        value: 'TODAY' as const,
        label: t('horizons.today'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
      {
        value: 'TOMORROW' as const,
        label: t('horizons.tomorrow'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
      {
        value: 'WEEK' as const,
        label: t('horizons.thisWeek'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
    ],
    [t],
  );

  const renderRowCard = (
    row: TrankilV2TimelineItemRow,
    listKey: string,
    dimmed?: boolean,
    rowVariant?: 'default' | 'noPressure',
  ) => {
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

    const card = (
      <TimelineListItemRow
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

    return (
      <IntentInteractionWrapper
        key={row.id}
        intentionId={row.id}
        anchorDate={anchorDate}
        enabled={!dimmed}
        onMutation={reload}
      >
        {rowVariant === 'noPressure' ? (
          <View
            style={[
              styles.noPressureRowWrap,
              {
                borderColor: theme.colors.primary,
                backgroundColor: 'rgba(0, 128, 128, 0.06)',
              },
            ]}
          >
            {card}
          </View>
        ) : (
          card
        )}
      </IntentInteractionWrapper>
    );
  };

  const contextDefs: { id: ContextBubble; label: string; emoji?: string }[] = [
    { id: 'ALL', label: t('timeline.pilot.contextAll') },
    { id: 'HOME', label: t('timeline.pilot.contextHome'), emoji: '🏠' },
    { id: 'WORK', label: t('timeline.pilot.contextWork'), emoji: '💼' },
    { id: 'PIGGY', label: t('timeline.pilot.contextPiggy'), emoji: '🐷' },
    { id: 'ARCHIVES', label: t('timeline.pilot.contextArchives'), emoji: '📦' },
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <FlatList
        style={styles.listFlex}
        data={listEntries}
        keyExtractor={(item) =>
          item.kind === 'rows' ? `${item.listKey}-${item.titleKey}` : item.listKey
        }
        extraData={{ contextBubble, statusFilter, timeNav, pack }}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View style={styles.headTitleRow}>
              <CalendarDays color={theme.colors.primary} size={20} />
              <Text style={[styles.screenTitle, { color: theme.colors.onBackground }]}>{t('timeline.pilot.title')}</Text>
            </View>

            <NeumorphicCard style={styles.cardBlock}>
              <View style={styles.segmentLabelRow}>
                <Text style={[styles.cardLabel, { color: theme.colors.primary }]}>{t('timeline.pilot.timeNav')}</Text>
                {timeNav === 'TODAY' && todayTodoCount > 0 ? (
                  <View style={styles.timeBadge}>
                    <Text style={styles.timeBadgeText}>{todayTodoCount}</Text>
                  </View>
                ) : null}
              </View>
              <SegmentedButtons
                value={timeNav}
                onValueChange={(v) => setTimeNav(v as TimeNav)}
                buttons={timeNavButtons}
                density="small"
                style={styles.segment}
              />
            </NeumorphicCard>

            <NeumorphicCard style={styles.cardBlock}>
              <Text style={[styles.cardLabel, { color: theme.colors.primary }]}>{t('timeline.pilot.contextNav')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bubbleRow}>
                {contextDefs.map((c) => {
                  const selected = contextBubble === c.id;
                  const countPiggy = c.id === 'PIGGY' ? pack.unorganizedCount : 0;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setContextBubble(c.id)}
                      style={[
                        selected ? neumorphicRaised(theme) : neumorphicInset(theme),
                        styles.contextBubble,
                        {
                          borderWidth: 1,
                          borderColor: selected ? theme.colors.primary : theme.colors.outlineVariant,
                          borderStyle: selected ? 'solid' : 'dashed',
                        },
                      ]}
                    >
                      <Text style={[styles.bubbleLabel, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                        {c.emoji ? `${c.emoji} ` : ''}
                        {c.label}
                      </Text>
                      {c.id === 'PIGGY' && countPiggy > 0 ? (
                        <View style={styles.piggyBadge}>
                          <Text style={styles.piggyBadgeText}>{countPiggy}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </NeumorphicCard>

            <NeumorphicCard style={styles.cardBlock}>
              <Text style={[styles.cardLabel, { color: theme.colors.primary }]}>{t('timeline.pilot.statusNav')}</Text>
              <View style={styles.statusRow}>
                <Pressable
                  onPress={() => setStatusFilter('TODO')}
                  style={[
                    neumorphicInset(theme),
                    styles.statusBtn,
                    statusFilter === 'TODO' && { borderColor: theme.colors.primary, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.statusBtnText, { color: theme.colors.onSurfaceVariant }]}>
                    {t('timeline.pilot.todo')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setStatusFilter('DONE')}
                  style={[
                    neumorphicInset(theme),
                    styles.statusBtn,
                    statusFilter === 'DONE' && { borderColor: theme.colors.primary, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.statusBtnText, { color: theme.colors.onSurfaceVariant }]}>
                    {t('timeline.pilot.done')}
                  </Text>
                </Pressable>
              </View>
            </NeumorphicCard>
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
                  <Text style={[styles.ideaBankLabel, { color: theme.colors.onSurface }]}>
                    {item.count} {t('timeline.ideaBank.button')}
                  </Text>
                </Pressable>
              </View>
            );
          }
          return (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>{t(item.titleKey)}</Text>
              {item.rows.map((row) => renderRowCard(row, item.listKey, item.dimmed, item.rowVariant))}
            </View>
          );
        }}
        ListEmptyComponent={
          listEntries.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.skyClearText, { color: theme.colors.onSurfaceVariant }]}>
                {loading ? t('stats.loading') : t('timeline.skyClear')}
              </Text>
            </View>
          ) : null
        }
      />

      <View
        pointerEvents="box-none"
        style={[styles.micDock, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        <TalkCaptureMicButton
          compact
          onCaptureEnd={({ transcript }) => {
            DeviceEventEmitter.emit(TALK_CAPTURE_DEBUG_EVENT, {
              mode: 'quick',
              at: Date.now(),
              rawTranscript: transcript,
            });
          }}
        />
      </View>

      <IdeaBankModal
        visible={ideaBankOpen}
        onClose={() => setIdeaBankOpen(false)}
        items={hiddenUnorganizedForIdeaBank}
        status={statusFilter}
        anchorDate={anchorDate}
        onChanged={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listFlex: { flex: 1 },
  listContent: { flexGrow: 1 },
  headerStack: { paddingHorizontal: 12, paddingTop: 8, gap: 10 },
  headTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  screenTitle: { fontSize: 22, fontWeight: '700' },
  cardBlock: { marginBottom: 0 },
  cardLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.35, marginBottom: 6, opacity: 0.92 },
  segment: { marginTop: 0, minHeight: 36 },
  segmentBtnCompact: { minHeight: 32 },
  segmentLabelCompact: { fontSize: 12, fontWeight: '600' },
  segmentLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  timeBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,140,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBadgeText: { fontSize: 11, fontWeight: '800', color: '#7c2d12' },
  bubbleRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  contextBubble: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bubbleLabel: { fontSize: 12, fontWeight: '600' },
  piggyBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,140,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  piggyBadgeText: { fontSize: 11, fontWeight: '800', color: '#7c2d12' },
  statusRow: { flexDirection: 'row', gap: 10 },
  statusBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  statusBtnText: { fontSize: 13, fontWeight: '600' },
  section: { paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  noPressureRowWrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 2,
    marginBottom: 2,
  },
  emptyWrap: { flex: 1, paddingHorizontal: 24, paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  skyClearText: { fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 24 },
  ideaBankPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
  },
  ideaBankLabel: { fontSize: 16, fontWeight: '700' },
  micDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
});
