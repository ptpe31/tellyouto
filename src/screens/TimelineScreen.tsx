import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Sparkles } from 'lucide-react-native';
import {
  Animated,
  DeviceEventEmitter,
  FlatList,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Platform } from '../utils/rnPlatform';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { MD3Theme } from 'react-native-paper';
import { Button, Dialog, Portal, Switch, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listIntentionsDescending,
  markIntentionQuickComplete,
  updateIntentionAlarmEnabled,
  LOCAL_DB_RESET_EVENT,
  type IntentionRow,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { FocusModePicker, NeumorphicCard } from '../components';
import { TimeIndicator } from '../components/TimeIndicator';
import type { FocusCapsuleMode } from '../navigation/types';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useFocusCalendarConflict } from '../hooks/useFocusCalendarConflict';
import {
  buildTimelineSlots,
  formatMinutesAsClock,
  type BusyInterval,
  type TimelineSlot,
} from '../services/agentLogic';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { recordQuickCompleteWithoutCapsule } from '../services/focusHabits';
import { useWhatsAppInitCelebration } from '../hooks/useWhatsAppInitCelebration';
import { syncRailReminderScheduleFromSlots } from '../services/railReminderSchedule';
import {
  cancelIntentionRailAlarm,
  requestAlarmPermissionIfNeeded,
  syncRailAlarmsWithTimeline,
} from '../services/alarmManager';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type RailRow =
  | { type: 'intention'; slot: TimelineSlot }
  | {
      type: 'external';
      key: string;
      startMinutes: number;
      endMinutes: number;
    };

function mergeRailRows(
  intentionSlots: TimelineSlot[],
  visibleExternal: BusyInterval[],
  connectEnabled: boolean,
): RailRow[] {
  const int: RailRow[] = intentionSlots.map((slot) => ({
    type: 'intention',
    slot,
  }));
  if (!connectEnabled || visibleExternal.length === 0) return int;
  const ext: RailRow[] = visibleExternal.map((b, i) => ({
    type: 'external',
    key: `ext-${b.startMinutes}-${b.endMinutes}-${i}`,
    startMinutes: b.startMinutes,
    endMinutes: b.endMinutes,
  }));
  return [...int, ...ext].sort((a, b) => {
    const sa = a.type === 'intention' ? a.slot.startMinutes : a.startMinutes;
    const sb = b.type === 'intention' ? b.slot.startMinutes : b.startMinutes;
    return sa - sb;
  });
}

type SlotRowProps = {
  item: TimelineSlot;
  theme: MD3Theme;
  t: TFunction;
  onExitComplete: (intention: IntentionRow) => void;
  onRequestLaunch: (intention: IntentionRow) => void;
  onAlarmChange: (intention: IntentionRow, enabled: boolean) => void;
};

function TimelineSlotRow({
  item,
  theme,
  t,
  onExitComplete,
  onRequestLaunch,
  onAlarmChange,
}: SlotRowProps) {
  const isMicro = item.railVariant === 'micro_pastille';
  const opacity = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;

  const runQuickDone = () => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 28,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onExitComplete(item.intention);
    });
  };

  return (
    <Animated.View style={{ opacity, transform: [{ translateX }] }}>
      <NeumorphicCard
        style={[
          isMicro ? styles.pastilleCard : styles.card,
          isMicro ? { backgroundColor: 'rgba(195, 225, 210, 0.42)' } : null,
        ]}
      >
        <View style={styles.titleRow}>
          {item.intention.alarm_enabled && !isMicro ? (
            <Text
              style={styles.bellGlyph}
              accessibilityLabel={t('timeline.alarmBellA11y')}
            >
              🔔
            </Text>
          ) : null}
          {item.intention.is_hard_constraint && !isMicro ? (
            <Text
              style={styles.lockGlyph}
              accessibilityLabel={t('timeline.hardRoutineLockA11y')}
            >
              🔒
            </Text>
          ) : null}
          <Text
            style={[
              isMicro ? styles.pastilleTitle : styles.cardTitle,
              { color: theme.colors.onSurface, flex: 1 },
            ]}
          >
            {item.intention.title}
          </Text>
        </View>
        {isMicro &&
        item.microFragmentIndex != null &&
        item.microFragmentTotal != null ? (
          <Text
            style={[styles.microBadge, { color: theme.colors.onSurfaceVariant }]}
          >
            {t('timeline.microFragment', {
              current: item.microFragmentIndex,
              total: item.microFragmentTotal,
            })}
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: theme.colors.primary }]}>
          {isMicro
            ? t('timeline.microDuration')
            : t('timeline.estimated', {
                minutes: item.intention.estimated_duration,
              })}
        </Text>
        <Text style={[styles.slot, { color: theme.colors.onSurfaceVariant }]}>
          {t('timeline.suggestedWindow', {
            start: item.startLabel,
            end: item.endLabel,
          })}
        </Text>
        {item.intention.description && !isMicro ? (
          <Text
            style={[styles.desc, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={2}
          >
            {item.intention.description}
          </Text>
        ) : null}
        {!isMicro ? (
        <View style={styles.alarmRow}>
          <Text style={[styles.alarmLabel, { color: theme.colors.onSurface }]}>
            {t('timeline.alarmSwitch')}
          </Text>
          <Switch
            value={item.intention.alarm_enabled}
            onValueChange={(v) => onAlarmChange(item.intention, v)}
          />
        </View>
        ) : null}
        <View style={styles.rowActions}>
          <Pressable
            onPress={runQuickDone}
            style={({ pressed }) => [
              styles.doneBtn,
              { opacity: pressed ? 0.65 : 0.88 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('timeline.done')}
          >
            <Check
              size={20}
              color={theme.colors.onSurfaceVariant}
              strokeWidth={2.2}
            />
          </Pressable>
          <Pressable
            onPress={() => onRequestLaunch(item.intention)}
            style={({ pressed }) => [
              styles.launchBtn,
              {
                backgroundColor: theme.colors.primary,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('timeline.launch')}
          >
            <Text style={{ color: theme.colors.onPrimary, fontWeight: '600' }}>
              {t('timeline.launch')}
            </Text>
          </Pressable>
        </View>
      </NeumorphicCard>
    </Animated.View>
  );
}

function ExternalEventRow({
  startMinutes,
  endMinutes,
  theme,
  t,
}: {
  startMinutes: number;
  endMinutes: number;
  theme: MD3Theme;
  t: TFunction;
}) {
  return (
    <NeumorphicCard
      style={[
        styles.externalCard,
        { backgroundColor: 'rgba(140, 170, 188, 0.22)' },
      ]}
    >
      <Text
        style={[styles.externalEyebrow, { color: theme.colors.onSurfaceVariant }]}
      >
        {t('timeline.externalEventLabel')}
      </Text>
      <Text style={[styles.externalTime, { color: theme.colors.onSurface }]}>
        {t('timeline.calendarBusy', {
          start: formatMinutesAsClock(startMinutes),
          end: formatMinutesAsClock(endMinutes),
        })}
      </Text>
    </NeumorphicCard>
  );
}

export function TimelineScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { spectrum } = useUserSpectrum();
  const navigation = useNavigation();
  const {
    connectEnabled,
    busyIntervals,
    visibleBusyIntervals,
    refreshBusy,
  } = useCalendarIntegration();
  const { shouldWarnForLaunch } = useFocusCalendarConflict();

  const [slots, setSlots] = useState<TimelineSlot[]>([]);
  const [focusPickTarget, setFocusPickTarget] = useState<IntentionRow | null>(
    null,
  );
  const [calendarConflictOpen, setCalendarConflictOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{
    row: IntentionRow;
    mode: FocusCapsuleMode;
  } | null>(null);
  const { visible: celebrateWa, dismiss: dismissCelebrateWa } =
    useWhatsAppInitCelebration('timeline');

  const load = useCallback(async () => {
    const rows = (await listIntentionsDescending()).filter(
      (r) => r.status !== 'done',
    );
    const busyForAgent: BusyInterval[] = connectEnabled ? busyIntervals : [];
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const now = new Date();
    const built = buildTimelineSlots(
      rows,
      {
        structure: spectrum.structure,
        momentum: spectrum.momentum,
        zen: spectrum.zen,
        stats: spectrum.stats,
      },
      now,
      { busyIntervals: busyForAgent },
    );
    setSlots(built);
    await syncRailAlarmsWithTimeline({
      pendingIntentions: rows,
      slots: built,
      now,
    });
    void syncRailReminderScheduleFromSlots(built, now, spectrum);
  }, [spectrum, connectEnabled, busyIntervals]);

  useFocusEffect(
    useCallback(() => {
      if (connectEnabled) void refreshBusy();
    }, [connectEnabled, refreshBusy]),
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(LOCAL_DB_RESET_EVENT, () => {
      void load();
    });
    const sub2 = DeviceEventEmitter.addListener(
      INTENTIONS_CHANGED_EVENT,
      () => {
        void load();
      },
    );
    return () => {
      sub.remove();
      sub2.remove();
    };
  }, [load]);

  const onAlarmChange = useCallback(
    async (intention: IntentionRow, enabled: boolean) => {
      if (enabled) {
        const ok = await requestAlarmPermissionIfNeeded();
        if (!ok) return;
      } else {
        await cancelIntentionRailAlarm(intention.id);
      }
      await updateIntentionAlarmEnabled(intention.id, enabled);
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
      void syncPendingIntentions();
      await load();
    },
    [load],
  );

  const onQuickExitComplete = useCallback(
    async (intention: IntentionRow) => {
      await markIntentionQuickComplete(intention.id);
      await recordQuickCompleteWithoutCapsule();
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
      void syncPendingIntentions();
      await load();
    },
    [load],
  );

  const navigateFocus = useCallback(
    (row: IntentionRow, mode: FocusCapsuleMode) => {
      navigation.getParent()?.navigate('FocusCapsule', {
        intentionId: row.id,
        mode,
      });
    },
    [navigation],
  );

  const confirmFocusMode = useCallback(
    (mode: FocusCapsuleMode) => {
      const row = focusPickTarget;
      setFocusPickTarget(null);
      if (!row) return;
      if (shouldWarnForLaunch(mode, row)) {
        setPendingFocus({ row, mode });
        setCalendarConflictOpen(true);
        return;
      }
      navigateFocus(row, mode);
    },
    [focusPickTarget, shouldWarnForLaunch, navigateFocus],
  );

  const railRows = useMemo(
    () => mergeRailRows(slots, visibleBusyIntervals, connectEnabled),
    [slots, visibleBusyIntervals, connectEnabled],
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.header}>
        {celebrateWa ? (
          <NeumorphicCard
            style={[
              styles.celebrationCard,
              { borderColor: theme.colors.primary },
            ]}
          >
            <Text
              style={[styles.celebrationText, { color: theme.colors.primary }]}
            >
              {t('connector.whatsappInitCelebration')}
            </Text>
            <Button mode="text" compact onPress={dismissCelebrateWa}>
              {t('health.dismiss')}
            </Button>
          </NeumorphicCard>
        ) : null}
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>
          {t('tabs.timeline')}
        </Text>
        <Text
          style={[styles.sub, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('timeline.subtitle')}
        </Text>
        <TimeIndicator
          rangeStartMin={6 * 60}
          rangeEndMin={22 * 60}
          label={t('timeline.dayRail')}
          timeCaption={t('timeline.now')}
        />
      </View>
    ),
    [
      celebrateWa,
      dismissCelebrateWa,
      t,
      theme.colors.onBackground,
      theme.colors.onSurfaceVariant,
      theme.colors.primary,
    ],
  );

  const renderItem = ({ item }: { item: RailRow }) => {
    if (item.type === 'external') {
      return (
        <ExternalEventRow
          startMinutes={item.startMinutes}
          endMinutes={item.endMinutes}
          theme={theme}
          t={t}
        />
      );
    }
    return (
      <TimelineSlotRow
        item={item.slot}
        theme={theme}
        t={t}
        onExitComplete={onQuickExitComplete}
        onRequestLaunch={setFocusPickTarget}
        onAlarmChange={onAlarmChange}
      />
    );
  };

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <FlatList
        data={railRows}
        keyExtractor={(item) =>
          item.type === 'intention'
            ? `${item.slot.intention.id}-${item.slot.startMinutes}-${item.slot.microFragmentIndex ?? 0}`
            : item.key
        }
        renderItem={renderItem}
        extraData={`${theme.dark}-${connectEnabled}-${busyIntervals.map((b) => `${b.startMinutes}-${b.endMinutes}`).join('|')}-${visibleBusyIntervals.map((b) => `${b.startMinutes}-${b.endMinutes}`).join('|')}-${slots.map((s) => `${s.intention.id}:${s.intention.alarm_enabled ? 1 : 0}`).join(',')}`}
        contentContainerStyle={[
          styles.listPad,
          { paddingBottom: 24 + insets.bottom },
        ]}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <NeumorphicCard style={styles.emptyCard}>
            <Sparkles
              color={theme.colors.primary}
              size={30}
              style={styles.emptyIcon}
            />
            <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
              {t('timeline.emptyTitle')}
            </Text>
            <Text
              style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('timeline.emptyBody')}
            </Text>
          </NeumorphicCard>
        }
      />

      <FocusModePicker
        visible={focusPickTarget !== null}
        onDismiss={() => setFocusPickTarget(null)}
        onSelect={confirmFocusMode}
        title={t('focusMode.title')}
        chronoLabel={t('focusMode.chrono')}
        chronoHint={t('focusMode.chronoHint')}
        pomodoroLabel={t('focusMode.pomodoro')}
        pomodoroHint={t('focusMode.pomodoroHint')}
      />

      <Portal>
        <Dialog
          visible={calendarConflictOpen}
          onDismiss={() => {
            setCalendarConflictOpen(false);
            setPendingFocus(null);
          }}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title>{t('ally.calendarConflictTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.onSurface }}>
              {t('ally.calendarConflictBody')}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setCalendarConflictOpen(false);
                setPendingFocus(null);
              }}
            >
              {t('ally.calendarConflictBack')}
            </Button>
            <Button
              mode="contained"
              onPress={() => {
                const p = pendingFocus;
                setCalendarConflictOpen(false);
                setPendingFocus(null);
                if (p) navigateFocus(p.row, p.mode);
              }}
            >
              {t('ally.calendarConflictContinue')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listPad: { padding: 16 },
  header: { marginBottom: 8 },
  celebrationCard: {
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  celebrationText: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  externalCard: {
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  externalEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  externalTime: { fontSize: 14, fontWeight: '500' },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 6 },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  card: { marginBottom: 14 },
  pastilleCard: {
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  pastilleTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  microBadge: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bellGlyph: { fontSize: 17, lineHeight: 22 },
  lockGlyph: { fontSize: 17, lineHeight: 22 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  alarmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 12,
  },
  alarmLabel: { fontSize: 14, fontWeight: '600', flex: 1 },
  meta: { marginTop: 8, fontSize: 13, fontWeight: '600' },
  slot: { marginTop: 6, fontSize: 14 },
  desc: { marginTop: 8, fontSize: 13, lineHeight: 18 },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  doneBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  launchBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 14,
    minWidth: 112,
    alignItems: 'center',
  },
  emptyCard: { alignItems: 'center', paddingVertical: 22 },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptyBody: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
