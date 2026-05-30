import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
  type TrankilIntentStatus,
  type TrankilV2TimelineItemRow,
} from '../api';
import { syncNativeRailAlarmsAfterIntentionWrite } from '../api/intentionHardwareSync';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { Platform as RPlatform } from '../utils/rnPlatform';
import { PressableScale } from './common/PressableScale';
import { generateSmartTitle } from '../services/smartTitle';
import { useDesignTokens } from '../hooks/useDesignTokens';
import { formatCreationSubtitle } from '../utils/timeFormat';
import { HabitStreakCompact, getHabitStreakData } from '../features/livingHub';
import { resolveCadenceLabel } from '../features/livingHub/formatRoutineItemLine';
import { isTrackStreakEnabled, parseIntentionMetadata } from '../utils/intentionMetadata';
import {
  formatPass2PillLabel,
  resolvePass2FooterAction,
  showPass2CardCta,
} from '../utils/pass2IntentionCard';
import { TaskCompletionOrb } from './TaskCompletionOrb';

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
  /** Ferme la tirelire puis ouvre le détail avec déclenchement Pass 2. */
  onPass2Item?: (row: TrankilV2TimelineItemRow) => void;
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
  onPass2Item,
}: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const designTokens = useDesignTokens();
  const { spectrum } = useUserSpectrum();
  const isProUser = spectrum.isProUser;
  const insets = useSafeAreaInsets();
  const pendingEditRowRef = useRef<TrankilV2TimelineItemRow | null>(null);
  const pendingPass2RowRef = useRef<TrankilV2TimelineItemRow | null>(null);
  const [pendingLocalDone, setPendingLocalDone] = useState<Set<string>>(() => new Set());
  const pendingLocalDoneRef = useRef<Set<string>>(new Set());
  const pendingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRowsRef = useRef<Map<string, TrankilV2TimelineItemRow>>(new Map());

  const refresh = useCallback(async () => {
    onChanged();
  }, [onChanged]);

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
  }, [onEditItem, onPass2Item, visible]);

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

  const clearAllActionLabel = mode === 'inbox' ? t('inbox.action.removeAll') : t('timeline.ideaBank.clearAll');

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
                const lineTitle = formatLineTitle(resolveDisplayTitle(row), t);
                const createdLine = formatCreationSubtitle(Number(row.created_at), t, i18n.language);
                const meta = parseIntentionMetadata(row.metadata_json);
                const isHabit = row.type === 'HABIT';
                const cadenceLabel = isHabit ? resolveCadenceLabel(meta) : null;
                const trackStreak = isHabit && isTrackStreakEnabled(meta);
                const streakData = trackStreak ? getHabitStreakData(row.id) : null;
                const isPending = pendingLocalDone.has(row.id);
                const pass2Action = resolvePass2FooterAction(row);
                const showPass2Pill = showPass2CardCta(row);
                const pass2Label = formatPass2PillLabel(pass2Action, t, isProUser);

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
});
