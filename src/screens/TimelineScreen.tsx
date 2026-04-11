import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Sparkles } from 'lucide-react-native';
import {
  Animated,
  DeviceEventEmitter,
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
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
      <NeumorphicCard style={styles.card}>
        <View style={styles.titleRow}>
          {item.intention.alarm_enabled ? (
            <Text
              style={styles.bellGlyph}
              accessibilityLabel={t('timeline.alarmBellA11y')}
            >
              🔔
            </Text>
          ) : null}
          <Text
            style={[styles.cardTitle, { color: theme.colors.onSurface, flex: 1 }]}
          >
            {item.intention.title}
          </Text>
        </View>
        <Text style={[styles.meta, { color: theme.colors.primary }]}>
          {t('timeline.estimated', {
            minutes: item.intention.estimated_duration,
          })}
        </Text>
        <Text style={[styles.slot, { color: theme.colors.onSurfaceVariant }]}>
          {t('timeline.suggestedWindow', {
            start: item.startLabel,
            end: item.endLabel,
          })}
        </Text>
        {item.intention.description ? (
          <Text
            style={[styles.desc, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={2}
          >
            {item.intention.description}
          </Text>
        ) : null}
        <View style={styles.alarmRow}>
          <Text style={[styles.alarmLabel, { color: theme.colors.onSurface }]}>
            {t('timeline.alarmSwitch')}
          </Text>
          <Switch
            value={item.intention.alarm_enabled}
            onValueChange={(v) => onAlarmChange(item.intention, v)}
          />
        </View>
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

export function TimelineScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { spectrum } = useUserSpectrum();
  const navigation = useNavigation();
  const {
    connectEnabled,
    hideEventsOnRail,
    busyIntervals,
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

  const load = useCallback(async () => {
    const rows = (await listIntentionsDescending()).filter(
      (r) => r.status !== 'done',
    );
    let busyForAgent: BusyInterval[] = [];
    if (connectEnabled) {
      busyForAgent = await refreshBusy();
    }
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
  }, [spectrum, connectEnabled, refreshBusy]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

  const listHeader = useMemo(
    () => (
      <View style={styles.header}>
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
        {connectEnabled &&
        !hideEventsOnRail &&
        busyIntervals.length > 0 ? (
          <NeumorphicCard style={styles.calendarCard}>
            <Text
              style={[
                styles.calendarTitle,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('timeline.calendarRailTitle')}
            </Text>
            {busyIntervals.map((b, i) => (
              <Text
                key={`${b.startMinutes}-${b.endMinutes}-${i}`}
                style={[styles.calendarLine, { color: theme.colors.onSurface }]}
              >
                {t('timeline.calendarBusy', {
                  start: formatMinutesAsClock(b.startMinutes),
                  end: formatMinutesAsClock(b.endMinutes),
                })}
              </Text>
            ))}
          </NeumorphicCard>
        ) : null}
      </View>
    ),
    [
      t,
      theme.colors.onBackground,
      theme.colors.onSurface,
      theme.colors.onSurfaceVariant,
      connectEnabled,
      hideEventsOnRail,
      busyIntervals,
    ],
  );

  const renderItem = ({ item }: { item: TimelineSlot }) => (
    <TimelineSlotRow
      item={item}
      theme={theme}
      t={t}
      onExitComplete={onQuickExitComplete}
      onRequestLaunch={setFocusPickTarget}
      onAlarmChange={onAlarmChange}
    />
  );

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <FlatList
        data={slots}
        keyExtractor={(item) => item.intention.id}
        renderItem={renderItem}
        extraData={`${theme.dark}-${connectEnabled}-${hideEventsOnRail}-${busyIntervals.map((b) => `${b.startMinutes}-${b.endMinutes}`).join('|')}-${slots.map((s) => `${s.intention.id}:${s.intention.alarm_enabled ? 1 : 0}`).join(',')}`}
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
  calendarCard: { marginTop: 12, paddingVertical: 12 },
  calendarTitle: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  calendarLine: { fontSize: 14, marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 6 },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  card: { marginBottom: 14 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bellGlyph: { fontSize: 17, lineHeight: 22 },
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
