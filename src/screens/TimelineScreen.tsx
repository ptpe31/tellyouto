import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CommonActions, useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Filter, Printer } from 'lucide-react-native';
import {
  ActivityIndicator,
  Alert,
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
  bulkDeleteTrankilV2IntentionsByIds,
  bulkTrankilV2TaskChildStatsByParentIds,
  getTrankilV2IntentionById,
  getTrankilV2SmartClusterCounts,
  insertDailySummary,
  listIntentionsForPass3Cleanup,
  listTrankilV2IsArchivedIntentions,
  listTrankilV2MergedTodayTimelineWithLowPressure,
  listTrankilV2InboxToday,
  listTrankilV2InboxZoomChildTasksForDay,
  getHabitCompletionDayKeysByIntentionIds,
  listTrankilV2BoxStockIntentions,
  listTrankilV2ListClusterIntentions,
  listTrankilV2ShopClusterIntentions,
  listActiveProjectsToday,
  listTrankilV2AllTimelineItems,
  listTrankilV2TimelineItemsByDate,
  listTrankilV2UndatedRootTasks,
  listTrankilV2UnorganizedIntentions,
  listActiveHabitsForHub,
  mapTrankilIntentionToTimelineItemRow,
  syncNativeRailAlarmsAfterIntentionWrite,
  TIMELINE_PAGE_SIZE,
  toggleIntentionDone,
  type TrankilIntentStatus,
  type TimelineSqlContext,
  type TrankilV2ChildTaskStats,
  type TrankilV2TimelineDateMode,
  type TrankilV2IntentionRow,
  type TrankilV2TimelineItemRow,
} from '../api';
import {
  CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH_EVENT_NAME,
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTION_PEEK_SNAPSHOT_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import { logCaptureFlow } from '../utils/captureFlowLog';
import type { AppTabParamList } from '../navigation/types';
import { showAppToast } from '../services/appToast';
import { retryOfflineFirstAiSort, timelineRowEligibleForOfflineAiRetry } from '../services/offlineFirstAiRetry';
import { filterTimelineVisibleRows } from '../services/timelineIntentionVisibility';
import {
  buildPeekPendingRowFromSnapshot,
  capturePeekPathAHeightPx,
  capturePeekPathBHeightPx,
  CAPTURE_SHEET_FULL_MAX_RATIO,
} from '../utils/capturePeekLayout';
import { PressableScale } from '../components/common/PressableScale';
import { IdeaBankModal } from '../components/IdeaBankModal';
import { buildInboxRootsView } from '../utils/inboxRootsView';
import { SOURCING_V1_ENABLED } from '../config/features';
import { SmartClustersCarousel, type SmartClusterDebugContents } from '../components/SmartClustersCarousel';
import type { SmartClusterDebugEntry } from '../utils/clusterDebugLog';
import { DailyRoadmapReportModal } from '../components/dailyRoadmap/DailyRoadmapReportModal';
import { Pass3CleanupSasOverlay, type Pass3CleanupRow } from '../components/dailyRoadmap/Pass3CleanupSasOverlay';
import { TimelineFilterModal } from '../components/TimelineFilterModal';
import { TimelineDatePickerLazy } from '../components/TimelineDatePickerLazy';
import { IntentInteractionWrapper } from '../components/IntentInteractionWrapper';
import { IntentionCard } from '../components/IntentionCard';
import { IntentionDetailSheet } from '../components/IntentionDetailSheet';
import {
  estimateSentinelFocusBadgeHeight,
  SENTINEL_FOCUS_SLOT_HEIGHT,
  SentinelFocusBadge,
} from '../components/SentinelFocusBadge';
import type { TripTimelineFooter } from '../utils/tripTimelineCard';
import { useCapturePresentation } from '../context/CapturePresentationContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { generateSmartTitle } from '../services/smartTitle';
import { VERBOSE_DEBUG } from '../config/verboseDebug';
import { formatYmdLocal } from '../services/TimeSorter';
import { buildDailyRoadmapPayload, runDailyRoadmapGeminiHtml } from '../services/dailyRoadmapPass3';
import { ensureGeminiRemoteModelInitialized } from '../services/geminiRemoteModelSteering';
import { AIUniversalProgressOverlay } from '../components/AIUniversalProgressOverlay';
import { useAIProgressInertia } from '../hooks/useAIProgressInertia';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import { neumorphicRaised } from '../theme/neumorphism';
import { useDesignTokens, type ZenTypography } from '../hooks/useDesignTokens';
import {
  buildLivingHubBlocks,
  buildNarrativeTimelineBlocks,
  buildRoutineHubBlocks,
  hubCategoryDisplayTitle,
  isTimeSegmentPast,
  LivingHubBlockShell,
  LivingHubCategoryModal,
  NarrativeTimelineBlockShell,
  timeSegmentDisplayTitle,
  type HubBlock,
  type NarrativeTimelineBlock,
} from '../features/livingHub';
import { useAppTheme } from '../context/ThemeContext';
import { Platform as RPlatform } from '../utils/rnPlatform';
import {
  hasSentinelFocusClockInterest,
  isSentinelFocusSlotVisible,
  pickSentinelFocus,
} from '../utils/sentinelFocusSelection';
import { useProbeScheduleClock } from '../hooks/useProbeScheduleClock';

/**
 * Onglet **Timeline** : lecture paginée SQLite (`listTrankilV2*`), filtres contexte / statut, cartes intention,
 * feuille détail, micro global (`GlobalCaptureOverlay`), retry offline-first IA, événements peek.
 * Voir `PROJECT_STATUS.md` §1.2.
 *
 * @module TimelineScreen
 */

if (RPlatform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Animation fluide lors du rafraîchissement de la FlatList (IdeaBank, INTENTIONS_CHANGED). */
function configureTimelineListReloadAnimation(): void {
  LayoutAnimation.configureNext({
    duration: 300,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/** Haptique succès (no-op sur web). */
async function safeSuccessHaptic(): Promise<void> {
  try {
    if (RPlatform.OS === 'web') return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    /* ignore */
  }
}

/** Haptique medium (annulation orb « done » en attente). */
async function safeMediumHaptic(): Promise<void> {
  try {
    if (RPlatform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    /* ignore */
  }
}

/** Normalise un tag catégorie vers les codes domaine SQLite (fallback `PERSO`). */
function normalizeCategoryId(raw: unknown): string {
  const up = String(raw ?? '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) return up;
  return 'PERSO';
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

type TimeNav = 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM' | 'ALL';
type ContextBubble = 'ALL' | 'HOME' | 'WORK' | 'PIGGY' | 'ARCHIVES';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function capitalizeFirst(raw: string): string {
  if (!raw) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
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
  if (timeNav === 'ALL') return { anchor: now, mode: 'DAY' };
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

const SECTION_HEADER_H = 36;
const CARD_ROW_H = 120;
const NARRATIVE_BLOCK_HEADER_H = 44;
const NARRATIVE_LINE_H = 28;
const NARRATIVE_SUBTITLE_H = 18;
const SENTINEL_FOCUS_FALLBACK_H = SENTINEL_FOCUS_SLOT_HEIGHT;

function estimateNarrativeBlockHeight(block: NarrativeTimelineBlock): number {
  let linesH = 0;
  for (const line of block.lines) {
    linesH += NARRATIVE_LINE_H + (line.subtitle ? NARRATIVE_SUBTITLE_H : 0);
  }
  return NARRATIVE_BLOCK_HEADER_H + linesH + 24;
}

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
  | { kind: 'section'; id: string; titleText: string }
  | { kind: 'sentinelFocus'; id: string; rows: TrankilV2TimelineItemRow[] }
  | { kind: 'narrativeBlock'; id: string; block: NarrativeTimelineBlock; isPast?: boolean }
  | { kind: 'hubBlock'; id: string; block: HubBlock }
  | {
      kind: 'card';
      id: string;
      row: TrankilV2TimelineItemRow;
      rowVariant: 'default' | 'noPressure';
    };

function flattenForVirtualList(
  entries: ListEntry[],
  options?: { skipTodayYmd?: string; hideSectionHeaders?: boolean },
): TimelineFlatItem[] {
  const out: TimelineFlatItem[] = [];
  for (const e of entries) {
    if (!options?.hideSectionHeaders && e.titleText.trim()) {
      out.push({ kind: 'section', id: `sec-${e.id}`, titleText: e.titleText });
    }
    if (options?.skipTodayYmd && e.id === options.skipTodayYmd) {
      continue;
    }
    for (const r of e.rows) {
      out.push({
        kind: 'card',
        id: r.id,
        row: r,
        rowVariant: e.rowVariant ?? 'default',
      });
    }
  }
  return out;
}

function buildFlatListLayouts(
  items: TimelineFlatItem[],
  sentinelFocusHeightById: Map<string, number>,
  narrativeBlockHeightById?: Map<string, number>,
): { length: number; offset: number }[] {
  let off = 0;
  return items.map((it) => {
    const len =
      it.kind === 'section'
        ? SECTION_HEADER_H
        : it.kind === 'sentinelFocus'
          ? (sentinelFocusHeightById.get(it.id) ?? SENTINEL_FOCUS_FALLBACK_H)
          : it.kind === 'narrativeBlock'
            ? (narrativeBlockHeightById?.get(it.id) ?? estimateNarrativeBlockHeight(it.block))
          : it.kind === 'hubBlock'
            ? CARD_ROW_H
            : CARD_ROW_H;
    const cur = { length: len, offset: off };
    off += len;
    return cur;
  });
}

type RowSection = {
  kind: 'rows';
  id: string;
  titleText: string;
  rows: TrankilV2TimelineItemRow[];
  dimmed?: boolean;
  rowVariant?: 'default' | 'noPressure';
};

type ListEntry = RowSection;

/** Écran onglet Timeline : projection des intentions et interactions (done différé, détail, filtres). */
export function TimelineScreen() {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const { setPresentation, resetPresentation, isPipelineOverlayVisible, pipelineOverlayVisibleRef } =
    useCapturePresentation();
  const theme = useTheme();
  const designTokens = useDesignTokens();
  const { typography } = designTokens;
  const styles = useMemo(() => createTimelineScreenStyles(typography), [typography]);
  const { timelineLayoutMode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const route = useRoute<RouteProp<AppTabParamList, 'Timeline'>>();
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
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
  const [ideaBankMode, setIdeaBankMode] = useState<'default' | 'inbox'>('default');
  const [ideaBankCategoryFilter, setIdeaBankCategoryFilter] = useState<string | null>(null);
  const [ideaBankHubItems, setIdeaBankHubItems] = useState<TrankilV2TimelineItemRow[] | null>(null);
  const [ideaBankHubTitle, setIdeaBankHubTitle] = useState<string | undefined>(undefined);
  const [ideaBankAutoTripPillRowId, setIdeaBankAutoTripPillRowId] = useState<string | null>(null);
  const [boxViewOpen, setBoxViewOpen] = useState(false);
  const [boxStockRows, setBoxStockRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [routinesViewOpen, setRoutinesViewOpen] = useState(false);
  const [habitCompletionDaysById, setHabitCompletionDaysById] = useState<Record<string, string[]>>({});
  const [smartClusterCounts, setSmartClusterCounts] = useState({
    inboxToday: 0,
    shopCount: 0,
    boxCount: 0,
    routinesCount: 0,
    projectsToday: 0,
    listsToday: 0,
  });
  const [inboxTodayRows, setInboxTodayRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [activeHabitRows, setActiveHabitRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [shopClusterRows, setShopClusterRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [projectsTodayDebug, setProjectsTodayDebug] = useState<SmartClusterDebugEntry[]>([]);
  const [listsTodayDebug, setListsTodayDebug] = useState<SmartClusterDebugEntry[]>([]);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [pass3SasOpen, setPass3SasOpen] = useState(false);
  const [pass3CleanupRows, setPass3CleanupRows] = useState<Pass3CleanupRow[]>([]);
  const [pass3SynthOpen, setPass3SynthOpen] = useState(false);
  const [pass3ReportOpen, setPass3ReportOpen] = useState(false);
  const [pass3ReportHtml, setPass3ReportHtml] = useState('');
  const pass3AfterSprintRef = useRef<(() => void) | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<TrankilV2TimelineItemRow | null>(null);
  const [detailPosition, setDetailPosition] = useState<'peek' | 'full'>('full');
  const [autoTriggerPass2, setAutoTriggerPass2] = useState(false);
  const [autoFocusTripArrivalEdit, setAutoFocusTripArrivalEdit] = useState(false);
  const [detailPeekHeightPx, setDetailPeekHeightPx] = useState(() => capturePeekPathAHeightPx());
  const [peekCapturePhase, setPeekCapturePhase] = useState<'idle' | 'path_a' | 'path_b'>('idle');
  const peekSnapshotRef = useRef<{ categoryTag?: unknown; predictedType?: unknown; title?: unknown } | null>(null);
  const [childStats, setChildStats] = useState(() => new Map<string, TrankilV2ChildTaskStats>());
  const [pendingLocalDone, setPendingLocalDone] = useState(() => new Set<string>());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      setPresentation({
        variant: 'timeline',
        compact: true,
        dashboardPipelineHost: false,
        micHidden: false,
      });
      return () => resetPresentation();
    }, [resetPresentation, setPresentation]),
  );
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const anchorDate = useMemo(
    () => resolveAnchor(timeNav, customPickedDate).anchor,
    [timeNav, customPickedDate],
  );

  const {
    progress: pass3Progress,
    reset: pass3Reset,
    beginInertia: pass3Begin,
    bumpTarget: pass3Bump,
    startFinalSprintTo100: pass3Sprint,
  } = useAIProgressInertia({
    active: pass3SynthOpen,
    onLinearSprintComplete: () => {
      const fn = pass3AfterSprintRef.current;
      pass3AfterSprintRef.current = null;
      fn?.();
    },
  });

  const pass3OverlayLabel = useMemo(() => {
    if (pass3Progress < 30) return t('timeline.roadmap.progressCollect');
    if (pass3Progress < 60) return t('timeline.roadmap.progressSynth');
    return t('timeline.roadmap.progressWrite');
  }, [pass3Progress, t]);

  /** Ouvre `IntentionDetailSheet` en plein écran sur une ligne existante (hub TRIP unifié). */
  const openDetail = useCallback((r: TrankilV2TimelineItemRow) => {
    setAutoTriggerPass2(false);
    setAutoFocusTripArrivalEdit(false);
    setPeekCapturePhase('idle');
    setDetailRow(r);
    setDetailPosition('full');
    setDetailOpen(true);
  }, []);

  /** Ouvre le détail puis déclenche Pass 2 (pilule IdeaBank). */
  const openDetailWithPass2 = useCallback((r: TrankilV2TimelineItemRow) => {
    setPeekCapturePhase('idle');
    setDetailRow(r);
    setDetailPosition('full');
    setAutoFocusTripArrivalEdit(false);
    setAutoTriggerPass2(true);
    setDetailOpen(true);
  }, []);

  /** Ouvre la sheet trajet avec édition arrivée (adresse / heure manquante depuis la tirelire). */
  const openDetailWithTripSetup = useCallback((r: TrankilV2TimelineItemRow) => {
    setAutoTriggerPass2(false);
    setAutoFocusTripArrivalEdit(true);
    setPeekCapturePhase('idle');
    setDetailRow(r);
    setDetailPosition('full');
    setDetailOpen(true);
  }, []);

  const handleTripFooterPress = useCallback(
    (row: TrankilV2TimelineItemRow, footer: TripTimelineFooter) => {
      if (footer.kind === 'lockedSetup') {
        if (rootNavigationRef.isReady()) {
          rootNavigationRef.navigate('ProSubscription');
        }
        return;
      }
      if (footer.kind === 'setup') {
        openDetail(row);
      }
    },
    [openDetail],
  );

  /** Met à jour une ligne dans les listes locales + détail si ouvert. */
  const patchRow = useCallback((id: string, patch: Partial<TrankilV2TimelineItemRow>) => {
    const apply = (rows: TrankilV2TimelineItemRow[]) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    setPrimaryRows((prev) => apply(prev));
    setArchivedRows((prev) => apply(prev));
    setUnorganizedTodo((prev) => apply(prev));
    setBoxStockRows((prev) => apply(prev));
    setInboxTodayRows((prev) => apply(prev));
    setDetailRow((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  /** Ferme la feuille détail. */
  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRow(null);
    setDetailPosition('full');
    setAutoTriggerPass2(false);
    setAutoFocusTripArrivalEdit(false);
    setDetailPeekHeightPx(capturePeekPathAHeightPx());
    setPeekCapturePhase('idle');
  }, []);

  /** Évite une Modal capture résiduelle sur un onglet non focalisé (cf. SPEC routage peek). */
  useEffect(() => {
    if (isFocused) return;
    const inCapturePeekFlow =
      peekCapturePhase !== 'idle' || detailRow?.id === 'peek_pending';
    if (!detailOpen || !inCapturePeekFlow) return;
    logCaptureFlow(undefined, 'ui_peek_capture_dismissed_unfocused_tab', { screen: 'Timeline' });
    closeDetail();
  }, [closeDetail, detailOpen, detailRow?.id, isFocused, peekCapturePhase]);

  /** Écoute `INTENTION_PEEK_*` pour ouvrir / hydrater le peek post-capture (aligné SPEC cinématique). */
  useEffect(() => {
    const applyTimelinePeekFirstSave = (payload: unknown) => {
      const intentionId = String((payload as { intentionId?: unknown })?.intentionId ?? '').trim();
      if (!intentionId) return;
      const title = String((payload as { title?: unknown })?.title ?? '').trim();
      const transcript = String((payload as { transcript?: unknown })?.transcript ?? '').trim();
      const categoryId = normalizeCategoryId((payload as { categoryTag?: unknown })?.categoryTag);
      const type = String((payload as { predictedType?: unknown })?.predictedType ?? 'NOTE').trim().toUpperCase();
      const previewRow = {
        id: intentionId,
        type,
        category_id: categoryId,
        display_title: title || '—',
        content_raw: transcript,
        due_date: null,
        metadata_json: '{}',
        status: 'TODO',
        created_at: Date.now(),
        updated_at: Date.now(),
        is_archived: 0,
        is_dirty: 0,
      } as unknown as TrankilV2TimelineItemRow;
      setPeekCapturePhase('path_b');
      setDetailPeekHeightPx(capturePeekPathBHeightPx());
      setDetailRow(previewRow);
      setDetailPosition('peek');
      setDetailOpen(true);
      logCaptureFlow(undefined, 'ui_peek_first_save', { screen: 'Timeline', intentionId });
      void (async () => {
        const full = await getTrankilV2IntentionById(intentionId);
        logCaptureFlow(undefined, 'ui_peek_first_save_sql_hydrate', {
          screen: 'Timeline',
          intentionId,
          found: Boolean(full),
        });
        if (!full) return;
        const mapped = mapTrankilIntentionToTimelineItemRow(full);
        setDetailRow((prev) => (prev && prev.id === intentionId ? mapped : prev));
      })();
    };

    const dashboardBalletLocksPeekUi = () => isPipelineOverlayVisible || pipelineOverlayVisibleRef.current;

    const subSnap = DeviceEventEmitter.addListener(INTENTION_PEEK_SNAPSHOT_EVENT_NAME, (payload) => {
      if (!isFocusedRef.current) {
        logCaptureFlow(undefined, 'ui_peek_snapshot_skip_unfocused', { screen: 'Timeline' });
        return;
      }
      if (dashboardBalletLocksPeekUi()) return;
      peekSnapshotRef.current = payload as { categoryTag?: unknown; predictedType?: unknown; title?: unknown } | null;
      const peekRow = buildPeekPendingRowFromSnapshot(
        payload as { categoryTag?: unknown; predictedType?: unknown; title?: unknown },
        normalizeCategoryId,
      );
      setDetailRow(peekRow);
      setDetailPosition('peek');
      setDetailPeekHeightPx(capturePeekPathAHeightPx());
      setPeekCapturePhase('path_a');
      setDetailOpen(true);
      logCaptureFlow(undefined, 'ui_peek_snapshot', {
        screen: 'Timeline',
        categoryTag: String((payload as { categoryTag?: unknown }).categoryTag ?? ''),
        predictedType: String((payload as { predictedType?: unknown }).predictedType ?? ''),
      });
    });
    const subFirstSave = DeviceEventEmitter.addListener(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, (payload) => {
      if (!isFocusedRef.current) {
        logCaptureFlow(undefined, 'ui_peek_first_save_skip_unfocused', { screen: 'Timeline' });
        return;
      }
      if (dashboardBalletLocksPeekUi()) return;
      applyTimelinePeekFirstSave(payload);
    });
    const subDeferred = DeviceEventEmitter.addListener(
      CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH_EVENT_NAME,
      (payload) => {
        if (!isFocusedRef.current) return;
        applyTimelinePeekFirstSave(payload);
      },
    );
    return () => {
      subSnap.remove();
      subFirstSave.remove();
      subDeferred.remove();
    };
  }, [isPipelineOverlayVisible, pipelineOverlayVisibleRef]);

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

  /** Met à jour ref + state React pour l’ensemble des ids « done » en attente (avant `toggleIntentionDone`). */
  const syncPendingSet = useCallback((next: Set<string>) => {
    pendingLocalDoneRef.current = next;
    setPendingLocalDone(next);
  }, []);

  /** Applique immédiatement tous les `toggleIntentionDone` en file (ex. avant reload). */
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

  /**
   * Charge une page timeline : tirelire (`PIGGY`), archives, ou jour fusionné / date SQL selon `TimeNav` et le filtre contexte.
   */
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
        return {
          unorganizedTodo: filterTimelineVisibleRows(unorganizedRaw),
          primary: filterTimelineVisibleRows(slice),
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
          unorganizedTodo: filterTimelineVisibleRows(unorganizedRaw),
          primary: [],
          primaryHasMore: false,
          archived: filterTimelineVisibleRows(slice),
          archivedHasMore: hasMore,
        };
      }

      let raw: TrankilV2TimelineItemRow[];
      if (nav === 'ALL') {
        raw = await listTrankilV2AllTimelineItems(status, {
          paging: { limit: pageLimit, offset },
          context: ctx,
        });
      } else if (nav === 'TODAY') {
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
        unorganizedTodo: filterTimelineVisibleRows(unorganizedRaw),
        primary: filterTimelineVisibleRows(slice),
        primaryHasMore: hasMore,
        archived: [],
        archivedHasMore: false,
      };
    },
    [],
  );

  /** Recharge le « pack » courant (flush pending + `fetchTimelineSlice` offset 0). */
  const loadPack = useCallback(async () => {
    await flushPendingCommits();
    setLoading(true);
    try {
      const { anchor } = resolveAnchor(timeNav, customPickedDate);
      const ymd = toYmd(anchor);
      const [b, counts, inboxRaw, inboxZoomChildRaw, shopRaw, boxRaw, projectsRaw, listsRaw, habitsRaw] = await Promise.all([
        fetchTimelineSlice(timeNav, customPickedDate, contextBubble, statusFilter, 0),
        getTrankilV2SmartClusterCounts(ymd),
        listTrankilV2InboxToday(ymd),
        listTrankilV2InboxZoomChildTasksForDay(ymd),
        listTrankilV2ShopClusterIntentions(),
        listTrankilV2BoxStockIntentions(ymd),
        listActiveProjectsToday(ymd),
        listTrankilV2ListClusterIntentions(),
        listActiveHabitsForHub({ context: sqlContextFromBubble(contextBubble) }),
      ]);
      setUnorganizedTodo(b.unorganizedTodo);
      setPrimaryRows(b.primary);
      setPrimaryHasMore(b.primaryHasMore);
      setArchivedRows(b.archived);
      setArchivedHasMore(b.archivedHasMore);
      setSmartClusterCounts(counts);
      const inboxById = new Map(inboxRaw.map((r) => [r.id, r]));
      for (const row of inboxZoomChildRaw) {
        if (!inboxById.has(row.id)) inboxById.set(row.id, row);
      }
      const mergedInbox = [...inboxById.values()].sort((a, b) => Number(b.created_at) - Number(a.created_at));
      setInboxTodayRows(mergedInbox.map(mapTrankilIntentionToTimelineItemRow));
      setShopClusterRows(shopRaw.map(mapTrankilIntentionToTimelineItemRow));
      setBoxStockRows(filterTimelineVisibleRows(boxRaw.map(mapTrankilIntentionToTimelineItemRow)));
      const habitRows = habitsRaw.map(mapTrankilIntentionToTimelineItemRow);
      setActiveHabitRows(habitRows);
      const completionDays = await getHabitCompletionDayKeysByIntentionIds(habitRows.map((r) => r.id));
      const completionRecord: Record<string, string[]> = {};
      for (const [id, days] of completionDays) completionRecord[id] = days;
      setHabitCompletionDaysById(completionRecord);
      setProjectsTodayDebug(projectsRaw);
      setListsTodayDebug(listsRaw.map((r) => ({ id: r.id, title: r.title })));
    } finally {
      setLoading(false);
    }
  }, [contextBubble, customPickedDate, fetchTimelineSlice, flushPendingCommits, statusFilter, timeNav]);

  /** Raccourci vers `loadPack` (après retry offline, événements globaux, etc.). */
  const reload = useCallback(() => {
    configureTimelineListReloadAnimation();
    void loadPack();
  }, [loadPack]);

  const openDailyRoadmapPrinter = useCallback(async () => {
    try {
      const rows = await listIntentionsForPass3Cleanup();
      setPass3CleanupRows(rows);
      setPass3SasOpen(true);
    } catch {
      showAppToast(t('timeline.roadmap.synthError'));
    }
  }, [t]);

  const handlePass3LaunchSynthesis = useCallback(
    async (overdueRows: TrankilV2IntentionRow[], orphanRows: TrankilV2IntentionRow[]) => {
      setPass3SasOpen(false);
      setPass3SynthOpen(true);
      pass3Reset();
      pass3Begin();
      const ymd = formatYmdLocal(new Date());
      let html = '';
      try {
        await ensureGeminiRemoteModelInitialized();
        const payload = buildDailyRoadmapPayload(overdueRows, orphanRows, ymd, i18n.language);
        html = await runDailyRoadmapGeminiHtml({
          payload,
          onPromptReady: () => pass3Bump(26),
          onAccumulatedText: (full) => {
            pass3Bump(40 + Math.min(48, Math.floor(full.length / 60)));
          },
        });
      } catch {
        setPass3SynthOpen(false);
        pass3Reset();
        showAppToast(t('timeline.roadmap.synthError'));
        return;
      }
      try {
        await insertDailySummary({ summaryDateYmd: ymd, contentHtml: html });
      } catch {
        /* ignore */
      }
      pass3Bump(94);
      pass3AfterSprintRef.current = () => {
        setPass3SynthOpen(false);
        pass3Reset();
        setPass3ReportHtml(html);
        setPass3ReportOpen(true);
      };
      pass3Sprint();
    },
    [i18n.language, pass3Begin, pass3Bump, pass3Reset, pass3Sprint, t],
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
            accessibilityLabel={t('timeline.roadmap.printerA11y')}
            onPress={() => void openDailyRoadmapPrinter()}
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
            <Printer size={20} color={theme.colors.onBackground} />
          </Pressable>
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
  }, [navigation, openDailyRoadmapPrinter, t, theme]);

  /** Borne les appels async (retry offline-first IA). */
  const withTimeout = useCallback(async <T,>(promise: Promise<T>, ms: number): Promise<T | null> => {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    });
    return (await Promise.race([promise, timeout])) as T | null;
  }, []);

  const [retryAiBusyId, setRetryAiBusyId] = useState<string | null>(null);
  const retryAiLockRef = useRef(false);

  /** Relance le tri / enrichissement IA pour une NOTE shell offline-first (`offlineFirstAiRetry`). */
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

  /** Pagination : append archives ou liste principale / tirelire selon le contexte. */
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
        setArchivedRows((prev) => [...prev, ...filterTimelineVisibleRows(slice)]);
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
        if (timeNav === 'ALL') {
          raw = await listTrankilV2AllTimelineItems(statusFilter, {
            paging: { limit: pageLimit, offset: primaryRows.length },
            context: ctx,
          });
        } else if (timeNav === 'TODAY') {
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
      setPrimaryRows((prev) => [...prev, ...filterTimelineVisibleRows(slice)]);
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

  /** Retire une ligne des listes locales après DONE définitif. */
  const removeRowFromPack = useCallback((rowId: string) => {
    setPrimaryRows((prev) => prev.filter((r) => r.id !== rowId));
    setArchivedRows((prev) => prev.filter((r) => r.id !== rowId));
    setUnorganizedTodo((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      return next;
    });
  }, []);

  /** Exécute `toggleIntentionDone` pour un id qui était en attente (fin du délai 3s). */
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

  /** Annule le timer « done » différé pour une carte. */
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

  /** Programme le passage à DONE après 3s (UX undo implicite si re-tap). */
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

  /** Orb complété : toggle entre « en attente » et annulation, avec haptique. */
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

  /** Navigation impérative vers l’onglet capture Talk (`TalkDebug` dans `AppNavigator`). */
  const navigateToAddTask = useCallback(() => {
    if (!rootNavigationRef.isReady()) return;
    rootNavigationRef.dispatch(
      CommonActions.navigate({
        name: 'App',
        params: { screen: 'Tabs', params: { screen: 'TalkDebug' } },
      } as never),
    );
  }, []);

  /** Sélection date mode `CUSTOM` (picker natif Android/iOS). */
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
    let rows: TrankilV2TimelineItemRow[];
    if (contextBubble === 'PIGGY') {
      rows = filterRowsByContext(primaryRows, contextBubble);
    } else if (contextBubble === 'ARCHIVES') {
      rows = filterRowsByContext(archivedRows, 'ALL');
    } else {
      rows = filterRowsByContext(primaryRows, contextBubble);
    }
    return filterTimelineVisibleRows(rows);
  }, [archivedRows, contextBubble, primaryRows]);

  const inboxTodayItems = inboxTodayRows;

  const inboxRootsView = useMemo(() => buildInboxRootsView(inboxTodayItems), [inboxTodayItems]);

  const ideaBankModalItems = useMemo(() => {
    if (ideaBankHubItems) return ideaBankHubItems;
    if (ideaBankMode === 'inbox') {
      return SOURCING_V1_ENABLED ? inboxRootsView.roots : inboxTodayItems;
    }
    if (ideaBankCategoryFilter === 'SHOP') return shopClusterRows;
    if (ideaBankCategoryFilter) {
      return boxStockRows.filter((r) => normalizeCategoryId(r.category_id) === ideaBankCategoryFilter);
    }
    return boxStockRows;
  }, [
    boxStockRows,
    ideaBankCategoryFilter,
    ideaBankHubItems,
    ideaBankMode,
    inboxTodayItems,
    inboxRootsView.roots,
    shopClusterRows,
  ]);

  const smartClusterVisible =
    timeNav === 'TODAY' && contextBubble === 'ALL' && statusFilter === 'TODO';

  const hubEligible = smartClusterVisible && timelineLayoutMode === 'EMAIL_HUB';

  const boxBlocks = useMemo(() => buildLivingHubBlocks(boxStockRows), [boxStockRows]);

  const routineBlocks = useMemo(() => {
    const completionDaysById = new Map(Object.entries(habitCompletionDaysById));
    return buildRoutineHubBlocks(activeHabitRows, {
      completionDaysById,
      targetDate: anchorDate,
    });
  }, [activeHabitRows, anchorDate, habitCompletionDaysById]);

  const smartClusterProps = useMemo(
    () => ({
      inboxCount: SOURCING_V1_ENABLED ? inboxRootsView.rootCount : smartClusterCounts.inboxToday,
      shopCount: smartClusterCounts.shopCount,
      boxCount: smartClusterCounts.boxCount,
      routinesCount: smartClusterCounts.routinesCount,
      projectsCount: smartClusterCounts.projectsToday,
    }),
    [smartClusterCounts, inboxRootsView.rootCount],
  );

  const clusterDebugContents = useMemo((): SmartClusterDebugContents => {
    const toEntry = (row: TrankilV2TimelineItemRow): SmartClusterDebugEntry => ({
      id: row.id,
      title: String(row.display_title ?? '').trim() || row.id,
    });
    const toEntryFromIdTitle = (row: { id: string; title: string }): SmartClusterDebugEntry => ({
      id: row.id,
      title: String(row.title ?? '').trim() || row.id,
    });
    return {
      inbox: inboxTodayItems.map(toEntry),
      shop: shopClusterRows.map(toEntry),
      box: boxStockRows.map(toEntry),
      routines: activeHabitRows.map(toEntry),
      projects: projectsTodayDebug.map(toEntryFromIdTitle),
    };
  }, [activeHabitRows, boxStockRows, inboxTodayItems, projectsTodayDebug, shopClusterRows]);

  const dayTitle = useCallback(
    (ymd: string): string => {
      const today = toYmd(anchorDate);
      const tomorrow = toYmd(addDays(anchorDate, 1));
      if (ymd === today) return t('horizons.today');
      if (ymd === tomorrow) return t('horizons.tomorrow');
      try {
        const [y, m, d] = ymd.split('-').map((x) => Number(x));
        const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
        const loc = Intl.DateTimeFormat().resolvedOptions().locale;
        return capitalizeFirst(new Intl.DateTimeFormat(loc, { weekday: 'long', month: 'short', day: '2-digit' }).format(dt));
      } catch {
        return ymd;
      }
    },
    [anchorDate, t],
  );

  const listEntries = useMemo((): ListEntry[] => {
    const todayYmd = toYmd(anchorDate);
    const isTodayView =
      timeNav === 'TODAY' && contextBubble !== 'PIGGY' && contextBubble !== 'ARCHIVES';
    const isAllTimeView =
      timeNav === 'ALL' && contextBubble !== 'PIGGY' && contextBubble !== 'ARCHIVES';

    if (isAllTimeView) {
      const rows = [...filteredPool].sort(
        (a, b) => Number(b.updated_at ?? b.created_at) - Number(a.updated_at ?? a.created_at),
      );
      if (rows.length === 0) return [];
      return [{ kind: 'rows', id: 'all-time', titleText: '', rows }];
    }

    const pool = isTodayView
      ? filteredPool
      : filteredPool.filter((r) => Boolean(normalizeDueDateLocal(r.due_date)));

    const enriched = pool
      .map((r) => {
        const dueYmd = normalizeDueDateLocal(r.due_date);
        let effectiveYmd: string | null = dueYmd;
        if (!effectiveYmd && isTodayView && (r.is_pinned ?? 0) === 1) {
          effectiveYmd = todayYmd;
        }
        if (!effectiveYmd) return null;
        const sortMs = (() => {
          const rawDue = String(r.due_date ?? '').trim();
          if (rawDue && /\dT\d{2}:\d{2}/.test(rawDue)) {
            const dt = new Date(rawDue);
            const ms = dt.getTime();
            if (Number.isFinite(ms)) return ms;
          }
          if (dueYmd) {
            const [y, m, d] = dueYmd.split('-').map((x) => Number(x));
            const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
            return dt.getTime();
          }
          return Number(r.created_at);
        })();
        return { row: r, effectiveYmd, sortMs };
      })
      .filter(Boolean) as Array<{ row: TrankilV2TimelineItemRow; effectiveYmd: string; sortMs: number }>;

    enriched.sort((a, b) => (a.effectiveYmd === b.effectiveYmd ? a.sortMs - b.sortMs : a.effectiveYmd.localeCompare(b.effectiveYmd)));

    const groups = new Map<string, TrankilV2TimelineItemRow[]>();
    for (const it of enriched) {
      const arr = groups.get(it.effectiveYmd) ?? [];
      arr.push(it.row);
      groups.set(it.effectiveYmd, arr);
    }

    const out: ListEntry[] = [];
    for (const [ymd, rows] of [...groups.entries()]) {
      out.push({
        kind: 'rows',
        id: ymd,
        titleText: dayTitle(ymd),
        rows,
      });
    }
    return out;
  }, [
    anchorDate,
    contextBubble,
    dayTitle,
    filteredPool,
    statusFilter,
    timeNav,
  ]);

  const narrativeBlocks = useMemo(() => {
    if (!hubEligible) return null;
    const todayYmd = toYmd(anchorDate);
    const todayEntry = listEntries.find((e) => e.id === todayYmd);
    return buildNarrativeTimelineBlocks(todayEntry?.rows ?? [], {
      activeHabits: activeHabitRows,
      targetDate: anchorDate,
      todayYmd,
      locale: i18n.language,
    });
  }, [activeHabitRows, anchorDate, hubEligible, i18n.language, listEntries]);

  const narrativeClockActive = hubEligible && timeNav === 'TODAY' && toYmd(anchorDate) === toYmd(new Date());
  const narrativeNowMs = useProbeScheduleClock(narrativeClockActive, 60_000);

  useEffect(() => {
    if (!narrativeBlocks?.length) return;
    configureTimelineListReloadAnimation();
  }, [narrativeBlocks, narrativeNowMs]);

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

  const sentinelFocusClockActive = useMemo(() => {
    if (!hubEligible) return false;
    const todayYmd = toYmd(anchorDate);
    const todayEntry = listEntries.find((e) => e.id === todayYmd);
    const todayRows = todayEntry?.rows ?? [];
    return hasSentinelFocusClockInterest(todayRows, {
      todayYmd,
      isProUser: spectrum.isProUser,
      locale: i18n.language,
    });
  }, [anchorDate, hubEligible, i18n.language, listEntries, spectrum.isProUser]);

  const sentinelFocusNowMs = useProbeScheduleClock(sentinelFocusClockActive, 10_000);

  const flatListItems = useMemo(() => {
    const todayYmd = toYmd(anchorDate);
    const todayLabel = t('horizons.today');
    const todayEntry = listEntries.find((e) => e.id === todayYmd);
    const todayRows = todayEntry?.rows ?? [];
    const base = flattenForVirtualList(
      listEntries,
      hubEligible
        ? { skipTodayYmd: todayYmd }
        : timeNav === 'ALL'
          ? { hideSectionHeaders: true }
          : undefined,
    );
    const out: TimelineFlatItem[] = [];
    let inserted = false;
    for (const it of base) {
      out.push(it);
      if (
        !inserted &&
        timeNav === 'TODAY' &&
        contextBubble !== 'PIGGY' &&
        contextBubble !== 'ARCHIVES' &&
        it.kind === 'section' &&
        it.titleText === todayLabel
      ) {
        if (hubEligible) {
          const focusPick = pickSentinelFocus(todayRows, {
            todayYmd,
            isProUser: spectrum.isProUser,
            locale: i18n.language,
            nowMs: sentinelFocusNowMs,
          });
          if (
            isSentinelFocusSlotVisible(focusPick, {
              locale: i18n.language,
              isProUser: spectrum.isProUser,
              nowMs: sentinelFocusNowMs,
              todayYmd,
            })
          ) {
            out.push({ kind: 'sentinelFocus', id: 'sentinel-focus', rows: todayRows });
          }
          if (narrativeBlocks) {
            const now = new Date(narrativeNowMs);
            const dimPastSegments = toYmd(anchorDate) === todayYmd;
            for (const block of narrativeBlocks) {
              out.push({
                kind: 'narrativeBlock',
                id: `narrative-${block.segmentId}`,
                block,
                isPast: dimPastSegments ? isTimeSegmentPast(block.segmentId, now) : false,
              });
            }
          }
        }
        inserted = true;
      }
    }
    return out;
  }, [
    anchorDate,
    contextBubble,
    narrativeBlocks,
    narrativeNowMs,
    hubEligible,
    i18n.language,
    listEntries,
    sentinelFocusNowMs,
    spectrum.isProUser,
    t,
    timeNav,
  ]);

  const flatListLayouts = useMemo(() => {
    const todayYmd = toYmd(anchorDate);
    const sentinelHeightById = new Map<string, number>();
    const narrativeHeightById = new Map<string, number>();
    for (const it of flatListItems) {
      if (it.kind === 'sentinelFocus') {
        sentinelHeightById.set(
          it.id,
          estimateSentinelFocusBadgeHeight(it.rows, {
            todayYmd,
            isProUser: spectrum.isProUser,
            locale: i18n.language,
            nowMs: sentinelFocusNowMs,
          }) || SENTINEL_FOCUS_FALLBACK_H,
        );
      }
      if (it.kind === 'narrativeBlock') {
        narrativeHeightById.set(it.id, estimateNarrativeBlockHeight(it.block));
      }
    }
    return buildFlatListLayouts(flatListItems, sentinelHeightById, narrativeHeightById);
  }, [anchorDate, flatListItems, i18n.language, sentinelFocusNowMs, spectrum.isProUser]);

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
      reload();
    });
    return () => sub.remove();
  }, [reload]);

  const openHubBlock = useCallback(
    (block: HubBlock) => {
      setIdeaBankMode('default');
      setIdeaBankCategoryFilter(null);
      setIdeaBankHubItems(block.items);
      setIdeaBankHubTitle(hubCategoryDisplayTitle(block.categoryId, t));
      setIdeaBankAutoTripPillRowId(null);
      setIdeaBankOpen(true);
    },
    [t],
  );

  const openNarrativeBlock = useCallback(
    (block: NarrativeTimelineBlock) => {
      setIdeaBankMode('default');
      setIdeaBankCategoryFilter(null);
      setIdeaBankHubItems(block.items);
      setIdeaBankHubTitle(timeSegmentDisplayTitle(block.segmentId, t));
      setIdeaBankAutoTripPillRowId(null);
      setIdeaBankOpen(true);
    },
    [t],
  );

  /** Sentinel Focus — suggestion : tirelire IdeaBank dédiée à ce trajet (itinéraire + pilule). */
  const openTripReminderInIdeaBank = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      const tripTitle =
        String(row.display_title || '').trim() ||
        generateSmartTitle(row.content_raw || '', i18n.language) ||
        t('intentionDetail.trip');

      setIdeaBankMode('default');
      setIdeaBankCategoryFilter(null);
      setIdeaBankHubItems([row]);
      setIdeaBankHubTitle(tripTitle);
      setIdeaBankAutoTripPillRowId(row.id);
      setIdeaBankOpen(true);
    },
    [i18n.language, t],
  );

  const onPressSentinelSuggestion = openTripReminderInIdeaBank;

  const openBoxBlock = useCallback(
    (block: HubBlock) => {
      setBoxViewOpen(false);
      openHubBlock(block);
    },
    [openHubBlock],
  );

  const openBoxView = useCallback(() => {
    setBoxViewOpen(true);
  }, []);

  const openRoutineBlock = useCallback(
    (block: HubBlock) => {
      setRoutinesViewOpen(false);
      openHubBlock(block);
    },
    [openHubBlock],
  );

  const openRoutinesView = useCallback(() => {
    setRoutinesViewOpen(true);
  }, []);

  const onClearBoxGlobal = useCallback(() => {
    if (boxStockRows.length === 0) return;
    Alert.alert(t('timeline.box.clearAllTitle'), t('timeline.box.clearAllBody', { count: boxStockRows.length }), [
      { text: t('timeline.ideaBank.cancel'), style: 'cancel' },
      {
        text: t('timeline.box.clearAllConfirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await bulkDeleteTrankilV2IntentionsByIds(boxStockRows.map((r) => r.id));
            await syncNativeRailAlarmsAfterIntentionWrite('boxClearAll');
            setBoxViewOpen(false);
            reload();
          })();
        },
      },
    ]);
  }, [boxStockRows, reload, t]);

  const renderTimelineFlatItem = useCallback(
    ({ item }: { item: TimelineFlatItem }) => {
      if (item.kind === 'section') {
        return (
          <View style={[styles.sectionHeaderOnly, { paddingHorizontal: 16 }]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>{item.titleText}</Text>
          </View>
        );
      }
      if (item.kind === 'sentinelFocus') {
        return (
          <View style={{ paddingHorizontal: 16 }}>
            <SentinelFocusBadge
              rows={item.rows}
              todayYmd={toYmd(anchorDate)}
              theme={theme}
              onOpenDetail={openDetail}
              onPressSuggestion={onPressSentinelSuggestion}
              onOpenProPaywall={() => {
                if (rootNavigationRef.isReady()) {
                  rootNavigationRef.navigate('ProSubscription');
                }
              }}
            />
          </View>
        );
      }
      if (item.kind === 'narrativeBlock') {
        return (
          <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
            <NarrativeTimelineBlockShell
              block={item.block}
              designTokens={designTokens}
              isPast={item.isPast}
              onPress={() => openNarrativeBlock(item.block)}
            />
          </View>
        );
      }
      if (item.kind === 'hubBlock') {
        return (
          <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
            <LivingHubBlockShell
              block={item.block}
              designTokens={designTokens}
              onPress={() => openHubBlock(item.block)}
            />
          </View>
        );
      }
      const row = item.row;
      const pid = String(row.parent_id ?? '').trim();
      const orbKey = row.type === 'HABIT' ? 'habits' : row.type === 'TASK' && pid ? 'projects' : row.type === 'TASK' ? 'tasks' : 'other';
      const showCompleteOrb = canShowCompleteOrb(orbKey, statusFilter);
      const card = (
        <IntentionCard
          row={row}
          theme={theme}
          pendingLocalDone={pendingLocalDone.has(row.id)}
          enabled={showCompleteOrb}
          onToggleComplete={() => void handleToggleRowComplete(row)}
          onPress={() => openDetail(row)}
          onPressTripFooter={(footer) => handleTripFooterPress(row, footer)}
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
      designTokens,
      handleToggleRowComplete,
      anchorDate,
      openHubBlock,
      openNarrativeBlock,
      onPressSentinelSuggestion,
      openDetail,
      handleTripFooterPress,
      pendingLocalDone,
      spectrum.isProUser,
      statusFilter,
      t,
      theme,
    ],
  );

  const openIdeaBankInbox = useCallback(() => {
    setIdeaBankHubItems(null);
    setIdeaBankHubTitle(undefined);
    setIdeaBankMode('inbox');
    setIdeaBankCategoryFilter(null);
    setIdeaBankOpen(true);
  }, []);

  const openIdeaBankShop = useCallback(() => {
    setIdeaBankHubItems(null);
    setIdeaBankHubTitle(undefined);
    setIdeaBankMode('default');
    setIdeaBankCategoryFilter('SHOP');
    setIdeaBankOpen(true);
  }, []);

  const smartClustersHeader = useMemo(() => {
    if (!smartClusterVisible) return null;
    return (
      <SmartClustersCarousel
        {...smartClusterProps}
        debugContents={clusterDebugContents}
        onPressInbox={openIdeaBankInbox}
        onPressShop={openIdeaBankShop}
        onPressBox={openBoxView}
        onPressRoutines={openRoutinesView}
        onPressProjects={() => {
          if (rootNavigationRef.isReady()) rootNavigationRef.navigate('ProjectList');
        }}
      />
    );
  }, [
    clusterDebugContents,
    openBoxView,
    openIdeaBankInbox,
    openIdeaBankShop,
    openRoutinesView,
    smartClusterProps,
    smartClusterVisible,
  ]);

  return (
    <View style={[styles.root, { backgroundColor: designTokens.backgroundColor }]}>
      <Pass3CleanupSasOverlay
        visible={pass3SasOpen}
        theme={theme}
        todayYmd={formatYmdLocal(new Date())}
        initialRows={pass3CleanupRows}
        translate={t}
        onClose={() => setPass3SasOpen(false)}
        onLaunchSynthesis={handlePass3LaunchSynthesis}
      />
      <AIUniversalProgressOverlay
        isVisible={pass3SynthOpen}
        progress={pass3Progress}
        label={pass3OverlayLabel}
      />
      <DailyRoadmapReportModal
        visible={pass3ReportOpen}
        theme={theme}
        title={t('timeline.roadmap.linkOpenSaved')}
        htmlBody={pass3ReportHtml}
        translate={t}
        onClose={() => setPass3ReportOpen(false)}
      />
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
          hubEligible,
          timelineLayoutMode,
        }}
        getItemLayout={hubEligible ? undefined : getItemLayout}
        removeClippedSubviews={RPlatform.OS === 'android'}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onEndReached={() => void loadMoreRows()}
        onEndReachedThreshold={0.35}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        ListHeaderComponent={smartClustersHeader}
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
                  <PressableScale
                    onPress={navigateToAddTask}
                    hapticType="light"
                    style={[
                      neumorphicRaised(theme),
                      styles.customEmptyCta,
                      { borderWidth: 1, borderColor: theme.colors.primary },
                    ]}
                  >
                    <Text style={[styles.customEmptyCtaText, { color: theme.colors.primary }]}>
                      {t('timeline.customDayAddTask')}
            </Text>
                  </PressableScale>
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
        initialPosition={detailPosition}
        peekHeightPx={detailPeekHeightPx}
        validationMode
        peekCapturePhase={peekCapturePhase}
        captureSheetMaxHeightRatio={peekCapturePhase !== 'idle' ? CAPTURE_SHEET_FULL_MAX_RATIO : undefined}
        autoTriggerPass2={autoTriggerPass2}
        autoFocusTripArrivalEdit={autoFocusTripArrivalEdit}
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

      <LivingHubCategoryModal
        visible={boxViewOpen}
        title={t('timeline.box.title')}
        blocks={boxBlocks}
        totalCount={boxStockRows.length}
        designTokens={designTokens}
        accentColor={theme.colors.primary}
        errorColor={theme.colors.error}
        onClose={() => setBoxViewOpen(false)}
        onPressBlock={openBoxBlock}
        onClearAll={onClearBoxGlobal}
        clearAllLabel={t('timeline.box.clearAll')}
        emptyMessage={t('timeline.box.empty')}
        closeLabel={t('timeline.ideaBank.close')}
        variant="default"
      />

      <LivingHubCategoryModal
        visible={routinesViewOpen}
        title={t('timeline.routines.title')}
        blocks={routineBlocks}
        totalCount={activeHabitRows.length}
        designTokens={designTokens}
        accentColor={theme.colors.primary}
        errorColor={theme.colors.error}
        onClose={() => setRoutinesViewOpen(false)}
        onPressBlock={openRoutineBlock}
        emptyMessage={t('timeline.routines.empty')}
        closeLabel={t('timeline.ideaBank.close')}
        variant="routine"
      />

      <IdeaBankModal
        visible={ideaBankOpen}
        onClose={() => {
          setIdeaBankCategoryFilter(null);
          setIdeaBankMode('default');
          setIdeaBankHubItems(null);
          setIdeaBankHubTitle(undefined);
          setIdeaBankAutoTripPillRowId(null);
          setIdeaBankOpen(false);
        }}
        autoTripPillRowId={ideaBankAutoTripPillRowId}
        onAutoTripPillConsumed={() => setIdeaBankAutoTripPillRowId(null)}
        items={ideaBankModalItems}
        status={statusFilter}
        anchorDate={anchorDate}
        onChanged={reload}
        mode={ideaBankMode}
        title={
          ideaBankHubTitle ??
          (ideaBankCategoryFilter === 'SHOP'
            ? t('timeline.ideaBank.shopTitle')
            : ideaBankMode === 'inbox'
              ? t('timeline.smartClusters.inbox')
              : undefined)
        }
        onEditItem={openDetail}
        onPass2Item={openDetailWithPass2}
        onPatchItem={patchRow}
        onOpenTripSetup={openDetailWithTripSetup}
        inboxChildrenByParentId={ideaBankMode === 'inbox' ? inboxRootsView.childrenByParentId : undefined}
        inboxZoomView={ideaBankMode === 'inbox' ? inboxRootsView.zoomView : undefined}
      />
    </View>
  );
}

function createTimelineScreenStyles(typography: ZenTypography) {
  return StyleSheet.create({
  root: { flex: 1 },
  listFlex: { flex: 1 },
  listContent: { flexGrow: 1 },
  navHeaderPill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, marginLeft: 12 },
  navHeaderTitle: { fontSize: typography.title, fontWeight: '800' },
  navHeaderFilterBtn: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  headerStack: { paddingHorizontal: 12, paddingTop: 8, gap: 10 },
  headTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  screenTitle: { fontSize: typography.hero, fontWeight: '700' },
  cardBlock: { marginBottom: 0 },
  cardLabel: { fontSize: typography.caption, fontWeight: '600', letterSpacing: 0.35, marginBottom: 6, opacity: 0.92 },
  segment: { marginTop: 0, minHeight: 36 },
  segmentBtnCompact: { minHeight: 32 },
  segmentLabelCompact: { fontSize: typography.label, fontWeight: '600' },
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
  timeBadgeText: { fontSize: typography.caption, fontWeight: '800', color: '#7c2d12' },
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
  bubbleLabel: { fontSize: typography.label, fontWeight: '600' },
  piggyBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,140,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  piggyBadgeText: { fontSize: typography.caption, fontWeight: '800', color: '#7c2d12' },
  statusRow: { flexDirection: 'row', gap: 10 },
  statusBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  statusBtnText: { fontSize: typography.bodySmall, fontWeight: '600' },
  section: { paddingHorizontal: 16, paddingVertical: 10 },
  sectionHeaderOnly: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  sectionTitle: { fontSize: typography.title, fontWeight: '700', marginBottom: 8 },
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
  skyClearText: { fontSize: typography.title, fontWeight: '600', textAlign: 'center', lineHeight: 24 },
  changeDateLink: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  changeDateLinkText: { fontSize: typography.label, fontWeight: '600' },
  customEmptyBlock: { alignItems: 'center', gap: 16, maxWidth: 320 },
  customEmptyCta: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
  },
  customEmptyCtaText: { fontSize: typography.bodyLarge, fontWeight: '700', textAlign: 'center' },
  ideaBankPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
  },
  ideaBankPressableColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 0,
  },
  ideaBankLabel: { fontSize: typography.title, fontWeight: '700' },
  ideaBankClusterSubtitle: { fontSize: typography.bodySmall, fontWeight: '600', marginTop: 4, opacity: 0.92 },
  });
}
