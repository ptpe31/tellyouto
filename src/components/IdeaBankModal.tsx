import * as Haptics from 'expo-haptics';
import { CalendarDays, Check, Pencil, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  bulkMarkTrankilV2InboxRemoved,
  deleteTrankilV2IntentionById,
  logTrankilV2HabitOccurrence,
  markTrankilV2IntentionDone,
  markTrankilV2IntentionRemovedFromInbox,
  patchMetadata,
  updateTrankilV2IntentionTemporal,
  type TrankilIntentStatus,
  type TrankilV2TimelineItemRow,
} from '../api';
import { syncNativeRailAlarmsAfterIntentionWrite } from '../api/intentionHardwareSync';
import { Platform as RPlatform } from '../utils/rnPlatform';
import { PressableScale } from './common/PressableScale';
import { IntentInteractionWrapper } from './IntentInteractionWrapper';
import {
  buildProjectMilestonesMetadataPatch,
  getProjectStartDateFromMetadataJson,
  parseProjectMilestonesPayloadFromMetadataJson,
  replanProjectMilestonesFromStartDate,
} from '../services/projectMilestonesModel';
import { generateSmartTitle } from '../services/smartTitle';
import { useDesignTokens } from '../hooks/useDesignTokens';
import { formatCreationSubtitle } from '../utils/timeFormat';
import { HabitStreakCompact, getHabitStreakData } from '../features/livingHub';
import { resolveCadenceLabel } from '../features/livingHub/formatRoutineItemLine';
import { isTrackStreakEnabled, parseIntentionMetadata } from '../utils/intentionMetadata';

type Props = {
  visible: boolean;
  onClose: () => void;
  items: TrankilV2TimelineItemRow[];
  status: TrankilIntentStatus;
  anchorDate: Date;
  onChanged: () => void;
  title?: string;
  /** `inbox` : toutes les captures du jour (Smart Clusters « Inbox »). */
  mode?: 'default' | 'inbox';
  /** Ferme la tirelire puis ouvre l’édition (IntentionDetailSheet côté parent). */
  onEditItem: (row: TrankilV2TimelineItemRow) => void;
};

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

function isProjectWithoutStartDate(row: TrankilV2TimelineItemRow): boolean {
  if (String(row.type ?? '').trim().toUpperCase() !== 'PROJECT') return false;
  return !getProjectStartDateFromMetadataJson(row.metadata_json);
}

/** Durée approximative de l'animation slide de la tirelire (ms). */
const IDEA_BANK_SHEET_DISMISS_MS = 320;

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
}: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const designTokens = useDesignTokens();
  const insets = useSafeAreaInsets();
  const [scheduleForId, setScheduleForId] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'due' | 'projectStart'>('due');
  const [busyRows, setBusyRows] = useState<Set<string>>(() => new Set());
  const busyRowsRef = useRef<Set<string>>(new Set());
  const pendingEditRowRef = useRef<TrankilV2TimelineItemRow | null>(null);
  const [pendingLocalDone, setPendingLocalDone] = useState<Set<string>>(() => new Set());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRowsRef = useRef<Map<string, TrankilV2TimelineItemRow>>(new Map());

  const scheduleDates = useMemo(() => {
    const out: Date[] = [];
    for (let d = -3; d <= 60; d += 1) {
      out.push(addDays(anchorDate, d));
    }
    return out;
  }, [anchorDate]);

  const refresh = useCallback(async () => {
    onChanged();
  }, [onChanged]);

  const setRowBusy = useCallback((rowId: string): boolean => {
    if (busyRowsRef.current.has(rowId)) return false;
    const next = new Set(busyRowsRef.current);
    next.add(rowId);
    busyRowsRef.current = next;
    setBusyRows(next);
    return true;
  }, []);

  const setRowIdle = useCallback((rowId: string) => {
    if (!busyRowsRef.current.has(rowId)) return;
    const next = new Set(busyRowsRef.current);
    next.delete(rowId);
    busyRowsRef.current = next;
    setBusyRows(next);
  }, []);

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
    busyRowsRef.current = new Set();
    setBusyRows(new Set());
  }, [flushPendingCommits, visible]);

  /** Ouvre la feuille détail après la descente complète de la tirelire. */
  useEffect(() => {
    if (visible) return;
    const row = pendingEditRowRef.current;
    if (!row) return;
    pendingEditRowRef.current = null;
    const timer = setTimeout(() => {
      onEditItem(row);
    }, IDEA_BANK_SHEET_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onEditItem, visible]);

  useEffect(() => {
    return () => {
      for (const tm of pendingTimeoutsRef.current.values()) {
        clearTimeout(tm);
      }
      pendingTimeoutsRef.current.clear();
      pendingRowsRef.current.clear();
    };
  }, []);

  const onSetDue = useCallback(
    async (id: string, ymd: string) => {
      if (!setRowBusy(id)) return;
      try {
        await updateTrankilV2IntentionTemporal(id, { due_date: ymd });
        await syncNativeRailAlarmsAfterIntentionWrite('ideaBankSchedule');
        setScheduleForId(null);
        await refresh();
      } catch {
        /* ignore */
      } finally {
        setRowIdle(id);
      }
    },
    [refresh, setRowBusy, setRowIdle],
  );

  const onPlanProjectStart = useCallback(
    async (id: string, startYmd: string) => {
      if (!setRowBusy(id)) return;
      try {
        const row = items.find((r) => r.id === id);
        if (!row) return;
        const payload = parseProjectMilestonesPayloadFromMetadataJson(row.metadata_json);
        if (!payload) {
          await updateTrankilV2IntentionTemporal(id, { due_date: startYmd });
          await patchMetadata(id, { project: { start_date: startYmd } });
          setScheduleForId(null);
          await syncNativeRailAlarmsAfterIntentionWrite('ideaBankSchedule');
          await refresh();
          return;
        }
        const replanned = replanProjectMilestonesFromStartDate(payload, startYmd);
        const metaPatch = {
          project: { start_date: startYmd },
          ...buildProjectMilestonesMetadataPatch(replanned),
        };
        await patchMetadata(id, metaPatch);
        await updateTrankilV2IntentionTemporal(id, { due_date: startYmd });
        setScheduleForId(null);
        await syncNativeRailAlarmsAfterIntentionWrite('ideaBankPlanProjectStart');
        await refresh();
      } catch {
        /* ignore */
      } finally {
        setRowIdle(id);
      }
    },
    [items, refresh, setRowBusy, setRowIdle],
  );

  const openScheduleForRow = useCallback((row: TrankilV2TimelineItemRow) => {
    if (busyRowsRef.current.has(row.id)) return;
    setScheduleMode(isProjectWithoutStartDate(row) ? 'projectStart' : 'due');
    setScheduleForId(row.id);
  }, []);

  const onRemoveFromInbox = useCallback(
    (id: string) => {
      if (busyRowsRef.current.has(id)) return;
      Alert.alert(t('inbox.action.removeConfirmTitle'), t('inbox.action.removeConfirmBody'), [
        { text: t('timeline.ideaBank.cancel'), style: 'cancel' },
        {
          text: t('inbox.action.remove'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!setRowBusy(id)) return;
              try {
                await markTrankilV2IntentionRemovedFromInbox(id);
                await syncNativeRailAlarmsAfterIntentionWrite('ideaBankInboxRemove');
                await refresh();
              } catch {
                /* ignore */
              } finally {
                setRowIdle(id);
              }
            })();
          },
        },
      ]);
    },
    [refresh, setRowBusy, setRowIdle, t],
  );

  const onDelete = useCallback(
    (id: string) => {
      if (busyRowsRef.current.has(id)) return;
      if (mode === 'inbox') {
        onRemoveFromInbox(id);
        return;
      }
      Alert.alert(t('timeline.ideaBank.removeConfirmTitle'), t('timeline.ideaBank.removeConfirmBody'), [
        { text: t('timeline.ideaBank.cancel'), style: 'cancel' },
        {
          text: t('timeline.ideaBank.remove'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!setRowBusy(id)) return;
              try {
                await deleteTrankilV2IntentionById(id);
                await syncNativeRailAlarmsAfterIntentionWrite('ideaBankDelete');
                await refresh();
              } catch {
                /* ignore */
              } finally {
                setRowIdle(id);
              }
            })();
          },
        },
      ]);
    },
    [mode, onRemoveFromInbox, refresh, setRowBusy, setRowIdle, t],
  );

  const onClearAll = useCallback(() => {
    if (items.length === 0) return;
    if (mode === 'inbox') {
      Alert.alert(t('inbox.action.removeAllConfirmTitle'), t('inbox.action.removeAllConfirmBody', { count: items.length }), [
        { text: t('timeline.ideaBank.cancel'), style: 'cancel' },
        {
          text: t('inbox.action.removeAll'),
          style: 'destructive',
          onPress: async () => {
            await bulkMarkTrankilV2InboxRemoved(items.map((row) => row.id));
            await syncNativeRailAlarmsAfterIntentionWrite('ideaBankInboxRemoveAll');
            await refresh();
          },
        },
      ]);
      return;
    }
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
  }, [items, mode, onClose, refresh, t]);

  const removeActionLabel = mode === 'inbox' ? t('inbox.action.remove') : t('timeline.ideaBank.remove');
  const clearAllActionLabel = mode === 'inbox' ? t('inbox.action.removeAll') : t('timeline.ideaBank.clearAll');

  const onEdit = useCallback(
    (row: TrankilV2TimelineItemRow) => {
      if (busyRowsRef.current.has(row.id)) return;
      pendingEditRowRef.current = row;
      onClose();
    },
    [onClose],
  );

  const schedulingRow = useMemo(
    () => (scheduleForId ? items.find((r) => r.id === scheduleForId) : null),
    [items, scheduleForId],
  );

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={[styles.overlay, { paddingTop: insets.top + 12 }]}>
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
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                {items.map((row) => {
                  const title = formatLineTitle(resolveDisplayTitle(row), t);
                  const createdLine = formatCreationSubtitle(Number(row.created_at), t, i18n.language);
                  const meta = parseIntentionMetadata(row.metadata_json);
                  const isHabit = row.type === 'HABIT';
                  const cadenceLabel = isHabit ? resolveCadenceLabel(meta) : null;
                  const trackStreak = isHabit && isTrackStreakEnabled(meta);
                  const streakData = trackStreak ? getHabitStreakData(row.id) : null;
                  const isPending = pendingLocalDone.has(row.id);
                  const isRowBusy = busyRows.has(row.id);
                  return (
                    <IntentInteractionWrapper
                      key={row.id}
                      intentionId={row.id}
                      anchorDate={anchorDate}
                      onMutation={refresh}
                    >
                      <View
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
                        <Text
                          style={[
                            styles.rowTitle,
                            { color: designTokens.textPrimary },
                            isPending ? styles.rowTitleDone : null,
                          ]}
                          numberOfLines={2}
                        >
                          {title}
                          {cadenceLabel ? (
                            <Text style={[styles.habitCadence, { color: designTokens.textSecondary }]}>
                              {' '}
                              • {cadenceLabel}
                            </Text>
                          ) : null}
                        </Text>
                        {trackStreak && streakData ? (
                          <HabitStreakCompact
                            data={streakData}
                            accentColor={designTokens.accentColor}
                            mutedColor={`${designTokens.textSecondary}33`}
                          />
                        ) : null}
                        <Text style={[styles.createdHint, { color: designTokens.textSecondary }]}>
                          {createdLine}
                        </Text>
                        <View style={styles.rowActions}>
                          {isRowBusy ? (
                            <ActivityIndicator size="small" color={designTokens.accentColor} style={styles.rowBusySpinner} />
                          ) : null}
                          {status === 'TODO' ? (
                            <PressableScale
                              accessibilityRole="button"
                              accessibilityLabel={t('timeline.ideaBank.done')}
                              style={[
                                styles.iconBtn,
                                styles.iconBtnIconOnly,
                                {
                                  borderColor: isPending ? designTokens.accentColor : theme.colors.outline,
                                  borderRadius: designTokens.borderRadius * 0.5,
                                  backgroundColor: isPending ? designTokens.accentColor : 'transparent',
                                },
                              ]}
                              disabled={isRowBusy}
                              hapticType="none"
                              onPress={() => void handleToggleDone(row)}
                            >
                              <Check
                                size={18}
                                color={isPending ? '#ffffff' : designTokens.accentColor}
                              />
                            </PressableScale>
                          ) : null}
                          <PressableScale
                            accessibilityRole="button"
                            accessibilityLabel={
                              isProjectWithoutStartDate(row)
                                ? t('cluster.planProjectStart')
                                : t('timeline.ideaBank.schedule')
                            }
                            style={[
                              styles.iconBtn,
                              styles.iconBtnIconOnly,
                              { borderColor: theme.colors.outline, borderRadius: designTokens.borderRadius * 0.5 },
                            ]}
                            disabled={isRowBusy}
                            hapticType="light"
                            onPress={() => openScheduleForRow(row)}
                          >
                            <CalendarDays size={18} color={theme.colors.secondary} />
                          </PressableScale>
                          <PressableScale
                            accessibilityRole="button"
                            accessibilityLabel={t('timeline.ideaBank.edit')}
                            style={[
                              styles.iconBtn,
                              styles.iconBtnIconOnly,
                              { borderColor: theme.colors.outline, borderRadius: designTokens.borderRadius * 0.5 },
                            ]}
                            disabled={isRowBusy}
                            hapticType="light"
                            onPress={() => onEdit(row)}
                          >
                            <Pencil size={18} color={designTokens.accentColor} />
                          </PressableScale>
                          <PressableScale
                            accessibilityRole="button"
                            accessibilityLabel={removeActionLabel}
                            style={[
                              styles.iconBtn,
                              styles.iconBtnIconOnly,
                              { borderColor: theme.colors.outline, borderRadius: designTokens.borderRadius * 0.5 },
                            ]}
                            disabled={isRowBusy}
                            hapticType="light"
                            onPress={() => onDelete(row.id)}
                          >
                            <Trash2 size={18} color={theme.colors.error} />
                          </PressableScale>
                        </View>
                      </View>
                    </IntentInteractionWrapper>
                  );
                })}
              </ScrollView>
            )}

            {items.length > 0 ? (
              <Pressable
                style={[styles.clearAllBtn, { borderColor: theme.colors.error, borderRadius: designTokens.borderRadius * 0.5 }]}
                onPress={onClearAll}
              >
                <Text style={{ color: theme.colors.error, fontWeight: '700', textAlign: 'center' }}>
                  {clearAllActionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={!!scheduleForId} animationType="fade" transparent onRequestClose={() => setScheduleForId(null)}>
        <Pressable style={styles.scheduleOverlay} onPress={() => setScheduleForId(null)}>
          <Pressable
            style={[
              designTokens.cardShadowStyle,
              styles.scheduleSheet,
              {
                backgroundColor: designTokens.cardBackground,
                borderColor: theme.colors.outlineVariant,
                borderRadius: designTokens.borderRadius,
                maxHeight: '70%',
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.scheduleTitle, { color: designTokens.textPrimary }]}>
              {scheduleMode === 'projectStart'
                ? t('cluster.planProjectStart')
                : t('timeline.ideaBank.scheduleTitle')}
            </Text>
            {schedulingRow ? (
              <Text
                style={[styles.scheduleSubtitle, { color: designTokens.textSecondary }]}
                numberOfLines={2}
              >
                {formatLineTitle(resolveDisplayTitle(schedulingRow), t)}
              </Text>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipsRow}>
              {scheduleDates.map((d) => {
                const ymd = toYmd(d);
                const scheduleRowBusy = scheduleForId ? busyRows.has(scheduleForId) : false;
                return (
                  <PressableScale
                    key={ymd}
                    disabled={!scheduleForId || scheduleRowBusy}
                    hapticType="light"
                    onPress={() => {
                      if (!scheduleForId || busyRowsRef.current.has(scheduleForId)) return;
                      if (scheduleMode === 'projectStart') {
                        void onPlanProjectStart(scheduleForId, ymd);
                      } else {
                        void onSetDue(scheduleForId, ymd);
                      }
                    }}
                    style={[
                      styles.dateChip,
                      {
                        backgroundColor: designTokens.cardBackground,
                        borderColor: theme.colors.outline,
                        borderRadius: designTokens.borderRadius * 0.5,
                      },
                    ]}
                  >
                    <Text style={{ color: designTokens.textSecondary, fontSize: 11, fontWeight: '600' }}>
                      {ymd}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
            <PressableScale onPress={() => setScheduleForId(null)} style={{ marginTop: 8 }} hapticType="light">
              <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{t('timeline.ideaBank.cancel')}</Text>
            </PressableScale>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
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
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowTitleDone: { textDecorationLine: 'line-through' },
  habitCadence: { fontSize: 13, fontWeight: '600' },
  createdHint: { fontSize: 11, marginTop: 4 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' },
  rowBusySpinner: { marginRight: 2 },
  iconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  /** Preview icones seules — compact pour tenir sur une ligne. */
  iconBtnIconOnly: {
    width: 40,
    height: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
  },
  iconBtnLabel: { fontSize: 12, fontWeight: '600' },
  clearAllBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  scheduleOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  scheduleSheet: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  scheduleTitle: { fontSize: 17, fontWeight: '700' },
  scheduleSubtitle: { fontSize: 13, marginTop: 6, marginBottom: 10 },
  dateChipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
});
