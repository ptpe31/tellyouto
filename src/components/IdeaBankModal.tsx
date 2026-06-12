import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { IconButton, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  deleteTrankilV2IntentionById,
  logTrankilV2HabitOccurrence,
  markTrankilV2IntentionDone,
  type TrankilIntentStatus,
  type TrankilV2TimelineItemRow,
} from '../api';
import { syncNativeRailAlarmsAfterIntentionWrite } from '../api/intentionHardwareSync';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import { toggleTripSurveillanceForRow } from '../services/traffic/tripSurveillanceToggle';
import { persistTripArrivalAddress, persistTripOriginAddress } from '../services/traffic/persistTripArrivalAddress';
import { showAppToast } from '../services/appToast';
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
import { TaskCompletionOrb } from './TaskCompletionOrb';

type Props = {
  visible: boolean;
  onClose: () => void;
  items: TrankilV2TimelineItemRow[];
  status: TrankilIntentStatus;
  anchorDate: Date;
  onChanged: () => void;
  title?: string;
  /** `inbox` : journal des captures TODO du jour (Smart Clusters « Inbox », sas 24h). */
  mode?: 'default' | 'inbox';
  /** Ferme la tirelire puis ouvre l’édition (IntentionDetailSheet côté parent). */
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
};

/** Diamètre intérieur orbe validation (hors padding néomorphique). */
const VALIDATION_ORB_SIZE = 34;
const VALIDATION_ORB_OUTER = VALIDATION_ORB_SIZE + 8;

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
  mode = 'default',
  onEditItem,
  onPass2Item,
  onPatchItem,
  onOpenTripSetup,
  autoTripPillRowId,
  onAutoTripPillConsumed,
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
  const [searchTarget, setSearchTarget] = useState<TripAddressSearchTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingLocalDone, setPendingLocalDone] = useState<Set<string>>(() => new Set());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRowsRef = useRef<Map<string, TrankilV2TimelineItemRow>>(new Map());

  const refresh = useCallback(async () => {
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    if (visible) {
      setLocalItemPatches(new Map());
    } else {
      setSearchTarget(null);
      setSearchQuery('');
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

  const onClearAll = useCallback(() => {
    if (items.length === 0) return;
    Alert.alert(t('timeline.ideaBank.clearAllTitle'), t('timeline.ideaBank.clearAllBody'), [
      { text: t('timeline.ideaBank.cancel'), style: 'cancel' },
      {
        text: t('timeline.ideaBank.clearAll'),
        style: 'destructive',
        onPress: async () => {
          for (const row of items) {
            await deleteTrankilV2IntentionById(row.id);
          }
          await syncNativeRailAlarmsAfterIntentionWrite('ideaBankClearAll');
          await refresh();
          onClose();
        },
      },
    ]);
  }, [items, onClose, refresh, t]);

  const openDetail = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      pendingEditRowRef.current = row;
      onClose();
    },
    [onClose],
  );

  const triggerPass2 = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      if (!onPass2Item) {
        openDetail(row);
        return;
      }
      pendingPass2RowRef.current = row;
      onClose();
    },
    [onClose, onPass2Item, openDetail],
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
      openDetail(row);
    },
    [onClose, onOpenTripSetup, openDetail],
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

  const showCompleteOrb = status === 'TODO';

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
            <Text style={[styles.sheetTitle, { color: designTokens.textPrimary }]}>
              {title ||
                (mode === 'inbox' ? t('timeline.smartClusters.inbox') : t('timeline.ideaBank.title'))}
            </Text>
            <PressableScale onPress={onClose} hitSlop={12} hapticType="light">
              <Text style={{ color: designTokens.accentColor, fontWeight: '700' }}>{t('timeline.ideaBank.close')}</Text>
            </PressableScale>
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

                return (
                  <View
                    key={row.id}
                    style={[
                      designTokens.cardShadowStyle,
                      styles.rowCard,
                      {
                        borderRadius: designTokens.borderRadius,
                        borderColor: theme.colors.outlineVariant,
                        opacity: isPending ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View style={styles.cardMainRow}>
                      {showCompleteOrb ? (
                        <TaskCompletionOrb
                          theme={theme}
                          size={VALIDATION_ORB_SIZE}
                          progress={0}
                          hasChildBreakdown={false}
                          accentColor={designTokens.accentColor}
                          pendingComplete={isPending}
                          onPress={() => void handleToggleDone(row)}
                          accessibilityLabel={t('timeline.a11yTaskComplete')}
                        />
                      ) : (
                        <View style={{ width: VALIDATION_ORB_OUTER }} />
                      )}

                      <PressableScale
                        style={styles.detailPressable}
                        hapticType="light"
                        onPress={() => openDetail(row)}
                        accessibilityRole="button"
                        accessibilityLabel={lineTitle}
                      >
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

                        {trackStreak && streakData ? (
                          <HabitStreakCompact
                            data={streakData}
                            accentColor={designTokens.accentColor}
                            mutedColor={`${designTokens.textSecondary}33`}
                          />
                        ) : null}
                      </PressableScale>
                    </View>

                    {isTripCard && trip ? (
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

                    {showTripPill && tripPillLabel ? (
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

                    {showPass2Pill && pass2Label ? (
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
                );
              })}
            </ScrollView>
          )}

          {items.length > 0 && mode !== 'inbox' ? (
            <Pressable
              style={[styles.clearAllBtn, { borderColor: theme.colors.error, borderRadius: designTokens.borderRadius * 0.5 }]}
              onPress={onClearAll}
            >
              <Text style={{ color: theme.colors.error, fontWeight: '700', textAlign: 'center' }}>
                {t('timeline.ideaBank.clearAll')}
              </Text>
            </Pressable>
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
  },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  list: { maxHeight: 420 },
  rowCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  detailPressable: {
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
  clearAllBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
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
