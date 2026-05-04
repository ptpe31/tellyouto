import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CommonActions, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Filter } from 'lucide-react-native';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  FlatList,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useTheme, type MD3Theme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  bulkTrankilV2TaskChildStatsByParentIds,
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
import type { AppTabParamList } from '../navigation/types';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import { showAppToast } from '../services/appToast';
import { retryOfflineFirstAiSort, timelineRowEligibleForOfflineAiRetry } from '../services/offlineFirstAiRetry';
import { IdeaBankModal } from '../components/IdeaBankModal';
import { TimelineFilterModal } from '../components/TimelineFilterModal';
import { TimelineDatePickerLazy } from '../components/TimelineDatePickerLazy';
import { IntentInteractionWrapper } from '../components/IntentInteractionWrapper';
import { IntentionCard } from '../components/IntentionCard';
import { IntentionDetailSheet } from '../components/IntentionDetailSheet';
import { ListIntentionCard } from '../components/ListIntentionCard';
import { TalkCaptureMicButton } from '../components/TalkCaptureMicButton';
import { TimelineListItemRow } from '../components/TimelineListItemRow';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { generateSmartTitle } from '../services/smartTitle';
import { VERBOSE_DEBUG } from '../config/verboseDebug';
import { formatYmdLocal } from '../services/TimeSorter';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
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
  const raw = String(c || '').trim();
  const up = raw.toUpperCase();
  if (['HOME', 'PERSO', 'FAMILLE', 'HEALTH', 'SHOP'].includes(up)) return true;
  return /maison|home|famille|regulier|sans_pression|aujourdhui|demain|cette_semaine|zen/.test(normalizeCat(raw));
}

function matchesWorkCategory(c: string | null | undefined): boolean {
  const raw = String(c || '').trim();
  const up = raw.toUpperCase();
  if (['WORK', 'PRO', 'FINANCE'].includes(up)) return true;
  return /travail|work|pro|finance|projets/.test(normalizeCat(raw));
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
  if (type === 'LIST') return 'timeline.badgeList';
  return 'timeline.badgeProject';
}

function categoryLabelKey(raw: string | null | undefined): string | null {
  const up = String(raw || '').trim().toUpperCase();
  if (!up) return null;
  if (up === 'FAMILLE') return 'category.HOME';
  if (up === 'PRO') return 'category.WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) {
    return `category.${up}`;
  }
  return null;
}

function offlineAiChipForRow(row: TrankilV2TimelineItemRow, translate: (key: string) => string): string | null {
  if (row.type === 'LIST') return null;
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

function smartTitleAuditTime(due: string | null): string {
  const raw = String(due ?? '').trim();
  if (!raw) return '—';
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;
  const ymd = formatYmdLocal(d);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${ymd} ${time}`;
}

const SECTION_HEADER_H = 36;
const IDEA_BANK_H = 58;
const CARD_ROW_H = 120;
const LIST_CARD_H = 348;

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
    }
  | {
      kind: 'listCard';
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
      const isList = r.type === 'LIST' || r.section === 'LIST_CARD';
      out.push({
        kind: isList ? 'listCard' : 'card',
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
      it.kind === 'section'
        ? SECTION_HEADER_H
        : it.kind === 'ideaBankRow'
          ? IDEA_BANK_H
          : it.kind === 'listCard'
            ? LIST_CARD_H
            : CARD_ROW_H;
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
  const { t } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const route = useRoute<RouteProp<AppTabParamList, 'Timeline'>>();
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
  const [primaryHasMore, setPrimaryHasMore] = useState(false);
  const [archivedHasMore, setArchivedHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ideaBankOpen, setIdeaBankOpen] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<TrankilV2TimelineItemRow | null>(null);
  const [childStats, setChildStats] = useState(() => new Map<string, TrankilV2ChildTaskStats>());
  const [pendingLocalDone, setPendingLocalDone] = useState(() => new Set<string>());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const anchorDate = useMemo(
    () => resolveAnchor(timeNav, customPickedDate).anchor,
    [timeNav, customPickedDate],
  );

  const openDetail = useCallback((r: TrankilV2TimelineItemRow) => {
    setDetailRow(r);
    setDetailOpen(true);
  }, []);

  const patchRow = useCallback((id: string, patch: Partial<TrankilV2TimelineItemRow>) => {
    setPrimaryRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setArchivedRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setUnorganizedTodo((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDetailRow((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRow(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const params = route.params;
      if (!params?.initialTimeNav && !params?.initialContext) return;
      if (params.initialTimeNav) setTimeNav(params.initialTimeNav);
      if (params.initialContext) setContextBubble(params.initialContext);
      navigation.setParams({
        initialTimeNav: undefined,
        initialContext: undefined,
      } as never);
    }, [navigation, route.params]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View
          style={[
            neumorphicRaised(theme),
            styles.navHeaderPill,
            { borderWidth: 1, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text style={[styles.navHeaderTitle, { color: theme.colors.onBackground }]}>Ma Timeline</Text>
        </View>
      ),
      headerTitleAlign: 'left',
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 12 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (rootNavigationRef.isReady()) rootNavigationRef.navigate('ProjectList');
            }}
            style={({ pressed }) => [
              neumorphicRaised(theme),
              styles.navHeaderFilterBtn,
              {
                borderWidth: 1,
                borderColor: theme.colors.outlineVariant,
                opacity: pressed ? 0.88 : 1,
              },
            ]}
          >
            <ClipboardList size={20} color={theme.colors.onBackground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFilterModalOpen(true)}
            style={({ pressed }) => [
              neumorphicRaised(theme),
              styles.navHeaderFilterBtn,
              {
                borderWidth: 1,
                borderColor: theme.colors.outlineVariant,
                opacity: pressed ? 0.88 : 1,
              },
            ]}
          >
            <Filter size={20} color={theme.colors.onBackground} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, theme]);

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
      const [unorganizedRaw] = await Promise.all([
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
        if (__DEV__ && VERBOSE_DEBUG) {
          for (const r of slice) {
            const rawText = String(r.content_raw ?? '');
            const clean = generateSmartTitle(rawText);
            const time = smartTitleAuditTime(r.due_date);
            console.log(`[SmartTitle Audit] RAW: "${rawText}" -> CLEAN: "${clean}" | TIME: "${time}"`);
          }
        }
        return {
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
        if (__DEV__ && VERBOSE_DEBUG) {
          for (const r of slice) {
            const rawText = String(r.content_raw ?? '');
            const clean = generateSmartTitle(rawText);
            const time = smartTitleAuditTime(r.due_date);
            console.log(`[SmartTitle Audit] RAW: "${rawText}" -> CLEAN: "${clean}" | TIME: "${time}"`);
          }
        }
        return {
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
      if (__DEV__ && VERBOSE_DEBUG) {
        for (const r of slice) {
          const rawText = String(r.content_raw ?? '');
          const clean = generateSmartTitle(rawText);
          const time = smartTitleAuditTime(r.due_date);
          console.log(`[SmartTitle Audit] RAW: "${rawText}" -> CLEAN: "${clean}" | TIME: "${time}"`);
        }
      }
      return {
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
    const listRows = filteredPool.filter((item) => item.section === 'LIST_CARD');

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
    if (listRows.length > 0) {
      out.push({
        kind: 'rows',
        listKey: 'lists',
        titleKey: 'timeline.lists.title',
        rows: listRows,
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
      if (item.kind === 'listCard') {
        const row = item.row;
        return (
          <View style={{ paddingHorizontal: 16, paddingBottom: 2 }}>
            <IntentInteractionWrapper intentionId={row.id} anchorDate={anchorDate} onMutation={reload}>
              <ListIntentionCard row={row} theme={theme} spectrumIsPro={spectrum.isProUser} />
            </IntentInteractionWrapper>
          </View>
        );
      }
      const row = item.row;
      const showCompleteOrb = canShowCompleteOrb(item.listKey, statusFilter);
      const card = (
        <IntentionCard
          row={row}
          theme={theme}
          pendingLocalDone={pendingLocalDone.has(row.id)}
          enabled={showCompleteOrb}
          onToggleComplete={() => void handleToggleRowComplete(row)}
          onPress={() => openDetail(row)}
        />
      );
      return (
        <View style={{ paddingHorizontal: 16, paddingBottom: 2 }}>
          <IntentInteractionWrapper intentionId={row.id} anchorDate={anchorDate} onMutation={reload}>
            {item.rowVariant === 'noPressure' ? (
              <View
                style={{
                  borderRadius: 18,
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
        </View>
      );
    },
    [
      anchorDate,
      handleToggleRowComplete,
      pendingLocalDone,
      reload,
      openDetail,
      spectrum.isProUser,
      statusFilter,
      t,
      theme,
    ],
  );

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

      <IntentionDetailSheet
        visible={detailOpen}
        row={detailRow}
        theme={theme}
        onClose={closeDetail}
        onPatchRow={patchRow}
      />

      <TimelineFilterModal
        visible={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        timeNav={timeNav}
        setTimeNav={setTimeNav}
        customPickedDate={customPickedDate}
        setCustomPickedDate={setCustomPickedDate}
        setDatePickerOpen={setDatePickerOpen}
        contextBubble={contextBubble}
        setContextBubble={setContextBubble}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />

      {RPlatform.OS !== 'web' && datePickerOpen ? (
        <TimelineDatePickerLazy
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
  navHeaderPill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, marginLeft: 12 },
  navHeaderTitle: { fontSize: 16, fontWeight: '800' },
  navHeaderFilterBtn: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
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
