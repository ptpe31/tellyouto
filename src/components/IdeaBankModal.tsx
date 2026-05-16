import { CalendarDays, Check, Trash2 } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
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
  deleteTrankilV2IntentionById,
  markTrankilV2IntentionDone,
  patchMetadata,
  updateTrankilV2IntentionTemporal,
  type TrankilIntentStatus,
  type TrankilV2TimelineItemRow,
} from '../api';
import { syncNativeRailAlarmsAfterIntentionWrite } from '../api/intentionHardwareSync';
import { IntentInteractionWrapper } from './IntentInteractionWrapper';
import {
  buildProjectMilestonesMetadataPatch,
  getProjectStartDateFromMetadataJson,
  parseProjectMilestonesPayloadFromMetadataJson,
  replanProjectMilestonesFromStartDate,
} from '../services/projectMilestonesModel';
import { generateSmartTitle } from '../services/smartTitle';
import { formatCreationSubtitle } from '../utils/timeFormat';

type Props = {
  visible: boolean;
  onClose: () => void;
  items: TrankilV2TimelineItemRow[];
  status: TrankilIntentStatus;
  anchorDate: Date;
  onChanged: () => void;
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

export function IdeaBankModal({ visible, onClose, items, status, anchorDate, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [scheduleForId, setScheduleForId] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'due' | 'projectStart'>('due');

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

  const onMarkDone = useCallback(
    async (id: string) => {
      await markTrankilV2IntentionDone(id);
      await syncNativeRailAlarmsAfterIntentionWrite('ideaBankMarkDone');
      await refresh();
    },
    [refresh],
  );

  const onSetDue = useCallback(
    async (id: string, ymd: string) => {
      await updateTrankilV2IntentionTemporal(id, { due_date: ymd });
      await syncNativeRailAlarmsAfterIntentionWrite('ideaBankSchedule');
      setScheduleForId(null);
      await refresh();
    },
    [refresh],
  );

  const onPlanProjectStart = useCallback(
    async (id: string, startYmd: string) => {
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
    },
    [items, refresh],
  );

  const openScheduleForRow = useCallback((row: TrankilV2TimelineItemRow) => {
    setScheduleMode(isProjectWithoutStartDate(row) ? 'projectStart' : 'due');
    setScheduleForId(row.id);
  }, []);

  const onDelete = useCallback(
    (id: string) => {
      Alert.alert(t('timeline.ideaBank.removeConfirmTitle'), t('timeline.ideaBank.removeConfirmBody'), [
        { text: t('timeline.ideaBank.cancel'), style: 'cancel' },
        {
          text: t('timeline.ideaBank.remove'),
          style: 'destructive',
          onPress: async () => {
            await deleteTrankilV2IntentionById(id);
            await syncNativeRailAlarmsAfterIntentionWrite('ideaBankDelete');
            await refresh();
          },
        },
      ]);
    },
    [refresh, t],
  );

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
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.outlineVariant,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: theme.colors.onSurface }]}>
                {t('timeline.ideaBank.title')}
              </Text>
              <Pressable onPress={onClose} hitSlop={12}>
                <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{t('timeline.ideaBank.close')}</Text>
              </Pressable>
            </View>

            {items.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 4 }}>
                {t('timeline.ideaBank.empty')}
              </Text>
            ) : (
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                {items.map((row) => {
                  const title = formatLineTitle(resolveDisplayTitle(row), t);
                  const createdLine = formatCreationSubtitle(Number(row.created_at), t, i18n.language);
                  return (
                    <IntentInteractionWrapper
                      key={row.id}
                      intentionId={row.id}
                      anchorDate={anchorDate}
                      onMutation={refresh}
                    >
                      <View
                        style={[
                          styles.rowCard,
                          {
                            backgroundColor: theme.colors.elevation.level1,
                            borderColor: theme.colors.outlineVariant,
                          },
                        ]}
                      >
                        <Text style={[styles.rowTitle, { color: theme.colors.onSurface }]} numberOfLines={2}>
                          {title}
                        </Text>
                        <Text style={[styles.createdHint, { color: theme.colors.onSurfaceVariant }]}>
                          {createdLine}
                        </Text>
                        <View style={styles.rowActions}>
                          {status === 'TODO' ? (
                            <Pressable
                              style={[styles.iconBtn, { borderColor: theme.colors.outline }]}
                              onPress={() => void onMarkDone(row.id)}
                            >
                              <Check size={18} color={theme.colors.primary} />
                              <Text style={[styles.iconBtnLabel, { color: theme.colors.onSurface }]}>
                                {t('timeline.ideaBank.done')}
                              </Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            style={[styles.iconBtn, { borderColor: theme.colors.outline }]}
                            onPress={() => openScheduleForRow(row)}
                          >
                            <CalendarDays size={18} color={theme.colors.secondary} />
                            <Text style={[styles.iconBtnLabel, { color: theme.colors.onSurface }]}>
                              {isProjectWithoutStartDate(row)
                                ? t('cluster.planProjectStart')
                                : t('timeline.ideaBank.schedule')}
                            </Text>
                          </Pressable>
                          <Pressable
                            style={[styles.iconBtn, { borderColor: theme.colors.outline }]}
                            onPress={() => onDelete(row.id)}
                          >
                            <Trash2 size={18} color={theme.colors.error} />
                            <Text style={[styles.iconBtnLabel, { color: theme.colors.onSurface }]}>
                              {t('timeline.ideaBank.remove')}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </IntentInteractionWrapper>
                  );
                })}
              </ScrollView>
            )}

            {items.length > 0 ? (
              <Pressable
                style={[styles.clearAllBtn, { borderColor: theme.colors.error }]}
                onPress={onClearAll}
              >
                <Text style={{ color: theme.colors.error, fontWeight: '700', textAlign: 'center' }}>
                  {t('timeline.ideaBank.clearAll')}
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
              styles.scheduleSheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.outlineVariant,
                maxHeight: '70%',
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.scheduleTitle, { color: theme.colors.onSurface }]}>
              {scheduleMode === 'projectStart'
                ? t('cluster.planProjectStart')
                : t('timeline.ideaBank.scheduleTitle')}
            </Text>
            {schedulingRow ? (
              <Text
                style={[styles.scheduleSubtitle, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={2}
              >
                {formatLineTitle(resolveDisplayTitle(schedulingRow), t)}
              </Text>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipsRow}>
              {scheduleDates.map((d) => {
                const ymd = toYmd(d);
                return (
                  <Pressable
                    key={ymd}
                    onPress={() => {
                      if (!scheduleForId) return;
                      if (scheduleMode === 'projectStart') {
                        void onPlanProjectStart(scheduleForId, ymd);
                      } else {
                        void onSetDue(scheduleForId, ymd);
                      }
                    }}
                    style={[
                      styles.dateChip,
                      {
                        backgroundColor: theme.colors.surfaceVariant,
                        borderColor: theme.colors.outline,
                      },
                    ]}
                  >
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontWeight: '600' }}>
                      {ymd}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setScheduleForId(null)} style={{ marginTop: 8 }}>
              <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{t('timeline.ideaBank.cancel')}</Text>
            </Pressable>
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
  createdHint: { fontSize: 11, marginTop: 4 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  iconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
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
