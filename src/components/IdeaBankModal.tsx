import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon, IconButton, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  bulkDeleteTrankilV2IntentionsByIds,
  logTrankilV2HabitOccurrence,
  markTrankilV2IntentionDone,
  patchMetadata,
  toggleIntentionDone,
  type TrankilIntentStatus,
  type TrankilV2TimelineItemRow,
} from '../api';
import { syncNativeRailAlarmsAfterIntentionWrite } from '../api/intentionHardwareSync';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import { toggleTripSurveillanceForRow } from '../services/traffic/tripSurveillanceToggle';
import { persistTripArrivalAddress, persistTripOriginAddress } from '../services/traffic/persistTripArrivalAddress';
import { showAppToast } from '../services/appToast';
import { runIntentionAlarmSchedule } from '../services/intentionAlarmSchedule';
import { Platform as RPlatform } from '../utils/rnPlatform';
import { PressableScale } from './common/PressableScale';
import { IdeaBankTripItineraryBlock } from './IdeaBankTripItineraryBlock';
import {
  GooglePlacesAutocompleteField,
  type GooglePlaceSelection,
} from './traffic/GooglePlacesAutocompleteField';
import { generateSmartTitle } from '../services/smartTitle';
import { useDesignTokens } from '../hooks/useDesignTokens';
import { formatCreationSubtitle } from '../utils/timeFormat';
import { HabitStreakCompact, getHabitStreakData } from '../features/livingHub';
import { resolveCadenceLabel } from '../features/livingHub/formatRoutineItemLine';
import { isTrackStreakEnabled, parseIntentionMetadata } from '../utils/intentionMetadata';
import {
  formatPass2PillLabel,
  isIdeaBankTripPillReady,
  resolveIdeaBankTripPillLabel,
  resolvePass2FooterAction,
  showIdeaBankTripPill,
  showPass2CardCta,
} from '../utils/pass2IntentionCard';
import { isTripAllDay } from '../utils/tripElasticDisplay';
import {
  hasTripArrivalAddress,
  isTripReadyForIdeaBankSurveillance,
  resolveTripArrivalLabel,
  resolveTripOriginAddressRaw,
} from '../utils/tripItineraryDisplay';
import { resolveTripSurveillanceUiState } from '../utils/tripSurveillanceButton';
import { getTripMetaFromRoot } from '../utils/tripTimelineCard';
import {
  canPlanIntentionNativeAlarm,
  readIntentionAlarmSetFlag,
} from '../utils/intentAlarmTemporal';
import { HubTaskCheckbox, HUB_TASK_CHECKBOX_SIZE } from './HubTaskCheckbox';
import { HubSelectionRing } from './HubSelectionRing';
import { InboxLineTitle } from './InboxLineTitle';
import { SOURCING_V1_ENABLED } from '../config/features';
import { isSourcedCaptureParent } from '../utils/inboxRootsView';
import {
  collectAllSelectableIds,
  collectAutoExpandParentIds,
  collectAutoExpandZoomJalonKeys,
  resolveHubDeleteIntentionIds,
  resolveParentSelectionVisual,
  resolveSourcingChildIds,
  resolveZoomTaskIdsForProject,
  toggleHubChildSelection,
  toggleHubParentSelection,
  toggleHubRowSelection,
  type HubSelectionVisual,
} from '../utils/hubDeleteModel';
import type { HubContext } from '../utils/hubProcessModel';
import { resolveHubModalDefaultTitle } from '../utils/hubProcessModel';
import type { ZoomInboxView } from '../utils/zoomInboxModel';
import { buildZoomJalonKey, resolveRowZoomParentJalonUid } from '../utils/zoomInboxModel';
import { categoryPastelTabBackground } from '../utils/categoryPastel';
import {
  parseProjectBriefFromMetadataJson,
  resolveTravelProjectMilestonesForInbox,
} from '../utils/travelProjectModel';
import {
  buildProjectMilestonesMetadataPatch,
  parseProjectMilestonesPayloadFromMetadataJson,
  type ProjectMilestonesPayload,
} from '../services/projectMilestonesModel';
import {
  resolveTravelProjectBadgeLabel,
  TravelMilestoneInboxRows,
} from './TravelMilestoneInboxRows';

type Props = {
  visible: boolean;
  onClose: () => void;
  items: TrankilV2TimelineItemRow[];
  status: TrankilIntentStatus;
  anchorDate: Date;
  onChanged: () => void;
  title?: string;
  /** Contexte hub (Inbox, Box, Shop, Routines, bloc catégorie). */
  hubContext?: HubContext;
  /** Ferme la tirelire puis ouvre le Studio (`IntentionDetailSheet`). */
  onEditItem: (row: TrankilV2TimelineItemRow) => void;
  /** Ferme la tirelire puis ouvre le détail avec déclenchement Pass 2. */
  onPass2Item?: (row: TrankilV2TimelineItemRow) => void;
  /** Patch optimiste d'une ligne (timeline + état local tirelire). */
  onPatchItem?: (id: string, patch: Partial<TrankilV2TimelineItemRow>) => void;
  /** Ferme la tirelire puis ouvre la sheet trajet (adresse / heure manquante). */
  onOpenTripSetup?: (row: TrankilV2TimelineItemRow) => void;
  /** À l’ouverture : déclenche la pilule TRIP « Me prévenir… » (Sentinel Focus, etc.). */
  autoTripPillRowId?: string | null;
  onAutoTripPillConsumed?: () => void;
  /** Enfants TASK groupés par parent_id (accordéon sourcing). */
  hubChildrenByParentId?: Map<string, TrankilV2TimelineItemRow[]>;
  /** Sous-tâches zoom groupées par jalon sous le projet parent. */
  hubZoomView?: ZoomInboxView;
};

/** Slot lead unifié (case ou badge accordéon). */
const HUB_LEAD_SLOT = HUB_TASK_CHECKBOX_SIZE + 8;

function mergeProjectMilestonesMetadataJson(
  metadataJson: string | null | undefined,
  payload: ProjectMilestonesPayload,
): string {
  const root = safeParseJsonObject(metadataJson) ?? {};
  return JSON.stringify({ ...root, ...buildProjectMilestonesMetadataPatch(payload) });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function resolveDisplayTitle(row: TrankilV2TimelineItemRow): string {
  const base = String(row.display_title || '').trim();
  if (base) return base;
  if (row.type === 'NOTE' || row.type === 'AUDIO') {
    return generateSmartTitle(row.content_raw || '') || (row.type === 'AUDIO' ? 'timeline.memoAudio' : 'timeline.note');
  }
  return 'timeline.untitled';
}

function formatLineTitle(raw: string, t: (k: string) => string): string {
  if (!raw) return t('timeline.untitled');
  if (raw.startsWith('timeline.')) return t(raw);
  return raw;
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

function mergeRowPatch(
  row: TrankilV2TimelineItemRow,
  patch: Partial<TrankilV2TimelineItemRow>,
): TrankilV2TimelineItemRow {
  return { ...row, ...patch };
}

/** Durée approximative de l'animation slide de la tirelire (ms). */
const IDEA_BANK_SHEET_DISMISS_MS = 320;

type TripAddressSearchKind = 'origin' | 'arrival';

type TripAddressSearchTarget = {
  row: TrankilV2TimelineItemRow;
  kind: TripAddressSearchKind;
};

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

export function IdeaBankModal({
  visible,
  onClose,
  items,
  status,
  anchorDate,
  onChanged,
  title,
  hubContext = { kind: 'block' },
  onEditItem,
  onPass2Item,
  onPatchItem,
  onOpenTripSetup,
  autoTripPillRowId,
  onAutoTripPillConsumed,
  hubChildrenByParentId,
  hubZoomView,
}: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const designTokens = useDesignTokens();
  const { spectrum } = useUserSpectrum();
  const isProUser = spectrum.isProUser;
  const insets = useSafeAreaInsets();
  const pendingEditRowRef = useRef<TrankilV2TimelineItemRow | null>(null);
  const pendingPass2RowRef = useRef<TrankilV2TimelineItemRow | null>(null);
  const pendingTripSetupRowRef = useRef<TrankilV2TimelineItemRow | null>(null);
  const autoTripPillFiredRef = useRef(false);
  const [localItemPatches, setLocalItemPatches] = useState<Map<string, Partial<TrankilV2TimelineItemRow>>>(
    () => new Map(),
  );
  const [tripPillBusyIds, setTripPillBusyIds] = useState<Set<string>>(() => new Set());
  const [alarmPillBusyIds, setAlarmPillBusyIds] = useState<Set<string>>(() => new Set());
  const [searchTarget, setSearchTarget] = useState<TripAddressSearchTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingLocalDone, setPendingLocalDone] = useState<Set<string>>(() => new Set());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRowsRef = useRef<Map<string, TrankilV2TimelineItemRow>>(new Map());
  const [expandedParentIds, setExpandedParentIds] = useState<Set<string>>(() => new Set());
  const [expandedZoomJalonKeys, setExpandedZoomJalonKeys] = useState<Set<string>>(() => new Set());
  const [expandedZoomDoneJalonKeys, setExpandedZoomDoneJalonKeys] = useState<Set<string>>(() => new Set());
  const [expandedTravelDoneProjectIds, setExpandedTravelDoneProjectIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);

  const hubPoolRows = useMemo(() => {
    const rows = [...items];
    const seen = new Set(items.map((r) => r.id));
    if (hubChildrenByParentId) {
      for (const children of hubChildrenByParentId.values()) {
        for (const child of children) {
          if (!seen.has(child.id)) {
            rows.push(child);
            seen.add(child.id);
          }
        }
      }
    }
    if (hubZoomView) {
      for (const children of hubZoomView.childrenByJalonKey.values()) {
        for (const child of children) {
          if (!seen.has(child.id)) {
            rows.push(child);
            seen.add(child.id);
          }
        }
      }
    }
    return rows;
  }, [hubChildrenByParentId, hubZoomView, items]);

  const deleteResolveSummary = useMemo(
    () =>
      resolveHubDeleteIntentionIds({
        selectedIds,
        roots: items,
        poolRows: hubPoolRows,
        childrenByParentId: hubChildrenByParentId,
        zoomView: hubZoomView,
      }),
    [hubChildrenByParentId, hubPoolRows, hubZoomView, items, selectedIds],
  );

  const refresh = useCallback(async () => {
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    if (visible) {
      setLocalItemPatches(new Map());
      setExpandedParentIds(new Set());
      setExpandedZoomJalonKeys(new Set());
      setExpandedZoomDoneJalonKeys(new Set());
      setExpandedTravelDoneProjectIds(new Set());
    } else {
      setSearchTarget(null);
      setSearchQuery('');
      setSelectionMode(false);
      setSelectedIds(new Set());
      setDeleteBusy(false);
    }
  }, [visible, items]);

  const resolveRow = useCallback(
    (row: TrankilV2TimelineItemRow): TrankilV2TimelineItemRow => {
      const patch = localItemPatches.get(row.id);
      return patch ? mergeRowPatch(row, patch) : row;
    },
    [localItemPatches],
  );

  const applyLocalPatch = useCallback(
    (id: string, patch: Partial<TrankilV2TimelineItemRow>) => {
      setLocalItemPatches((prev) => {
        const next = new Map(prev);
        next.set(id, { ...(next.get(id) ?? {}), ...patch });
        return next;
      });
      onPatchItem?.(id, patch);
    },
    [onPatchItem],
  );

  const syncPendingSet = useCallback((next: Set<string>) => {
    pendingLocalDoneRef.current = next;
    setPendingLocalDone(next);
  }, []);

  const finalizeDone = useCallback(
    async (row: TrankilV2TimelineItemRow) => {
      if (!pendingLocalDoneRef.current.has(row.id)) return;

      const tm = pendingTimeoutsRef.current.get(row.id);
      if (tm) clearTimeout(tm);
      pendingTimeoutsRef.current.delete(row.id);
      pendingRowsRef.current.delete(row.id);

      const next = new Set(pendingLocalDoneRef.current);
      next.delete(row.id);
      syncPendingSet(next);

      const isHabit = row.type === 'HABIT';
      if (!isHabit) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }

      if (isHabit) {
        await logTrankilV2HabitOccurrence(row.id, {
          dayKey: toYmd(anchorDate),
          source: 'ideaBankMarkDone',
        });
        await syncNativeRailAlarmsAfterIntentionWrite('ideaBankHabitOccurrence');
      } else {
        await markTrankilV2IntentionDone(row.id);
        await syncNativeRailAlarmsAfterIntentionWrite('ideaBankMarkDone');
      }
      await refresh();
    },
    [anchorDate, refresh, syncPendingSet],
  );

  const cancelPendingCommit = useCallback(
    (rowId: string) => {
      const tm = pendingTimeoutsRef.current.get(rowId);
      if (tm) clearTimeout(tm);
      pendingTimeoutsRef.current.delete(rowId);
      pendingRowsRef.current.delete(rowId);
      if (!pendingLocalDoneRef.current.has(rowId)) return;
      const next = new Set(pendingLocalDoneRef.current);
      next.delete(rowId);
      syncPendingSet(next);
    },
    [syncPendingSet],
  );

  const schedulePendingCommit = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      pendingRowsRef.current.set(row.id, row);
      const next = new Set(pendingLocalDoneRef.current);
      next.add(row.id);
      syncPendingSet(next);
      const tm = setTimeout(() => {
        pendingTimeoutsRef.current.delete(row.id);
        void finalizeDone(row);
      }, 3000);
      pendingTimeoutsRef.current.set(row.id, tm);
    },
    [finalizeDone, syncPendingSet],
  );

  const handleToggleDone = useCallback(
    async (row: TrankilV2TimelineItemRow) => {
      if (pendingLocalDoneRef.current.has(row.id)) {
        await safeMediumHaptic();
        cancelPendingCommit(row.id);
        return;
      }
      await safeSuccessHaptic();
      schedulePendingCommit(row);
    },
    [cancelPendingCommit, schedulePendingCommit],
  );

  const handleToggleZoomTaskDone = useCallback(
    async (taskRow: TrankilV2TimelineItemRow) => {
      if (taskRow.type !== 'TASK') return;
      await safeSuccessHaptic();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      try {
        await toggleIntentionDone(taskRow.id);
        const nextStatus: TrankilIntentStatus = taskRow.status === 'DONE' ? 'TODO' : 'DONE';
        applyLocalPatch(taskRow.id, { status: nextStatus });
        const projectId = String(taskRow.parent_id ?? '').trim();
        const jalonUid = resolveRowZoomParentJalonUid(taskRow);
        if (projectId && jalonUid && nextStatus === 'TODO') {
          const projectRow = items.find((r) => r.id === projectId);
          if (projectRow) {
            const resolvedProject = resolveRow(projectRow);
            const payload = parseProjectMilestonesPayloadFromMetadataJson(resolvedProject.metadata_json);
            const milestone = payload?.milestones.find((m) => m.uid === jalonUid);
            if (milestone?.checked && payload) {
              const nextPayload: ProjectMilestonesPayload = {
                ...payload,
                milestones: payload.milestones.map((m) =>
                  m.uid === jalonUid ? { ...m, checked: false } : m,
                ),
              };
              const merged = mergeProjectMilestonesMetadataJson(resolvedProject.metadata_json, nextPayload);
              applyLocalPatch(projectRow.id, { metadata_json: merged });
              await patchMetadata(projectRow.id, buildProjectMilestonesMetadataPatch(nextPayload), {
                silent: true,
              });
            }
          }
        }
        await syncNativeRailAlarmsAfterIntentionWrite('ideaBankZoomTaskToggle');
        await refresh();
      } catch {
        /* ignore */
      }
    },
    [applyLocalPatch, items, refresh, resolveRow],
  );

  const flushPendingCommits = useCallback(async () => {
    const rows = [...pendingRowsRef.current.values()];
    for (const row of rows) {
      await finalizeDone(row);
    }
  }, [finalizeDone]);

  useEffect(() => {
    if (visible) return;
    void flushPendingCommits();
  }, [flushPendingCommits, visible]);

  /** Ouvre la feuille détail après la descente complète de la tirelire. */
  useEffect(() => {
    if (visible) return;
    const tripSetupRow = pendingTripSetupRowRef.current;
    if (tripSetupRow && onOpenTripSetup) {
      pendingTripSetupRowRef.current = null;
      const timer = setTimeout(() => {
        onOpenTripSetup(tripSetupRow);
      }, IDEA_BANK_SHEET_DISMISS_MS);
      return () => clearTimeout(timer);
    }
    const pass2Row = pendingPass2RowRef.current;
    if (pass2Row && onPass2Item) {
      pendingPass2RowRef.current = null;
      const timer = setTimeout(() => {
        onPass2Item(pass2Row);
      }, IDEA_BANK_SHEET_DISMISS_MS);
      return () => clearTimeout(timer);
    }
    const row = pendingEditRowRef.current;
    if (!row) return;
    pendingEditRowRef.current = null;
    const timer = setTimeout(() => {
      onEditItem(row);
    }, IDEA_BANK_SHEET_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onEditItem, onOpenTripSetup, onPass2Item, visible]);

  useEffect(() => {
    return () => {
      for (const tm of pendingTimeoutsRef.current.values()) {
        clearTimeout(tm);
      }
      pendingTimeoutsRef.current.clear();
      pendingRowsRef.current.clear();
    };
  }, []);

  const exitSelectionMode = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback(() => {
    if (items.length === 0) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectionMode(true);
    setSelectedIds(new Set());
    setExpandedParentIds(
      collectAutoExpandParentIds({
        roots: items,
        childrenByParentId: hubChildrenByParentId,
        hasTravelSteps: (root) => {
          if (root.type !== 'PROJECT') return false;
          return resolveTravelProjectMilestonesForInbox(root.metadata_json).length > 0;
        },
      }),
    );
    setExpandedZoomJalonKeys(collectAutoExpandZoomJalonKeys({ roots: items, zoomView: hubZoomView }));
    setExpandedTravelDoneProjectIds(
      new Set(
        items
          .filter((root) => root.type === 'PROJECT')
          .filter((root) => resolveTravelProjectMilestonesForInbox(root.metadata_json).some((m) => m.checked))
          .map((root) => root.id),
      ),
    );
  }, [hubChildrenByParentId, hubZoomView, items]);

  const resolveRootCascadeChildIds = useCallback(
    (row: TrankilV2TimelineItemRow): string[] => {
      if (isSourcedCaptureParent(row)) {
        return resolveSourcingChildIds(row.id, hubChildrenByParentId);
      }
      if (row.type === 'PROJECT') {
        return resolveZoomTaskIdsForProject(row.id, hubZoomView);
      }
      return [];
    },
    [hubChildrenByParentId, hubZoomView],
  );

  const toggleRowSelection = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      setSelectedIds((prev) => {
        const cascadeChildIds = resolveRootCascadeChildIds(row);
        if (cascadeChildIds.length > 0) {
          return toggleHubParentSelection(row.id, cascadeChildIds, prev);
        }
        return toggleHubRowSelection(row.id, prev);
      });
    },
    [resolveRootCascadeChildIds],
  );

  const toggleSourcingChildSelection = useCallback(
    (parentId: string, childId: string, allChildIds: string[]) => {
      setSelectedIds((prev) => toggleHubChildSelection(parentId, childId, allChildIds, prev));
    },
    [],
  );

  const toggleZoomTaskSelection = useCallback(
    (projectRow: TrankilV2TimelineItemRow, task: TrankilV2TimelineItemRow) => {
      const allChildIds = resolveZoomTaskIdsForProject(projectRow.id, hubZoomView);
      setSelectedIds((prev) => toggleHubChildSelection(projectRow.id, task.id, allChildIds, prev));
    },
    [hubZoomView],
  );

  const resolveRowSelectionVisual = useCallback(
    (row: TrankilV2TimelineItemRow): HubSelectionVisual => {
      const cascadeChildIds = resolveRootCascadeChildIds(row);
      if (cascadeChildIds.length > 0) {
        return resolveParentSelectionVisual(row.id, cascadeChildIds, selectedIds);
      }
      return selectedIds.has(row.id) ? 'all' : 'none';
    },
    [resolveRootCascadeChildIds, selectedIds],
  );

  const resolveChildSelectionVisual = useCallback(
    (childId: string): HubSelectionVisual => (selectedIds.has(childId) ? 'all' : 'none'),
    [selectedIds],
  );

  const selectAllRows = useCallback(() => {
    setSelectedIds(
      new Set(
        collectAllSelectableIds({
          roots: items,
          childrenByParentId: hubChildrenByParentId,
          zoomView: hubZoomView,
        }),
      ),
    );
  }, [hubChildrenByParentId, hubZoomView, items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const confirmDeleteSelected = useCallback(() => {
    const summary = resolveHubDeleteIntentionIds({
      selectedIds,
      roots: items,
      poolRows: hubPoolRows,
      childrenByParentId: hubChildrenByParentId,
      zoomView: hubZoomView,
    });
    const ids = summary.intentionIds;
    if (ids.length === 0) return;

    const bodyParts = [
      t('timeline.hubDeleteConfirmBody', {
        count: ids.length,
        defaultValue: `Supprimer définitivement ${ids.length} élément(s) de la base de données ?`,
      }),
    ];
    if (summary.sourcingChildCount > 0) {
      bodyParts.push(
        t('timeline.hubDeleteConfirmSourcingChildren', {
          count: summary.sourcingChildCount,
          defaultValue: `${summary.sourcingChildCount} action(s) sourcing incluse(s).`,
        }),
      );
    }
    if (summary.zoomTaskCount > 0) {
      bodyParts.push(
        t('timeline.hubDeleteConfirmZoomTasks', {
          count: summary.zoomTaskCount,
          defaultValue: `${summary.zoomTaskCount} sous-tâche(s) zoom incluse(s).`,
        }),
      );
    }
    if (summary.habitCount > 0) {
      bodyParts.push(
        t('timeline.hubDeleteConfirmHabits', {
          count: summary.habitCount,
          defaultValue:
            summary.habitCount === 1
              ? '1 routine sera supprimée définitivement.'
              : `${summary.habitCount} routines seront supprimées définitivement.`,
        }),
      );
    }

    Alert.alert(
      t('timeline.hubDeleteConfirmTitle', { defaultValue: 'Supprimer définitivement ?' }),
      bodyParts.join('\n\n'),
      [
        { text: t('timeline.ideaBank.cancel'), style: 'cancel' },
        {
          text: t('timeline.hubDeleteConfirmAction', {
            count: ids.length,
            defaultValue: `Supprimer (${ids.length})`,
          }),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeleteBusy(true);
              try {
                await bulkDeleteTrankilV2IntentionsByIds(ids);
                await syncNativeRailAlarmsAfterIntentionWrite('ideaBankBulkDelete');
                exitSelectionMode();
                await refresh();
                if (summary.rootCount >= items.length) onClose();
              } catch {
                showAppToast(t('timeline.hubDeleteFailed', { defaultValue: 'Suppression impossible' }));
              } finally {
                setDeleteBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [
    exitSelectionMode,
    hubChildrenByParentId,
    hubPoolRows,
    hubZoomView,
    items,
    onClose,
    refresh,
    selectedIds,
    t,
  ]);

  const openStudio = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      pendingEditRowRef.current = row;
      onClose();
    },
    [onClose],
  );

  const triggerPass2 = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      if (!onPass2Item) {
        openStudio(row);
        return;
      }
      pendingPass2RowRef.current = row;
      onClose();
    },
    [onClose, onPass2Item, openStudio],
  );

  const toggleSourcedParentExpand = useCallback((parentId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }, []);

  const toggleZoomJalonExpand = useCallback((jalonKey: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedZoomJalonKeys((prev) => {
      const next = new Set(prev);
      if (next.has(jalonKey)) next.delete(jalonKey);
      else next.add(jalonKey);
      return next;
    });
  }, []);

  const toggleZoomDoneSectionExpand = useCallback((jalonKey: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedZoomDoneJalonKeys((prev) => {
      const next = new Set(prev);
      if (next.has(jalonKey)) next.delete(jalonKey);
      else next.add(jalonKey);
      return next;
    });
  }, []);

  const toggleTravelDoneSectionExpand = useCallback((projectId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedTravelDoneProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const handleToggleTravelMilestoneDone = useCallback(
    async (projectRow: TrankilV2TimelineItemRow, milestoneUid: string) => {
      const resolved = resolveRow(projectRow);
      const payload = parseProjectMilestonesPayloadFromMetadataJson(resolved.metadata_json);
      if (!payload) return;
      const target = payload.milestones.find((m) => m.uid === milestoneUid);
      if (!target) return;
      await safeSuccessHaptic();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const nextPayload: ProjectMilestonesPayload = {
        ...payload,
        milestones: payload.milestones.map((m) =>
          m.uid === milestoneUid ? { ...m, checked: !Boolean(m.checked) } : m,
        ),
      };
      try {
        applyLocalPatch(projectRow.id, {
          metadata_json: mergeProjectMilestonesMetadataJson(resolved.metadata_json, nextPayload),
        });
        await patchMetadata(projectRow.id, buildProjectMilestonesMetadataPatch(nextPayload), { silent: true });
        await refresh();
      } catch {
        /* ignore */
      }
    },
    [applyLocalPatch, refresh, resolveRow],
  );

  const openAddressSearch = useCallback(
    (row: TrankilV2TimelineItemRow, kind: TripAddressSearchKind) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const resolved = resolveRow(row);
      const metaRoot = safeParseJsonObject(resolved.metadata_json);
      const trip = getTripMetaFromRoot(metaRoot);
      const initial =
        kind === 'arrival'
          ? resolveTripArrivalLabel(resolved, trip, metaRoot) ?? ''
          : resolveTripOriginAddressRaw(trip) ?? '';
      setSearchQuery(initial);
      setSearchTarget({ row: resolved, kind });
    },
    [resolveRow],
  );

  const closeAddressSearch = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSearchTarget(null);
    setSearchQuery('');
  }, []);

  const handleAddressSelect = useCallback(
    async (place: GooglePlaceSelection) => {
      if (!searchTarget) return;
      await safeSuccessHaptic();
      try {
        const { row, kind } = searchTarget;
        const { metadata_json } =
          kind === 'arrival'
            ? await persistTripArrivalAddress({
                intentionId: row.id,
                metadataJson: row.metadata_json,
                place,
              })
            : await persistTripOriginAddress({
                intentionId: row.id,
                metadataJson: row.metadata_json,
                place,
              });
        applyLocalPatch(row.id, { metadata_json });
      } catch {
        showAppToast(t('intentionDetail.surveillanceMissingInfo'));
        return;
      }
      closeAddressSearch();
      void refresh();
    },
    [applyLocalPatch, closeAddressSearch, refresh, searchTarget, t],
  );

  const openTripSetup = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      if (onOpenTripSetup) {
        pendingTripSetupRowRef.current = row;
        onClose();
        return;
      }
      openStudio(row);
    },
    [onClose, onOpenTripSetup, openStudio],
  );

  const handleTripPillPress = useCallback(
    async (row: TrankilV2TimelineItemRow) => {
      if (tripPillBusyIds.has(row.id)) return;

      const meta = safeParseJsonObject(row.metadata_json);
      const trip = getTripMetaFromRoot(meta);
      const tripIsAllDay = Boolean(trip && isTripAllDay(meta, trip, row.due_date ?? null));
      const canEnable = isTripReadyForIdeaBankSurveillance({
        row,
        meta,
        trip,
        isProUser,
      });
      const remindActive = Number(row.remind_to_leave) === 1;
      const uiState = resolveTripSurveillanceUiState({
        isProUser,
        tripIsAllDay,
        remindToLeaveEnabled: remindActive,
        canEnableRemindToLeave: canEnable,
      });

      if (uiState === 'free_locked') {
        if (rootNavigationRef.isReady()) {
          rootNavigationRef.navigate('ProSubscription');
        }
        return;
      }

      if (uiState === 'pro_incomplete' || !canEnable) {
        if (!hasTripArrivalAddress(row, trip, meta)) {
          openAddressSearch(row, 'arrival');
        } else {
          openTripSetup(row);
        }
        return;
      }

      setTripPillBusyIds((prev) => new Set(prev).add(row.id));
      try {
        const { result, patch } = await toggleTripSurveillanceForRow({ row, uiState });
        if (result === 'incomplete') {
          showAppToast(t('intentionDetail.surveillanceMissingInfo'));
          if (!hasTripArrivalAddress(row, trip, meta)) {
            openAddressSearch(row, 'arrival');
          } else {
            openTripSetup(row);
          }
          return;
        }
        if (result === 'toggled_on') {
          await safeSuccessHaptic();
        }
        if (patch) {
          applyLocalPatch(row.id, patch);
        }
        void refresh();
      } finally {
        setTripPillBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }
    },
    [applyLocalPatch, isProUser, openAddressSearch, openTripSetup, refresh, t, tripPillBusyIds],
  );

  const handleAlarmPillPress = useCallback(
    async (row: TrankilV2TimelineItemRow) => {
      if (alarmPillBusyIds.has(row.id)) return;
      setAlarmPillBusyIds((prev) => new Set(prev).add(row.id));
      try {
        const ok = await runIntentionAlarmSchedule({
          row,
          translate: t,
          metadataJson: row.metadata_json,
          onPatchRow: applyLocalPatch,
        });
        if (ok) await safeSuccessHaptic();
      } finally {
        setAlarmPillBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }
    },
    [alarmPillBusyIds, applyLocalPatch, t],
  );

  useEffect(() => {
    if (!visible) {
      autoTripPillFiredRef.current = false;
      return;
    }
    const targetId = String(autoTripPillRowId ?? '').trim();
    if (!targetId || autoTripPillFiredRef.current) return;

    const row = items.find((source) => resolveRow(source).id === targetId);
    if (!row) {
      onAutoTripPillConsumed?.();
      return;
    }

    autoTripPillFiredRef.current = true;
    const timer = setTimeout(() => {
      void handleTripPillPress(row);
      onAutoTripPillConsumed?.();
    }, IDEA_BANK_SHEET_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [autoTripPillRowId, handleTripPillPress, items, onAutoTripPillConsumed, resolveRow, visible]);

  const showHubCheckbox = status === 'TODO' && !selectionMode;
  const selectedCount = deleteResolveSummary.intentionIds.length;
  const sheetTitle = selectionMode
    ? t('timeline.hubDeleteSelectedCount', {
        count: selectedCount,
        defaultValue: `${selectedCount} sélectionné(s)`,
      })
    : title ?? resolveHubModalDefaultTitle(hubContext, t);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { paddingTop: insets.top + 12 }]}>
        {RPlatform.OS !== 'web' ? (
          <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}
        <View
          style={[
            styles.sheet,
            designTokens.cardShadowStyle,
            {
              backgroundColor: designTokens.cardBackground,
              borderColor: theme.colors.outlineVariant,
              borderTopLeftRadius: designTokens.borderRadius,
              borderTopRightRadius: designTokens.borderRadius,
              paddingBottom: insets.bottom + 16,
              position: 'relative',
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            {selectionMode ? (
              <>
                <PressableScale
                  onPress={exitSelectionMode}
                  hitSlop={12}
                  hapticType="light"
                  disabled={deleteBusy}
                >
                  <Text style={{ color: designTokens.accentColor, fontWeight: '700' }}>
                    {t('timeline.hubDeleteModeCancel', { defaultValue: 'Annuler' })}
                  </Text>
                </PressableScale>
                <Text
                  style={[styles.sheetTitle, styles.sheetTitleCenter, { color: designTokens.textPrimary }]}
                  numberOfLines={1}
                >
                  {sheetTitle}
                </Text>
                <PressableScale
                  onPress={confirmDeleteSelected}
                  hitSlop={12}
                  hapticType="light"
                  disabled={deleteBusy || selectedCount === 0}
                >
                  <Text
                    style={{
                      color: selectedCount > 0 ? theme.colors.error : designTokens.textSecondary,
                      fontWeight: '700',
                      opacity: deleteBusy ? 0.5 : 1,
                    }}
                  >
                    {t('timeline.hubDeleteConfirmAction', {
                      count: selectedCount,
                      defaultValue: `Supprimer (${selectedCount})`,
                    })}
                  </Text>
                </PressableScale>
              </>
            ) : (
              <>
                <PressableScale onPress={enterSelectionMode} hitSlop={12} hapticType="light" disabled={items.length === 0}>
                  <Text style={{ color: theme.colors.error, fontWeight: '700', opacity: items.length === 0 ? 0.45 : 1 }}>
                    {t('timeline.hubDeleteModeEnter', { defaultValue: 'Supprimer' })}
                  </Text>
                </PressableScale>
                <Text
                  style={[styles.sheetTitle, styles.sheetTitleCenter, { color: designTokens.textPrimary }]}
                  numberOfLines={1}
                >
                  {sheetTitle}
                </Text>
                <PressableScale onPress={onClose} hitSlop={12} hapticType="light">
                  <Text style={{ color: designTokens.accentColor, fontWeight: '700' }}>
                    {t('timeline.ideaBank.close')}
                  </Text>
                </PressableScale>
              </>
            )}
          </View>

          {items.length === 0 ? (
            <Text style={{ color: designTokens.textSecondary, paddingHorizontal: 4 }}>
              {t('timeline.ideaBank.empty')}
            </Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {items.map((sourceRow) => {
                const row = resolveRow(sourceRow);
                const lineTitle = formatLineTitle(resolveDisplayTitle(row), t);
                const createdLine = formatCreationSubtitle(Number(row.created_at), t, i18n.language);
                const metaRoot = safeParseJsonObject(row.metadata_json);
                const habitMeta = parseIntentionMetadata(row.metadata_json);
                const trip = getTripMetaFromRoot(metaRoot);
                const isTripCard = Boolean(trip);
                const isHabit = row.type === 'HABIT';
                const cadenceLabel = isHabit ? resolveCadenceLabel(habitMeta) : null;
                const trackStreak = isHabit && isTrackStreakEnabled(habitMeta);
                const streakData = trackStreak ? getHabitStreakData(row.id) : null;
                const isPending = pendingLocalDone.has(row.id);
                const pass2Action = resolvePass2FooterAction(row);
                const showPass2Pill = !isTripCard && showPass2CardCta(row);
                const pass2Label = formatPass2PillLabel(pass2Action, t, isProUser);
                const showTripPill = isTripCard && showIdeaBankTripPill(row, metaRoot);
                const tripIsAllDay = Boolean(trip && isTripAllDay(metaRoot, trip, row.due_date ?? null));
                const canEnableSurveillance = isTripReadyForIdeaBankSurveillance({
                  row,
                  meta: metaRoot,
                  trip,
                  isProUser,
                });
                const remindActive = Number(row.remind_to_leave) === 1;
                const tripUiState = resolveTripSurveillanceUiState({
                  isProUser,
                  tripIsAllDay,
                  remindToLeaveEnabled: remindActive,
                  canEnableRemindToLeave: canEnableSurveillance,
                });
                const tripPillReady = isIdeaBankTripPillReady({
                  row,
                  meta: metaRoot,
                  trip,
                  isProUser,
                  uiState: tripUiState,
                });
                const tripPillLabel = showTripPill
                  ? resolveIdeaBankTripPillLabel({
                      uiState: tripUiState,
                      isProUser,
                      isReady: tripPillReady,
                      t,
                    })
                  : '';
                const tripPillBusy = tripPillBusyIds.has(row.id);
                const showAlarmPill = !isTripCard && canPlanIntentionNativeAlarm(row);
                const alarmPillActive = readIntentionAlarmSetFlag(row.metadata_json);
                const alarmPillBusy = alarmPillBusyIds.has(row.id);
                const alarmPillLabel = alarmPillActive
                  ? t('intentAlarm.alarmActive')
                  : t('intentAlarm.planAlarm');

                const isSourcedParent = isSourcedCaptureParent(row);
                const childRows =
                  isSourcedParent && hubChildrenByParentId
                    ? hubChildrenByParentId.get(row.id) ?? []
                    : [];
                const isExpanded = expandedParentIds.has(row.id);
                const showSourcingAccordion = isSourcedParent && childRows.length > 0;
                const sourcingChildCount = childRows.length;
                const sourcingA11yExpand = t('timeline.sourcingExpand', {
                  count: sourcingChildCount,
                  defaultValue: `Déplier ${sourcingChildCount} actions`,
                });
                const sourcingA11yCollapse = t('timeline.sourcingCollapse', {
                  count: sourcingChildCount,
                  defaultValue: `Replier ${sourcingChildCount} actions`,
                });
                const resolvedProjectRow = resolveRow(row);
                const travelBrief =
                  row.type === 'PROJECT'
                    ? parseProjectBriefFromMetadataJson(resolvedProjectRow.metadata_json)
                    : null;
                const travelMilestones =
                  travelBrief ? resolveTravelProjectMilestonesForInbox(resolvedProjectRow.metadata_json) : [];
                const travelStepCount = travelMilestones.length;
                const showTravelAccordion =
                  row.type === 'PROJECT' &&
                  travelBrief != null &&
                  travelStepCount > 0 &&
                  !showSourcingAccordion;
                const showLeftAccordionBadge = showSourcingAccordion || showTravelAccordion;
                const showRightAccordionChevron = showLeftAccordionBadge;
                const partyLeadCount = showSourcingAccordion
                  ? sourcingChildCount
                  : travelStepCount;
                const travelA11yExpand = t('timeline.travelProjectExpandSteps', {
                  count: travelStepCount,
                  defaultValue: `Déplier ${travelStepCount} étapes`,
                });
                const travelA11yCollapse = t('timeline.travelProjectCollapseSteps', {
                  count: travelStepCount,
                  defaultValue: `Replier ${travelStepCount} étapes`,
                });
                const accordionExpandLabel = showSourcingAccordion ? sourcingA11yExpand : travelA11yExpand;
                const accordionCollapseLabel = showSourcingAccordion ? sourcingA11yCollapse : travelA11yCollapse;
                const accordionBadgeLabel = showSourcingAccordion
                  ? t('timeline.sourcingBatchBadge', {
                      count: partyLeadCount,
                      defaultValue: `${partyLeadCount} actions extraites`,
                    })
                  : t('timeline.travelProjectStepsBadge', {
                      count: partyLeadCount,
                      defaultValue: `${partyLeadCount} étapes`,
                    });
                const leadBadgeText = showSourcingAccordion
                  ? `+${sourcingChildCount}`
                  : showTravelAccordion
                    ? resolveTravelProjectBadgeLabel({
                        milestones: travelMilestones,
                        projectId: row.id,
                        inboxZoomView: hubZoomView,
                        resolveRow,
                        fallbackCount: travelStepCount,
                      })
                    : `+${partyLeadCount}`;
                const toggleRowExpand = () => toggleSourcedParentExpand(row.id);
                const rowSelectionVisual = resolveRowSelectionVisual(row);
                const isRowSelected = rowSelectionVisual === 'all';
                const isRowPartial = rowSelectionVisual === 'partial';
                const sourcingChildIds = childRows.map((child) => child.id);
                const rowSelectA11y = isRowSelected
                  ? t('timeline.hubDeleteDeselectRow', { defaultValue: 'Désélectionner' })
                  : t('timeline.hubDeleteSelectRow', { defaultValue: 'Sélectionner pour supprimer' });

                if (__DEV__ && !isTripCard) {
                  console.log('[IntentAlarm] IdeaBank card', {
                    intentionId: row.id,
                    showAlarmPill,
                    dueDate: row.due_date,
                    metaDueDateYmd: metaRoot?.dueDateYmd,
                    metaDueDate: metaRoot?.due_date,
                  });
                }

                return (
                  <View key={row.id}>
                  <View
                    style={[
                      designTokens.cardShadowStyle,
                      styles.rowCard,
                      {
                        borderRadius: designTokens.borderRadius,
                        borderColor:
                          selectionMode && (isRowSelected || isRowPartial)
                            ? theme.colors.error
                            : theme.colors.outlineVariant,
                        borderWidth: selectionMode && (isRowSelected || isRowPartial) ? 2 : 1,
                        opacity: isPending ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View style={styles.cardMainRow}>
                      {selectionMode ? (
                        <HubSelectionRing
                          selected={isRowSelected}
                          indeterminate={isRowPartial}
                          onPress={() => toggleRowSelection(row)}
                          outlineColor={theme.colors.outline}
                          selectedColor={theme.colors.error}
                          a11yLabel={rowSelectA11y}
                        />
                      ) : showLeftAccordionBadge ? (
                        <PressableScale
                          style={styles.sourcingLeadSlot}
                          hapticType="light"
                          onPress={toggleRowExpand}
                          accessibilityRole="button"
                          accessibilityLabel={accordionBadgeLabel}
                        >
                          <View
                            style={[
                              styles.sourcingCountBadge,
                              showTravelAccordion && !showSourcingAccordion ? styles.sourcingCountBadgeWide : null,
                              { backgroundColor: categoryPastelTabBackground(row.category_id) },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sourcingCountText,
                                showTravelAccordion && !showSourcingAccordion ? styles.sourcingCountTextCompact : null,
                                { color: designTokens.textPrimary },
                              ]}
                            >
                              {leadBadgeText}
                            </Text>
                          </View>
                        </PressableScale>
                      ) : showHubCheckbox ? (
                        <HubTaskCheckbox
                          checked={isPending}
                          onPress={() => void handleToggleDone(row)}
                          outlineColor={theme.colors.outline}
                          a11yLabel={t('timeline.a11yTaskComplete')}
                        />
                      ) : (
                        <View style={{ width: HUB_LEAD_SLOT }} />
                      )}

                      <PressableScale
                        style={styles.detailPressable}
                        hapticType="light"
                        onPress={
                          selectionMode
                            ? () => toggleRowSelection(row)
                            : showLeftAccordionBadge
                              ? toggleRowExpand
                              : undefined
                        }
                        disabled={!selectionMode && !showLeftAccordionBadge}
                        accessibilityRole="button"
                        accessibilityLabel={
                          selectionMode
                            ? rowSelectA11y
                            : showLeftAccordionBadge
                              ? isExpanded
                                ? accordionCollapseLabel
                                : accordionExpandLabel
                              : lineTitle
                        }
                      >
                        {SOURCING_V1_ENABLED ? (
                          <InboxLineTitle
                            row={row}
                            textPrimary={designTokens.textPrimary}
                            textSecondary={designTokens.textSecondary}
                            locale={i18n.language}
                            sourcingChildCount={showSourcingAccordion ? sourcingChildCount : undefined}
                            omitTravelMilestoneInLine2={showTravelAccordion}
                            titleDone={isPending}
                          />
                        ) : (
                          <>
                            <Text
                              style={[
                                styles.rowTitle,
                                { color: designTokens.textPrimary },
                                isPending ? styles.rowTitleDone : null,
                              ]}
                              numberOfLines={2}
                            >
                              {lineTitle}
                              {cadenceLabel ? (
                                <Text style={[styles.habitCadence, { color: designTokens.textSecondary }]}>
                                  {' '}
                                  • {cadenceLabel}
                                </Text>
                              ) : null}
                            </Text>

                            <Text style={[styles.createdHint, { color: designTokens.textSecondary }]}>
                              {createdLine}
                            </Text>
                          </>
                        )}

                        {trackStreak && streakData && !selectionMode ? (
                          <HabitStreakCompact
                            data={streakData}
                            accentColor={designTokens.accentColor}
                            mutedColor={`${designTokens.textSecondary}33`}
                          />
                        ) : null}
                      </PressableScale>

                      {!selectionMode && showRightAccordionChevron ? (
                        <PressableScale
                          style={[
                            styles.sourcingChevronBtn,
                            { borderColor: theme.colors.outlineVariant, backgroundColor: designTokens.cardBackground },
                          ]}
                          hapticType="light"
                          onPress={toggleRowExpand}
                          accessibilityRole="button"
                          accessibilityLabel={
                            isExpanded ? accordionCollapseLabel : accordionExpandLabel
                          }
                        >
                          <Icon
                            source={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={24}
                            color={designTokens.textPrimary}
                          />
                        </PressableScale>
                      ) : !selectionMode ? (
                        <PressableScale
                          style={[
                            styles.studioBtn,
                            { borderColor: theme.colors.outlineVariant, backgroundColor: designTokens.cardBackground },
                          ]}
                          hapticType="light"
                          onPress={() => openStudio(row)}
                          accessibilityRole="button"
                          accessibilityLabel={t('timeline.hubStudioEdit', { defaultValue: 'Modifier en détail' })}
                        >
                          <Icon source="dots-vertical" size={20} color={designTokens.textSecondary} />
                        </PressableScale>
                      ) : null}
                    </View>

                    {selectionMode ? null : isTripCard && trip ? (
                      <IdeaBankTripItineraryBlock
                        row={row}
                        trip={trip}
                        meta={metaRoot}
                        textPrimary={designTokens.textPrimary}
                        textSecondary={designTokens.textSecondary}
                        onRequestOriginSetup={(r) => openAddressSearch(r, 'origin')}
                        onRequestArrivalSetup={(r) => openAddressSearch(r, 'arrival')}
                      />
                    ) : null}

                    {selectionMode ? null : showTripPill && tripPillLabel ? (
                      <PressableScale
                        style={[
                          styles.pass2Pill,
                          tripPillReady ? styles.pass2PillReady : null,
                          tripUiState === 'pro_active' ? styles.pass2PillActive : null,
                          {
                            backgroundColor:
                              tripUiState === 'pro_active'
                                ? `${designTokens.accentColor}CC`
                                : designTokens.accentColor,
                            borderRadius: 999,
                            opacity: tripPillBusy ? 0.65 : 1,
                          },
                        ]}
                        hapticType="medium"
                        disabled={tripPillBusy}
                        onPress={() => void handleTripPillPress(row)}
                        accessibilityRole="button"
                        accessibilityLabel={tripPillLabel}
                      >
                        <Text style={styles.pass2PillText} numberOfLines={2}>
                          {tripPillLabel}
                        </Text>
                      </PressableScale>
                    ) : null}

                    {selectionMode ? null : showAlarmPill ? (
                      <PressableScale
                        style={[
                          styles.pass2Pill,
                          alarmPillActive ? styles.pass2PillActive : null,
                          {
                            backgroundColor: alarmPillActive
                              ? `${designTokens.accentColor}CC`
                              : designTokens.accentColor,
                            borderRadius: 999,
                            opacity: alarmPillBusy ? 0.65 : 1,
                          },
                        ]}
                        hapticType="medium"
                        disabled={alarmPillBusy}
                        onPress={() => void handleAlarmPillPress(row)}
                        accessibilityRole="button"
                        accessibilityLabel={alarmPillLabel}
                      >
                        <Text style={styles.pass2PillText} numberOfLines={2}>
                          {alarmPillLabel}
                        </Text>
                      </PressableScale>
                    ) : null}

                    {selectionMode ? null : showPass2Pill && pass2Label ? (
                      <PressableScale
                        style={[
                          styles.pass2Pill,
                          {
                            backgroundColor: designTokens.accentColor,
                            borderRadius: 999,
                          },
                        ]}
                        hapticType="medium"
                        onPress={() => triggerPass2(row)}
                        accessibilityRole="button"
                        accessibilityLabel={pass2Label}
                      >
                        <Text style={styles.pass2PillText} numberOfLines={2}>
                          {pass2Label}
                        </Text>
                      </PressableScale>
                    ) : null}
                  </View>
                  {selectionMode && isSourcedParent && isExpanded && childRows.length > 0
                    ? childRows.map((childSource) => {
                        const child = resolveRow(childSource);
                        const childVisual = resolveChildSelectionVisual(child.id);
                        const childSelected = childVisual === 'all';
                        const childSelectA11y = childSelected
                          ? t('timeline.hubDeleteDeselectRow', { defaultValue: 'Désélectionner' })
                          : t('timeline.hubDeleteSelectRow', { defaultValue: 'Sélectionner pour supprimer' });
                        return (
                          <View
                            key={child.id}
                            style={[styles.childRow, { paddingLeft: 24 + HUB_LEAD_SLOT }]}
                          >
                            <HubSelectionRing
                              selected={childSelected}
                              onPress={() => toggleSourcingChildSelection(row.id, child.id, sourcingChildIds)}
                              outlineColor={theme.colors.outline}
                              selectedColor={theme.colors.error}
                              a11yLabel={childSelectA11y}
                            />
                            <PressableScale
                              style={styles.childRowBody}
                              hapticType="light"
                              onPress={() => toggleSourcingChildSelection(row.id, child.id, sourcingChildIds)}
                              accessibilityRole="button"
                              accessibilityLabel={childSelectA11y}
                            >
                              <InboxLineTitle
                                row={child}
                                textPrimary={designTokens.textPrimary}
                                textSecondary={designTokens.textSecondary}
                                locale={i18n.language}
                                titleDone={false}
                              />
                            </PressableScale>
                          </View>
                        );
                      })
                    : !selectionMode && isSourcedParent && isExpanded && childRows.length > 0
                    ? childRows.map((childSource) => {
                        const child = resolveRow(childSource);
                        const childPending = pendingLocalDone.has(child.id);
                        return (
                          <View
                            key={child.id}
                            style={[styles.childRow, { paddingLeft: 24 + HUB_LEAD_SLOT }]}
                          >
                            <HubTaskCheckbox
                              checked={childPending || child.status === 'DONE'}
                              onPress={() => void handleToggleDone(child)}
                              outlineColor={theme.colors.outline}
                              a11yLabel={t('timeline.a11yTaskComplete')}
                            />
                            <View style={styles.childRowBody}>
                              <InboxLineTitle
                                row={child}
                                textPrimary={designTokens.textPrimary}
                                textSecondary={designTokens.textSecondary}
                                locale={i18n.language}
                                titleDone={childPending || child.status === 'DONE'}
                              />
                            </View>
                          </View>
                        );
                      })
                    : null}
                  {selectionMode && showTravelAccordion && isExpanded && travelMilestones.length > 0
                    ? (
                    <TravelMilestoneInboxRows
                      projectRow={resolvedProjectRow}
                      milestones={travelMilestones}
                      inboxZoomView={hubZoomView}
                      resolveRow={resolveRow}
                      expandedZoomJalonKeys={expandedZoomJalonKeys}
                      expandedZoomDoneJalonKeys={expandedZoomDoneJalonKeys}
                      travelDoneExpanded={expandedTravelDoneProjectIds.has(row.id)}
                      onToggleZoomJalon={toggleZoomJalonExpand}
                      onToggleZoomDoneSection={toggleZoomDoneSectionExpand}
                      onToggleTravelDoneSection={() => toggleTravelDoneSectionExpand(row.id)}
                      onToggleMilestoneDone={(uid) => void handleToggleTravelMilestoneDone(resolvedProjectRow, uid)}
                      onToggleZoomTaskDone={(task) => void handleToggleZoomTaskDone(task)}
                      textPrimary={designTokens.textPrimary}
                      textSecondary={designTokens.textSecondary}
                      accentColor={designTokens.accentColor}
                      locale={i18n.language}
                      theme={theme}
                      t={t}
                      selectionMode
                      selectedIds={selectedIds}
                      onToggleZoomTaskSelection={(task) => toggleZoomTaskSelection(resolvedProjectRow, task)}
                      resolveZoomTaskSelectionVisual={(taskId) => resolveChildSelectionVisual(taskId)}
                    />
                  )
                    : !selectionMode && showTravelAccordion && isExpanded && travelMilestones.length > 0 ? (
                    <TravelMilestoneInboxRows
                      projectRow={resolvedProjectRow}
                      milestones={travelMilestones}
                      inboxZoomView={hubZoomView}
                      resolveRow={resolveRow}
                      expandedZoomJalonKeys={expandedZoomJalonKeys}
                      expandedZoomDoneJalonKeys={expandedZoomDoneJalonKeys}
                      travelDoneExpanded={expandedTravelDoneProjectIds.has(row.id)}
                      onToggleZoomJalon={toggleZoomJalonExpand}
                      onToggleZoomDoneSection={toggleZoomDoneSectionExpand}
                      onToggleTravelDoneSection={() => toggleTravelDoneSectionExpand(row.id)}
                      onToggleMilestoneDone={(uid) => void handleToggleTravelMilestoneDone(resolvedProjectRow, uid)}
                      onToggleZoomTaskDone={(task) => void handleToggleZoomTaskDone(task)}
                      textPrimary={designTokens.textPrimary}
                      textSecondary={designTokens.textSecondary}
                      accentColor={designTokens.accentColor}
                      locale={i18n.language}
                      theme={theme}
                      t={t}
                    />
                  ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {selectionMode && items.length > 0 ? (
            <View style={styles.selectionFooter}>
              <PressableScale
                style={[styles.selectionFooterBtn, { borderColor: theme.colors.outlineVariant }]}
                hapticType="light"
                onPress={selectAllRows}
                disabled={deleteBusy}
              >
                <Text style={[styles.selectionFooterBtnText, { color: designTokens.textPrimary }]}>
                  {t('timeline.hubDeleteSelectAll', { defaultValue: 'Tout sélectionner' })}
                </Text>
              </PressableScale>
              <PressableScale
                style={[styles.selectionFooterBtn, { borderColor: theme.colors.outlineVariant }]}
                hapticType="light"
                onPress={clearSelection}
                disabled={deleteBusy || selectedIds.size === 0}
              >
                <Text
                  style={[
                    styles.selectionFooterBtnText,
                    { color: selectedIds.size === 0 ? designTokens.textSecondary : designTokens.textPrimary },
                  ]}
                >
                  {t('timeline.hubDeleteClearSelection', { defaultValue: 'Effacer la sélection' })}
                </Text>
              </PressableScale>
            </View>
          ) : null}

          {searchTarget ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={[
                styles.searchCurtain,
                {
                  backgroundColor: designTokens.cardBackground,
                  paddingBottom: insets.bottom + 16,
                },
              ]}
            >
              <View style={styles.searchCurtainHeader}>
                <PressableScale onPress={closeAddressSearch} hitSlop={12} hapticType="light">
                  <IconButton
                    icon="arrow-left"
                    size={22}
                    iconColor={designTokens.textPrimary}
                    style={styles.searchCurtainBackBtn}
                  />
                </PressableScale>
                <View pointerEvents="none" style={styles.searchCurtainKindIconWrap}>
                  <IconButton
                    icon={searchTarget.kind === 'origin' ? 'map-marker-radius' : 'flag-checkered'}
                    size={20}
                    iconColor={designTokens.accentColor}
                    style={styles.searchCurtainKindIcon}
                  />
                </View>
                <Text style={[styles.searchCurtainTitle, { color: designTokens.textSecondary }]}>
                  {searchTarget.kind === 'origin'
                    ? t('timeline.ideaBank.tripSearchOriginTitle')
                    : t('timeline.ideaBank.tripSearchTitle')}
                </Text>
              </View>
              <ScrollView
                style={styles.searchCurtainBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <GooglePlacesAutocompleteField
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSelect={(place) => void handleAddressSelect(place)}
                  autoFocus
                  language={i18n.language}
                  placeholder={t('intentionDetail.addressPlaceholder')}
                  missingKeyLabel={t('sentinel.placesMissingKey')}
                />
              </ScrollView>
            </KeyboardAvoidingView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: '88%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', flex: 1 },
  sheetTitleCenter: { textAlign: 'center' },
  list: { maxHeight: 420 },
  rowCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailPressable: {
    flex: 1,
    minWidth: 0,
  },
  sourcingLeadSlot: {
    width: HUB_LEAD_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sourcingCountBadge: {
    width: HUB_TASK_CHECKBOX_SIZE + 12,
    height: HUB_TASK_CHECKBOX_SIZE + 12,
    borderRadius: (HUB_TASK_CHECKBOX_SIZE + 12) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourcingCountBadgeWide: {
    width: undefined,
    minWidth: HUB_TASK_CHECKBOX_SIZE + 12,
    paddingHorizontal: 6,
  },
  sourcingCountText: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 18,
  },
  sourcingCountTextCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  sourcingChevronBtn: {
    width: HUB_TASK_CHECKBOX_SIZE + 12,
    height: HUB_TASK_CHECKBOX_SIZE + 12,
    borderRadius: (HUB_TASK_CHECKBOX_SIZE + 12) / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  studioBtn: {
    width: HUB_TASK_CHECKBOX_SIZE + 12,
    height: HUB_TASK_CHECKBOX_SIZE + 12,
    borderRadius: (HUB_TASK_CHECKBOX_SIZE + 12) / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingRight: 12,
    marginBottom: 4,
  },
  childRowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowTitleDone: { textDecorationLine: 'line-through' },
  habitCadence: { fontSize: 13, fontWeight: '600' },
  createdHint: { fontSize: 11, marginTop: 4 },
  pass2Pill: {
    marginTop: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pass2PillReady: {
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  pass2PillActive: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  pass2PillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  selectionFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  selectionFooterBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionFooterBtnText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  searchCurtain: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  searchCurtainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  searchCurtainBackBtn: {
    margin: 0,
    width: 40,
    height: 40,
  },
  searchCurtainKindIconWrap: {
    width: 36,
    alignItems: 'center',
  },
  searchCurtainKindIcon: {
    margin: 0,
    width: 36,
    height: 36,
  },
  searchCurtainTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  searchCurtainBody: {
    flex: 1,
  },
});
