import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import { CalendarDays } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
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
import { SegmentedButtons, useTheme, type MD3Theme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  bulkTrankilV2TaskChildStatsByParentIds,
  getTrankilV2UnorganizedCount,
  listTrankilV2IsArchivedIntentions,
  listTrankilV2MergedTodayTimelineWithLowPressure,
  listTrankilV2TimelineItemsByDate,
  listTrankilV2UndatedRootTasks,
  listTrankilV2UnorganizedIntentions,
  mapTrankilIntentionToTimelineItemRow,
  syncNativeRailAlarmsAfterIntentionWrite,
  TIMELINE_PAGE_SIZE,
  toggleIntentionDone,
  type TrankilIntentStatus,
  type TimelineSqlContext,
  type TrankilV2ChildTaskStats,
  type TrankilV2TimelineDateMode,
  type TrankilV2TimelineItemRow,
} from '../api';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import { showAppToast } from '../services/appToast';
import { retryOfflineFirstAiSort, timelineRowEligibleForOfflineAiRetry } from '../services/offlineFirstAiRetry';
import { IdeaBankModal } from '../components/IdeaBankModal';
import { IntentInteractionWrapper } from '../components/IntentInteractionWrapper';
import { NeumorphicCard } from '../components/NeumorphicCard';
import { TalkCaptureMicButton } from '../components/TalkCaptureMicButton';
import { TimelineListItemRow } from '../components/TimelineListItemRow';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { generateSmartTitle } from '../services/smartTitle';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
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

type TimeNav = 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';
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

function dateAtNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/** Affichage court type 25/04 pour le segment « Date ». */
function formatPilotDayChip(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

function resolveAnchor(
  timeNav: TimeNav,
  customPickedDate: Date | null,
): { anchor: Date; mode: TrankilV2TimelineDateMode } {
  const now = startOfToday();
  if (timeNav === 'TODAY') return { anchor: now, mode: 'DAY' };
  if (timeNav === 'TOMORROW') return { anchor: addDays(now, 1), mode: 'DAY' };
  if (timeNav === 'WEEK') return { anchor: now, mode: 'WEEK' };
  const anchor = customPickedDate ? dateAtNoon(customPickedDate) : now;
  return { anchor, mode: 'DAY' };
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

function offlineAiChipForRow(row: TrankilV2TimelineItemRow, translate: (key: string) => string): string | null {
  if (row.type !== 'NOTE' && row.type !== 'AUDIO') return null;
  const pending = row.is_pending_ai === 1;
  let failed = false;
  try {
    const m = JSON.parse(row.metadata_json || '{}') as Record<string, unknown>;
    failed = Boolean(m.ai_processing_failed);
  } catch {
    /* ignore */
  }
  if (pending) return translate('timeline.aiPendingChip');
  if (failed) return translate('timeline.aiFailedChip');
  return null;
}

const SECTION_HEADER_H = 36;
const IDEA_BANK_H = 58;
const CARD_ROW_H = 156;

function sqlContextFromBubble(bubble: ContextBubble): TimelineSqlContext {
  if (bubble === 'HOME') return 'HOME';
  if (bubble === 'WORK') return 'WORK';
  return 'ALL';
}

function takePage<T>(rows: T[], pageSize: number): { slice: T[]; hasMore: boolean } {
  if (rows.length > pageSize) {
    return { slice: rows.slice(0, pageSize), hasMore: true };
  }
  return { slice: rows, hasMore: false };
}

type TimelineFlatItem =
  | { kind: 'section'; id: string; titleKey: string }
  | { kind: 'ideaBankRow'; id: string; count: number }
  | {
      kind: 'card';
      id: string;
      row: TrankilV2TimelineItemRow;
      listKey: string;
      rowVariant: 'default' | 'noPressure';
    };

function flattenForVirtualList(entries: ListEntry[]): TimelineFlatItem[] {
  const out: TimelineFlatItem[] = [];
  for (const e of entries) {
    if (e.kind === 'ideaBank') {
      out.push({ kind: 'ideaBankRow', id: 'ideaBank', count: e.count });
      continue;
    }
    out.push({ kind: 'section', id: `sec-${e.listKey}-${e.titleKey}`, titleKey: e.titleKey });
    for (const r of e.rows) {
      out.push({
        kind: 'card',
        id: r.id,
        row: r,
        listKey: e.listKey,
        rowVariant: e.rowVariant ?? 'default',
      });
    }
  }
  return out;
}

function buildFlatListLayouts(items: TimelineFlatItem[]): { length: number; offset: number }[] {
  let off = 0;
  return items.map((it) => {
    const len =
      it.kind === 'section' ? SECTION_HEADER_H : it.kind === 'ideaBankRow' ? IDEA_BANK_H : CARD_ROW_H;
    const cur = { length: len, offset: off };
    off += len;
    return cur;
  });
}

type TimelineCardRowProps = {
  row: TrankilV2TimelineItemRow;
  listKey: string;
  rowVariant: 'default' | 'noPressure';
  dimmed?: boolean;
  theme: MD3Theme;
  spectrumIsPro: boolean;
  anchorDate: Date;
  titleText: string;
  badgeLabel: string;
  projectSuffix: string | null;
  createdCaption: string;
  progressLookupId: string | null;
  showCompleteOrb: boolean;
  pendingLocalDone: boolean;
  childStats: Map<string, TrankilV2ChildTaskStats>;
  onToggleComplete: () => void;
  onMutationReload: () => void;
  offlineAiChipLabel: string | null;
  onRetryAiSort?: () => void;
  retryAiSortBusy: boolean;
};

const TimelineCardRow = memo(function TimelineCardRow({
  row,
  listKey,
  rowVariant,
  dimmed,
  theme,
  spectrumIsPro,
  anchorDate,
  titleText,
  badgeLabel,
  projectSuffix,
  createdCaption,
  progressLookupId,
  showCompleteOrb,
  pendingLocalDone,
  childStats,
  onToggleComplete,
  onMutationReload,
  offlineAiChipLabel,
  onRetryAiSort,
  retryAiSortBusy,
}: TimelineCardRowProps) {
  const card = (
    <TimelineListItemRow
      row={row}
      listKey={listKey}
      dimmed={dimmed}
      theme={theme}
      titleText={titleText}
      badgeLabel={badgeLabel}
      projectSuffix={projectSuffix}
      createdCaption={createdCaption}
      isPro={spectrumIsPro}
      showCompleteOrb={showCompleteOrb}
      progressLookupId={progressLookupId}
      childStats={childStats}
      pendingLocalDone={pendingLocalDone}
      onToggleComplete={onToggleComplete}
      offlineAiChipLabel={offlineAiChipLabel}
      onRetryAiSort={onRetryAiSort}
      retryAiSortBusy={retryAiSortBusy}
    />
  );
  return (
    <IntentInteractionWrapper
      intentionId={row.id}
      anchorDate={anchorDate}
      enabled={!dimmed}
      onMutation={onMutationReload}
    >
      {rowVariant === 'noPressure' ? (
        <View
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.colors.primary,
            backgroundColor: 'rgba(0, 128, 128, 0.06)',
          }}
        >
          {card}
        </View>
      ) : (
        card
      )}
    </IntentInteractionWrapper>
  );
});

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

export function TimelineScreen() {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [timeNav, setTimeNav] = useState<TimeNav>('TODAY');
  const [customPickedDate, setCustomPickedDate] = useState<Date | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const timelineBlurredRef = useRef(false);
  const [contextBubble, setContextBubble] = useState<ContextBubble>('ALL');
  const [statusFilter, setStatusFilter] = useState<TrankilIntentStatus>('TODO');
  /** Liste principale (pilotage, tirelire) ou archives mappées en lignes Timeline. */
  const [primaryRows, setPrimaryRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [archivedRows, setArchivedRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [unorganizedTodo, setUnorganizedTodo] = useState<TrankilV2TimelineItemRow[]>([]);
  const [unorganizedCount, setUnorganizedCount] = useState(0);
  const [primaryHasMore, setPrimaryHasMore] = useState(false);
  const [archivedHasMore, setArchivedHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ideaBankOpen, setIdeaBankOpen] = useState(false);
  const [childStats, setChildStats] = useState(() => new Map<string, TrankilV2ChildTaskStats>());
  const [pendingLocalDone, setPendingLocalDone] = useState(() => new Set<string>());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const anchorDate = useMemo(
    () => resolveAnchor(timeNav, customPickedDate).anchor,
    [timeNav, customPickedDate],
  );

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

  const fetchTimelineSlice = useCallback(
    async (
      nav: TimeNav,
      custom: Date | null,
      bubble: ContextBubble,
      status: TrankilIntentStatus,
      offset: number,
    ): Promise<{
      unorganizedCount: number;
      unorganizedTodo: TrankilV2TimelineItemRow[];
      primary: TrankilV2TimelineItemRow[];
      primaryHasMore: boolean;
      archived: TrankilV2TimelineItemRow[];
      archivedHasMore: boolean;
    }> => {
      const pageLimit = TIMELINE_PAGE_SIZE + 1;
      const ctx = sqlContextFromBubble(bubble);
      const { anchor, mode } = resolveAnchor(nav, custom);
      const ymd = toYmd(anchor);
      const [count, unorganizedRaw] = await Promise.all([
        getTrankilV2UnorganizedCount(),
        listTrankilV2UnorganizedIntentions({
          paging: { limit: 400, offset: 0 },
          context: 'ALL',
        }).then((rows) => rows.map(mapTrankilIntentionToTimelineItemRow)),
      ]);

      if (bubble === 'PIGGY') {
        const raw = await listTrankilV2UndatedRootTasks(status, {
          paging: { limit: pageLimit, offset },
          context: ctx,
        });
        const { slice, hasMore } = takePage(raw, TIMELINE_PAGE_SIZE);
        return {
          unorganizedCount: count,
          unorganizedTodo: unorganizedRaw,
          primary: slice,
          primaryHasMore: hasMore,
          archived: [],
          archivedHasMore: false,
        };
      }
      if (bubble === 'ARCHIVES') {
        const raw = await listTrankilV2IsArchivedIntentions({
          paging: { limit: pageLimit, offset },
          statusFilter: status === 'TODO' ? 'TODO' : 'DONE',
          context: ctx,
        });
        const mapped = raw.map(mapTrankilIntentionToTimelineItemRow);
        const { slice, hasMore } = takePage(mapped, TIMELINE_PAGE_SIZE);
        return {
          unorganizedCount: count,
          unorganizedTodo: unorganizedRaw,
          primary: [],
          primaryHasMore: false,
          archived: slice,
          archivedHasMore: hasMore,
        };
      }

      const mergeToday = nav === 'TODAY';
      let raw: TrankilV2TimelineItemRow[];
      if (mergeToday) {
        raw = await listTrankilV2MergedTodayTimelineWithLowPressure(ymd, status, ctx, {
          limit: pageLimit,
          offset,
        });
      } else {
        raw = await listTrankilV2TimelineItemsByDate(ymd, status, mode, {
          paging: { limit: pageLimit, offset },
          context: ctx,
        });
      }
      const { slice, hasMore } = takePage(raw, TIMELINE_PAGE_SIZE);
      return {
        unorganizedCount: count,
        unorganizedTodo: unorganizedRaw,
        primary: slice,
        primaryHasMore: hasMore,
        archived: [],
        archivedHasMore: false,
      };
    },
    [],
  );

  const loadPack = useCallback(async () => {
    await flushPendingCommits();
    setLoading(true);
    try {
      const b = await fetchTimelineSlice(timeNav, customPickedDate, contextBubble, statusFilter, 0);
      setUnorganizedCount(b.unorganizedCount);
      setUnorganizedTodo(b.unorganizedTodo);
      setPrimaryRows(b.primary);
      setPrimaryHasMore(b.primaryHasMore);
      setArchivedRows(b.archived);
      setArchivedHasMore(b.archivedHasMore);
    } finally {
      setLoading(false);
    }
  }, [contextBubble, customPickedDate, fetchTimelineSlice, flushPendingCommits, statusFilter, timeNav]);

  const reload = useCallback(() => {
    void loadPack();
  }, [loadPack]);

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, ms: number): Promise<T | null> => {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    });
    return (await Promise.race([promise, timeout])) as T | null;
  }, []);

  const [retryAiBusyId, setRetryAiBusyId] = useState<string | null>(null);
  const retryAiLockRef = useRef(false);

  const handleRetryOfflineAi = useCallback(
    async (intentionId: string) => {
      if (retryAiLockRef.current) return;
      retryAiLockRef.current = true;
      setRetryAiBusyId(intentionId);
      try {
        const res = await retryOfflineFirstAiSort({
          intentionId,
          withTimeout,
          locale: spectrum.locale || 'fr',
          birthdayLabel: t('talkDebug.birthdayLabel'),
          habitsDefaultTitle: t('common.habits'),
        });
        if (res.ok) {
          showAppToast(t('capture.offlineRetryOkToast'));
        } else {
          showAppToast(t('capture.offlineNoteGenericToast'));
        }
        DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
        reload();
      } finally {
        retryAiLockRef.current = false;
        setRetryAiBusyId(null);
      }
    },
    [reload, spectrum.locale, t, withTimeout],
  );

  const loadMoreRows = useCallback(async () => {
    if (loading || loadingMore) return;
    const pageLimit = TIMELINE_PAGE_SIZE + 1;
    const ctx = sqlContextFromBubble(contextBubble);
    const { anchor, mode } = resolveAnchor(timeNav, customPickedDate);
    const ymd = toYmd(anchor);

    if (contextBubble === 'ARCHIVES') {
      if (!archivedHasMore) return;
      setLoadingMore(true);
      try {
        const raw = await listTrankilV2IsArchivedIntentions({
          paging: { limit: pageLimit, offset: archivedRows.length },
          statusFilter: statusFilter === 'TODO' ? 'TODO' : 'DONE',
          context: ctx,
        });
        const mapped = raw.map(mapTrankilIntentionToTimelineItemRow);
        const { slice, hasMore } = takePage(mapped, TIMELINE_PAGE_SIZE);
        setArchivedRows((prev) => [...prev, ...slice]);
        setArchivedHasMore(hasMore);
      } finally {
        setLoadingMore(false);
      }
      return;
    }

    if (!primaryHasMore) return;
    setLoadingMore(true);
    try {
      let raw: TrankilV2TimelineItemRow[];
      if (contextBubble === 'PIGGY') {
        raw = await listTrankilV2UndatedRootTasks(statusFilter, {
          paging: { limit: pageLimit, offset: primaryRows.length },
          context: ctx,
        });
      } else {
        const mergeToday = timeNav === 'TODAY';
        if (mergeToday) {
          raw = await listTrankilV2MergedTodayTimelineWithLowPressure(ymd, statusFilter, ctx, {
            limit: pageLimit,
            offset: primaryRows.length,
          });
        } else {
          raw = await listTrankilV2TimelineItemsByDate(ymd, statusFilter, mode, {
            paging: { limit: pageLimit, offset: primaryRows.length },
            context: ctx,
          });
        }
      }
      const { slice, hasMore } = takePage(raw, TIMELINE_PAGE_SIZE);
      setPrimaryRows((prev) => [...prev, ...slice]);
      setPrimaryHasMore(hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [
    archivedHasMore,
    archivedRows.length,
    contextBubble,
    customPickedDate,
    loading,
    loadingMore,
    primaryHasMore,
    primaryRows.length,
    statusFilter,
    timeNav,
  ]);

  const removeRowFromPack = useCallback((rowId: string) => {
    setPrimaryRows((prev) => prev.filter((r) => r.id !== rowId));
    setArchivedRows((prev) => prev.filter((r) => r.id !== rowId));
    setUnorganizedTodo((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      const removed = next.length < prev.length;
      if (removed) {
        setUnorganizedCount((c) => Math.max(0, c - 1));
      }
      return next;
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

  const navigateToAddTask = useCallback(() => {
    if (!rootNavigationRef.isReady()) return;
    rootNavigationRef.dispatch(
      CommonActions.navigate({
        name: 'App',
        params: { screen: 'Tabs', params: { screen: 'TalkHome' } },
      } as never),
    );
  }, []);

  const handleTimeNavChange = useCallback((v: string) => {
    if (v === 'CUSTOM') {
      if (RPlatform.OS === 'web') return;
      setTimeNav('CUSTOM');
      setCustomPickedDate((prev) => dateAtNoon(prev ?? startOfToday()));
      setDatePickerOpen(true);
      return;
    }
    setTimeNav(v as 'TODAY' | 'TOMORROW' | 'WEEK');
    setCustomPickedDate(null);
  }, []);

  const onDatePicked = useCallback(
    (_event: { type?: string }, selected?: Date) => {
      if (RPlatform.OS === 'android') {
        setDatePickerOpen(false);
      }
      if (RPlatform.OS === 'android' && _event.type === 'dismissed') {
        return;
      }
      if (selected) {
        setCustomPickedDate(dateAtNoon(selected));
        setTimeNav('CUSTOM');
      }
      if (RPlatform.OS === 'ios') {
        setDatePickerOpen(false);
      }
    },
    [],
  );

  const filteredPool = useMemo((): TrankilV2TimelineItemRow[] => {
    if (contextBubble === 'PIGGY') {
      return filterRowsByContext(primaryRows, contextBubble);
    }
    if (contextBubble === 'ARCHIVES') {
      return filterRowsByContext(archivedRows, 'ALL');
    }
    return filterRowsByContext(primaryRows, contextBubble);
  }, [archivedRows, contextBubble, primaryRows]);

  const hiddenUnorganizedForIdeaBank = useMemo(() => {
    const visible = new Set(filteredPool.map((r) => r.id));
    return unorganizedTodo.filter((r) => !visible.has(r.id));
  }, [filteredPool, unorganizedTodo]);

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

  const flatListItems = useMemo(() => flattenForVirtualList(listEntries), [listEntries]);

  const flatListLayouts = useMemo(() => buildFlatListLayouts(flatListItems), [flatListItems]);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => {
      const L = flatListLayouts[index];
      return { length: L.length, offset: L.offset, index };
    },
    [flatListLayouts],
  );

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
      if (timelineBlurredRef.current) {
        timelineBlurredRef.current = false;
        void (async () => {
          await flushPendingCommits();
          setLoading(true);
          try {
            const b = await fetchTimelineSlice('TODAY', null, contextBubble, statusFilter, 0);
            setUnorganizedCount(b.unorganizedCount);
            setUnorganizedTodo(b.unorganizedTodo);
            setPrimaryRows(b.primary);
            setPrimaryHasMore(b.primaryHasMore);
            setArchivedRows(b.archived);
            setArchivedHasMore(b.archivedHasMore);
          } finally {
            setLoading(false);
          }
          setTimeNav('TODAY');
          setCustomPickedDate(null);
          setDatePickerOpen(false);
        })();
      }
      return () => {
        timelineBlurredRef.current = true;
        void flushPendingCommits();
      };
    }, [contextBubble, fetchTimelineSlice, flushPendingCommits, statusFilter]),
  );

  useEffect(() => {
    void loadPack();
  }, [loadPack]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => {
      void loadPack();
    });
    return () => sub.remove();
  }, [loadPack]);

  const timeNavButtons = useMemo(() => {
    const base: {
      value: 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';
      label: string;
      style: typeof styles.segmentBtnCompact;
      labelStyle: typeof styles.segmentLabelCompact;
    }[] = [
      {
        value: 'TODAY',
        label: t('horizons.today'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
      {
        value: 'TOMORROW',
        label: t('horizons.tomorrow'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
      {
        value: 'WEEK',
        label: t('horizons.thisWeek'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
    ];
    if (RPlatform.OS === 'web') return base;
    base.push({
      value: 'CUSTOM',
      label:
        timeNav === 'CUSTOM' && customPickedDate
          ? t('timeline.pilot.pickedDateShort', { date: formatPilotDayChip(customPickedDate) })
          : t('timeline.pilot.specificDate'),
      style: styles.segmentBtnCompact,
      labelStyle: styles.segmentLabelCompact,
    });
    return base;
  }, [t, timeNav, customPickedDate]);

  const renderTimelineFlatItem = useCallback(
    ({ item }: { item: TimelineFlatItem }) => {
      if (item.kind === 'section') {
        return (
          <View style={[styles.sectionHeaderOnly, { paddingHorizontal: 16 }]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>{t(item.titleKey)}</Text>
          </View>
        );
      }
      if (item.kind === 'ideaBankRow') {
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
      const row = item.row;
      const resolved = resolveDisplayTitle(row);
      const headingKey = displayHeading(resolved);
      const titleText = headingKey ? t(headingKey) : resolved;
      const createdLine = formatCreatedLine(row.created_at, i18n.language);
      const showCompleteOrb = canShowCompleteOrb(item.listKey, statusFilter);
      const progressLookupId = progressLookupIdForRow(row);
      const projectSuffix =
        row.section === 'PROJECT_SUBTASK' && row.project_title
          ? `${t('timeline.projectPrefix')}: ${row.project_title}`
          : null;
      const offlineChip = offlineAiChipForRow(row, t);
      const showRetry = timelineRowEligibleForOfflineAiRetry(row);
      return (
        <View style={{ paddingHorizontal: 16, paddingBottom: 2 }}>
          <TimelineCardRow
            row={row}
            listKey={item.listKey}
            rowVariant={item.rowVariant}
            theme={theme}
            spectrumIsPro={spectrum.isProUser}
            anchorDate={anchorDate}
            titleText={titleText}
            badgeLabel={t(typeBadge(row.type))}
            projectSuffix={projectSuffix}
            createdCaption={t('timeline.createdOn', { date: createdLine })}
            progressLookupId={progressLookupId}
            showCompleteOrb={showCompleteOrb}
            pendingLocalDone={pendingLocalDone.has(row.id)}
            childStats={childStats}
            onToggleComplete={() => void handleToggleRowComplete(row)}
            onMutationReload={reload}
            offlineAiChipLabel={offlineChip}
            onRetryAiSort={showRetry ? () => void handleRetryOfflineAi(row.id) : undefined}
            retryAiSortBusy={retryAiBusyId === row.id}
          />
        </View>
      );
    },
    [
      anchorDate,
      childStats,
      handleRetryOfflineAi,
      handleToggleRowComplete,
      i18n.language,
      pendingLocalDone,
      reload,
      retryAiBusyId,
      spectrum.isProUser,
      statusFilter,
      t,
      theme,
    ],
  );

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
        data={flatListItems}
        keyExtractor={(item) => item.id}
        extraData={{
          contextBubble,
          statusFilter,
          timeNav,
          customPickedDate,
          childStats,
          pendingLocalDone,
        }}
        getItemLayout={getItemLayout}
        removeClippedSubviews={RPlatform.OS === 'android'}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onEndReached={() => void loadMoreRows()}
        onEndReachedThreshold={0.35}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.listFooterLoading}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : null
        }
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
                onValueChange={(v) => handleTimeNavChange(v)}
                buttons={timeNavButtons}
                density="small"
                style={styles.segment}
              />
              {timeNav === 'CUSTOM' && RPlatform.OS !== 'web' ? (
                <Pressable
                  onPress={() => setDatePickerOpen(true)}
                  style={[styles.changeDateLink, { borderColor: theme.colors.outlineVariant }]}
                >
                  <Text style={[styles.changeDateLinkText, { color: theme.colors.primary }]}>
                    {t('timeline.pilot.changeDate')}
                  </Text>
                </Pressable>
              ) : null}
            </NeumorphicCard>

            <NeumorphicCard style={styles.cardBlock}>
              <Text style={[styles.cardLabel, { color: theme.colors.primary }]}>{t('timeline.pilot.contextNav')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bubbleRow}>
                {contextDefs.map((c) => {
                  const selected = contextBubble === c.id;
                  const countPiggy = c.id === 'PIGGY' ? unorganizedCount : 0;
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
        renderItem={renderTimelineFlatItem}
        ListEmptyComponent={
          flatListItems.length === 0 ? (
            <View style={styles.emptyWrap}>
              {loading ? (
                <View style={styles.skeletonStack}>
                  {[0, 1, 2, 3].map((k) => (
                    <View
                      key={`sk-${k}`}
                      style={[styles.skeletonBar, { backgroundColor: theme.colors.surfaceVariant }]}
                    />
                  ))}
                </View>
              ) : timeNav === 'CUSTOM' && customPickedDate ? (
                <View style={styles.customEmptyBlock}>
                  <Text style={[styles.skyClearText, { color: theme.colors.onSurfaceVariant }]}>
                    {t('timeline.customDayEmpty')}
                  </Text>
                  <Pressable
                    onPress={navigateToAddTask}
                    style={[
                      neumorphicRaised(theme),
                      styles.customEmptyCta,
                      { borderWidth: 1, borderColor: theme.colors.primary },
                    ]}
                  >
                    <Text style={[styles.customEmptyCtaText, { color: theme.colors.primary }]}>
                      {t('timeline.customDayAddTask')}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={[styles.skyClearText, { color: theme.colors.onSurfaceVariant }]}>
                  {t('timeline.skyClear')}
                </Text>
              )}
            </View>
          ) : null
        }
      />

      {RPlatform.OS !== 'web' && datePickerOpen ? (
        <DateTimePicker
          value={customPickedDate ?? startOfToday()}
          mode="date"
          display="default"
          onChange={onDatePicked}
        />
      ) : null}

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
  sectionHeaderOnly: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  skeletonStack: { paddingHorizontal: 24, paddingTop: 24, gap: 12, width: '100%' },
  skeletonBar: { height: 96, borderRadius: 14, width: '100%' },
  listFooterLoading: { paddingVertical: 20, alignItems: 'center', justifyContent: 'center' },
  noPressureRowWrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 2,
    marginBottom: 2,
  },
  emptyWrap: { flex: 1, paddingHorizontal: 24, paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  skyClearText: { fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 24 },
  changeDateLink: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  changeDateLinkText: { fontSize: 12, fontWeight: '600' },
  customEmptyBlock: { alignItems: 'center', gap: 16, maxWidth: 320 },
  customEmptyCta: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
  },
  customEmptyCtaText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
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
