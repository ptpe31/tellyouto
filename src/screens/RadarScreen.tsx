import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { MD3Theme } from 'react-native-paper';
import { Check, Sparkles } from 'lucide-react-native';
import {
  Button,
  Checkbox,
  Dialog,
  FAB,
  Portal,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ensureRoutineIntentionInstancesForHorizon,
  insertIntention,
  insertRoutine,
  listIntentionsDescending,
  markIntentionQuickComplete,
  recordMicroHabitFragmentCheck,
  LOCAL_DB_RESET_EVENT,
  type IntentionRow,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import {
  AllyThoughtBubble,
  FadeSlideIn,
  FocusModePicker,
  NeumorphicCard,
} from '../components';
import type { FocusCapsuleMode } from '../navigation/types';
import {
  requestAlarmPermissionIfNeeded,
  syncRailAlarmsWithTimeline,
} from '../services/alarmManager';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useFocusCalendarConflict } from '../hooks/useFocusCalendarConflict';
import {
  analyzeNewIntentionSemantics,
  buildTimelineSlots,
  estimateDurationMinutes,
  inferStructuralRoutinePlan,
  previewManualIntentionOverlapsHardRoutine,
  type BusyInterval,
  type TimelineSlot,
} from '../services/agentLogic';
import { getRadarAllyThoughtI18nKeyWithHabits } from '../services/agentVoice';
import { syncRailReminderScheduleFromSlots } from '../services/railReminderSchedule';
import {
  getQuickCompleteStreak,
  recordQuickCompleteWithoutCapsule,
} from '../services/focusHabits';
import { useWhatsAppInitCelebration } from '../hooks/useWhatsAppInitCelebration';
import { Platform } from '../utils/rnPlatform';
import {
  ONBOARDING_CHANNELS_SKIPPED_KEY,
  RADAR_CHANNELS_NUDGE_DISMISSED_KEY,
} from '../data/onboardingFlags';
import type { AppTabParamList } from '../navigation/types';

type RadarRowProps = {
  item: IntentionRow;
  index: number;
  theme: MD3Theme;
  t: TFunction;
  onExitComplete: (item: IntentionRow) => void;
  onRequestLaunch: (item: IntentionRow) => void;
};

function RadarIntentionRow({
  item,
  index,
  theme,
  t,
  onExitComplete,
  onRequestLaunch,
}: RadarRowProps) {
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
      onExitComplete(item);
    });
  };

  return (
    <FadeSlideIn index={index}>
      <Animated.View style={{ opacity, transform: [{ translateX }] }}>
        <NeumorphicCard style={styles.card}>
          <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
            {item.title}
          </Text>
          {item.description ? (
            <Text
              style={[styles.cardDesc, { color: theme.colors.onSurfaceVariant }]}
            >
              {item.description}
            </Text>
          ) : null}
          <Text style={[styles.meta, { color: theme.colors.primary }]}>
            {t('radar.priority', { value: item.priority })} ·{' '}
            {t(`radar.status.${item.status}`)}
          </Text>
          <View style={styles.rowActions}>
            <Pressable
              onPress={runQuickDone}
              style={({ pressed }) => [
                styles.doneBtn,
                { opacity: pressed ? 0.65 : 0.88 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('radar.done')}
            >
              <Check
                size={20}
                color={theme.colors.onSurfaceVariant}
                strokeWidth={2.2}
              />
            </Pressable>
            <Pressable
              onPress={() => onRequestLaunch(item)}
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
    </FadeSlideIn>
  );
}

export function RadarScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<BottomTabNavigationProp<AppTabParamList, 'Radar'>>();
  const { spectrum } = useUserSpectrum();
  const { connectEnabled, busyIntervals, refreshBusy } = useCalendarIntegration();
  const { shouldWarnForLaunch } = useFocusCalendarConflict();

  const [rows, setRows] = useState<IntentionRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [alarm, setAlarm] = useState(false);
  const [allyTick, setAllyTick] = useState(0);
  const [quickStreak, setQuickStreak] = useState(0);
  const [focusPickTarget, setFocusPickTarget] = useState<IntentionRow | null>(
    null,
  );
  const [calendarConflictOpen, setCalendarConflictOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{
    row: IntentionRow;
    mode: FocusCapsuleMode;
  } | null>(null);
  const [hardRoutineConflictOpen, setHardRoutineConflictOpen] = useState(false);
  const [hardBlockingRoutineName, setHardBlockingRoutineName] = useState('');
  const [railSlots, setRailSlots] = useState<TimelineSlot[]>([]);
  const { visible: celebrateWa, dismiss: dismissCelebrateWa } =
    useWhatsAppInitCelebration('radar');

  const [showChannelsNudge, setShowChannelsNudge] = useState(false);

  const refreshChannelsNudge = useCallback(async () => {
    const [skipped, dismissed] = await Promise.all([
      AsyncStorage.getItem(ONBOARDING_CHANNELS_SKIPPED_KEY),
      AsyncStorage.getItem(RADAR_CHANNELS_NUDGE_DISMISSED_KEY),
    ]);
    setShowChannelsNudge(skipped === 'true' && dismissed !== 'true');
  }, []);

  const load = useCallback(async () => {
    const list = await listIntentionsDescending();
    setRows(list.filter((r) => r.status !== 'done'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void refreshChannelsNudge();
      if (connectEnabled) void refreshBusy();
      void getQuickCompleteStreak().then(setQuickStreak);
      setAllyTick((n) => n + 1);
      const id = setInterval(() => setAllyTick((n) => n + 1), 60_000);
      return () => clearInterval(id);
    }, [load, connectEnabled, refreshBusy, refreshChannelsNudge]),
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(LOCAL_DB_RESET_EVENT, () => {
      void load();
    });
    const sub2 = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT, () => {
      void load();
    });
    return () => {
      sub.remove();
      sub2.remove();
    };
  }, [load]);

  useEffect(() => {
    if (rows.length === 0) {
      setRailSlots([]);
      return;
    }
    const busyForAgent: BusyInterval[] = connectEnabled ? busyIntervals : [];
    const built = buildTimelineSlots(
      rows,
      {
        structure: spectrum.structure,
        momentum: spectrum.momentum,
        zen: spectrum.zen,
        stats: spectrum.stats,
      },
      new Date(),
      { busyIntervals: busyForAgent },
    );
    setRailSlots(built);
    void syncRailReminderScheduleFromSlots(built, new Date(), spectrum);
  }, [rows, spectrum, connectEnabled, busyIntervals]);

  const nowMinutes = useMemo(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, [allyTick, rows]);

  const dueMicroSlot = useMemo(() => {
    for (const s of railSlots) {
      if (s.railVariant !== 'micro_pastille') continue;
      if (nowMinutes >= s.startMinutes && nowMinutes < s.endMinutes) {
        return s;
      }
    }
    return null;
  }, [railSlots, nowMinutes]);

  const onVerifyMicro = useCallback(async (slot: TimelineSlot) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = new Date();
    const dayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await recordMicroHabitFragmentCheck({
      id: `${slot.intention.id}_${dayYmd}_${slot.microFragmentIndex ?? 0}`,
      intention_id: slot.intention.id,
      day_ymd: dayYmd,
      fragment_index: slot.microFragmentIndex ?? 1,
    });
    DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
  }, []);

  const activeIntention = useMemo(
    () => rows.find((r) => r.status === 'active') ?? null,
    [rows],
  );

  const allyMessageKey = useMemo(
    () =>
      getRadarAllyThoughtI18nKeyWithHabits(spectrum, new Date(), quickStreak),
    [spectrum, allyTick, quickStreak],
  );

  const allyBubbleText = useMemo(() => {
    const name = spectrum.first_name?.trim();
    const base = t(allyMessageKey);
    if (!name) return base;
    return `${t('allyVoice.personalGreeting', { name })}${base}`;
  }, [allyMessageKey, spectrum.first_name, t]);

  const navigateFocus = useCallback(
    (row: IntentionRow, mode: FocusCapsuleMode) => {
      navigation.getParent()?.navigate('FocusCapsule', {
        intentionId: row.id,
        mode,
      });
    },
    [navigation],
  );

  const openActiveCapsule = useCallback(() => {
    if (!activeIntention) return;
    if (shouldWarnForLaunch('chrono', activeIntention)) {
      setPendingFocus({ row: activeIntention, mode: 'chrono' });
      setCalendarConflictOpen(true);
      return;
    }
    navigateFocus(activeIntention, 'chrono');
  }, [activeIntention, shouldWarnForLaunch, navigateFocus]);

  const onQuickExitComplete = useCallback(
    async (item: IntentionRow) => {
      await markIntentionQuickComplete(item.id);
      await recordQuickCompleteWithoutCapsule();
      setQuickStreak(await getQuickCompleteStreak());
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
      void syncPendingIntentions();
      await load();
    },
    [load],
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

  const onAdd = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const desc = description.trim();
    const now = new Date();
    const uid = spectrum.platform_user_id?.trim() || '';

    const pending = (await listIntentionsDescending()).filter(
      (r) => r.status !== 'done',
    );
    let busyForAgent: BusyInterval[] = connectEnabled ? busyIntervals : [];
    const overlap = previewManualIntentionOverlapsHardRoutine(
      pending,
      trimmedTitle,
      desc,
      spectrum,
      now,
      busyForAgent,
      uid,
    );
    if (overlap.overlaps) {
      setHardBlockingRoutineName(overlap.blockingTitle ?? '—');
      setHardRoutineConflictOpen(true);
      return;
    }

    const userForcedUrgent = urgent;
    const { priority, isMicroHabit, isLateNight: is_late_night, isHardConstraint } =
      analyzeNewIntentionSemantics(trimmedTitle, desc, spectrum, now, {
        userForcedUrgent,
      });
    const estimated_duration = estimateDurationMinutes(trimmedTitle, desc, spectrum);

    if (isHardConstraint) {
      const plan = inferStructuralRoutinePlan(
        trimmedTitle,
        desc,
        spectrum,
        now,
      );
      if (plan) {
        const routineId = randomUUID();
        await insertRoutine({
          id: routineId,
          title: trimmedTitle,
          description: desc,
          weekday: plan.weekday,
          start_minutes: plan.startMinutes,
          duration_min: plan.durationMin,
          weights: {
            structure: spectrum.structure,
            momentum: spectrum.momentum,
            zen: spectrum.zen,
            stats: spectrum.stats,
          },
          priority,
          platform_type: 'none',
          platform_user_id: uid,
          created_at: Date.now(),
        });
        await ensureRoutineIntentionInstancesForHorizon(routineId, uid);
      } else {
        await insertIntention({
          id: randomUUID(),
          title: trimmedTitle,
          description: desc,
          status: 'pending',
          priority,
          weights: {
            structure: spectrum.structure,
            momentum: spectrum.momentum,
            zen: spectrum.zen,
            stats: spectrum.stats,
          },
          platform_type: 'none',
          platform_user_id: uid,
          created_at: Date.now(),
          estimated_duration,
          user_forced_urgent: userForcedUrgent,
          is_late_night,
          alarm_enabled: alarm,
          is_micro_habit: isMicroHabit,
          is_hard_constraint: false,
        });
      }
    } else {
      await insertIntention({
        id: randomUUID(),
        title: trimmedTitle,
        description: desc,
        status: 'pending',
        priority,
        weights: {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        },
        platform_type: 'none',
        platform_user_id: uid,
        created_at: Date.now(),
        estimated_duration,
        user_forced_urgent: userForcedUrgent,
        is_late_night,
        alarm_enabled: alarm,
        is_micro_habit: isMicroHabit,
        is_hard_constraint: false,
      });
    }

    setTitle('');
    setDescription('');
    setUrgent(false);
    setAlarm(false);
    setDialogOpen(false);
    await load();
    void syncPendingIntentions();

    const list = await listIntentionsDescending();
    const pendingAfter = list.filter((r) => r.status !== 'done');
    let busyAfter: BusyInterval[] = [];
    if (connectEnabled) {
      busyAfter = await refreshBusy();
    }
    const railNow = new Date();
    const built = buildTimelineSlots(
      pendingAfter,
      {
        structure: spectrum.structure,
        momentum: spectrum.momentum,
        zen: spectrum.zen,
        stats: spectrum.stats,
      },
      railNow,
      { busyIntervals: busyAfter },
    );
    await syncRailAlarmsWithTimeline({
      pendingIntentions: pendingAfter,
      slots: built,
      now: railNow,
    });
    DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
  };

  const renderItem = ({
    item,
    index,
  }: {
    item: IntentionRow;
    index: number;
  }) => (
    <RadarIntentionRow
      item={item}
      index={index}
      theme={theme}
      t={t}
      onExitComplete={onQuickExitComplete}
      onRequestLaunch={setFocusPickTarget}
    />
  );

  const listHeader = useMemo(
    () => (
      <>
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
        {showChannelsNudge ? (
          <NeumorphicCard
            style={[
              styles.channelsNudgeCard,
              { borderColor: theme.colors.tertiary },
            ]}
          >
            <Text
              style={[styles.channelsNudgeTitle, { color: theme.colors.onSurface }]}
            >
              {t('radar.channelsNudgeTitle')}
            </Text>
            <Text
              style={[
                styles.channelsNudgeBody,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('radar.channelsNudgeBody')}
            </Text>
            <View style={styles.channelsNudgeActions}>
              <Button
                mode="contained-tonal"
                compact
                onPress={() => {
                  void AsyncStorage.setItem(RADAR_CHANNELS_NUDGE_DISMISSED_KEY, 'true');
                  setShowChannelsNudge(false);
                }}
              >
                {t('radar.channelsNudgeDismiss')}
              </Button>
              <Button
                mode="contained"
                compact
                onPress={() =>
                  navigation.navigate('AgentIA', { screen: 'AgentSettings' })
                }
              >
                {t('radar.channelsNudgeCta')}
              </Button>
            </View>
          </NeumorphicCard>
        ) : null}
        {activeIntention ? (
          <NeumorphicCard style={styles.activeCard}>
            <View style={styles.activeRow}>
              <View style={styles.activeTextCol}>
                <Text
                  style={[
                    styles.activeLabel,
                    { color: theme.colors.primary },
                  ]}
                >
                  {t('radar.activeSessionTitle')}
                </Text>
                <Text
                  style={[styles.activeTitle, { color: theme.colors.onSurface }]}
                  numberOfLines={1}
                >
                  {activeIntention.title}
                </Text>
              </View>
              <Pressable
                onPress={openActiveCapsule}
                style={({ pressed }) => [
                  styles.activeCta,
                  {
                    backgroundColor: theme.colors.primary,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('radar.activeSessionOpen')}
              >
                <Text style={{ color: theme.colors.onPrimary, fontWeight: '700' }}>
                  {t('radar.activeSessionOpen')}
                </Text>
              </Pressable>
            </View>
          </NeumorphicCard>
        ) : null}

        {dueMicroSlot ? (
          <NeumorphicCard style={styles.microNowCard}>
            <Text style={[styles.activeLabel, { color: theme.colors.secondary }]}>
              {t('radar.microNowTitle')}
            </Text>
            <Text
              style={[styles.microNowTitle, { color: theme.colors.onSurface }]}
              numberOfLines={2}
            >
              {dueMicroSlot.intention.title}
            </Text>
            <Text
              style={[
                styles.microNowHint,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('radar.microVerifyQuestion')}
            </Text>
            <Button
              mode="contained-tonal"
              onPress={() => void onVerifyMicro(dueMicroSlot)}
              style={styles.microVerifyBtn}
            >
              {t('radar.microVerifyCta')}
            </Button>
          </NeumorphicCard>
        ) : null}

        <NeumorphicCard style={styles.headerCard}>
          <Text style={[styles.title, { color: theme.colors.onBackground }]}>
            {t('tabs.radar')}
          </Text>
        </NeumorphicCard>

        {spectrum.first_name?.trim() ? (
          <View style={styles.userNameRow}>
            <Text
              style={[styles.userFirstName, { color: theme.colors.onSurface }]}
            >
              {spectrum.first_name.trim()}
            </Text>
            {spectrum.isProUser ? (
              <View
                style={[
                  styles.proBadge,
                  { borderColor: theme.colors.primary },
                ]}
              >
                <Text style={[styles.proBadgeText, { color: theme.colors.primary }]}>
                  {t('radar.proBadge')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

      <AllyThoughtBubble
        eyebrow={t('radar.allyEyebrow')}
        message={allyBubbleText}
      />
      {spectrum.lastMessengerUserId && spectrum.lastMessengerChannel ? (
        <Text
          style={[styles.messengerLinkHint, { color: theme.colors.tertiary }]}
        >
          {t('radar.messengerVoiceActive')}
        </Text>
      ) : (
        <View style={styles.pureAllyRow}>
          <View
            style={[
              styles.pureAllyBadge,
              { borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text
              style={[styles.pureAllyBadgeText, { color: theme.colors.outline }]}
            >
              {t('radar.pureAllyModeBadge')}
            </Text>
          </View>
          <Text
            style={[styles.messengerInactiveHint, { color: theme.colors.outline }]}
          >
            {t('radar.messengerDictationInactive')}
          </Text>
        </View>
      )}
      </>
    ),
    [
      activeIntention,
      dueMicroSlot,
      allyBubbleText,
      spectrum.first_name,
      spectrum.isProUser,
      spectrum.lastMessengerUserId,
      spectrum.lastMessengerChannel,
      celebrateWa,
      dismissCelebrateWa,
      showChannelsNudge,
      navigation,
      openActiveCapsule,
      onVerifyMicro,
      t,
      theme.colors,
    ],
  );

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={theme.dark}
        contentContainerStyle={[
          styles.listPad,
          { paddingBottom: 100 + insets.bottom },
        ]}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <NeumorphicCard style={styles.emptyCard}>
            <Sparkles
              color={theme.colors.primary}
              size={32}
              style={styles.emptyIcon}
            />
            <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
              {t('radar.emptyTitle')}
            </Text>
            <Text
              style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('radar.emptyBody')}
            </Text>
          </NeumorphicCard>
        }
      />

      <FAB
        icon="plus"
        style={[
          styles.fab,
          {
            bottom: 24 + insets.bottom,
            backgroundColor: theme.colors.secondary,
          },
        ]}
        onPress={() => setDialogOpen(true)}
        color={theme.colors.onSecondary}
        size="medium"
      />

      <Portal>
        <Dialog
          visible={dialogOpen}
          onDismiss={() => setDialogOpen(false)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title>{t('radar.quickAddTitle')}</Dialog.Title>
          <Dialog.Content>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <TextInput
                mode="outlined"
                label={t('radar.fieldTitle')}
                value={title}
                onChangeText={setTitle}
                style={styles.input}
              />
              <TextInput
                mode="outlined"
                label={t('radar.fieldDescription')}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                style={styles.input}
              />
              <Pressable
                style={styles.urgentRow}
                onPress={() => setUrgent((u) => !u)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: urgent }}
              >
                <Checkbox.Android
                  status={urgent ? 'checked' : 'unchecked'}
                  onPress={() => setUrgent((u) => !u)}
                />
                <Text
                  style={[
                    styles.urgentLabel,
                    { color: theme.colors.onSurface },
                  ]}
                >
                  {t('radar.urgentLabel')}
                </Text>
              </Pressable>
              <Pressable
                style={styles.urgentRow}
                onPress={() => {
                  void (async () => {
                    const next = !alarm;
                    if (next) {
                      const ok = await requestAlarmPermissionIfNeeded();
                      if (!ok) return;
                    }
                    setAlarm(next);
                  })();
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: alarm }}
              >
                <Checkbox.Android
                  status={alarm ? 'checked' : 'unchecked'}
                  onPress={() => {
                    void (async () => {
                      const next = !alarm;
                      if (next) {
                        const ok = await requestAlarmPermissionIfNeeded();
                        if (!ok) return;
                      }
                      setAlarm(next);
                    })();
                  }}
                />
                <Text
                  style={[
                    styles.urgentLabel,
                    { color: theme.colors.onSurface },
                  ]}
                >
                  {t('radar.alarmLabel')}
                </Text>
              </Pressable>
            </KeyboardAvoidingView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogOpen(false)}>
              {t('radar.cancel')}
            </Button>
            <Button mode="contained" onPress={() => void onAdd()}>
              {t('radar.save')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog
          visible={hardRoutineConflictOpen}
          onDismiss={() => setHardRoutineConflictOpen(false)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title>{t('ally.hardRoutineConflictTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.onSurface }}>
              {t('ally.hardRoutineConflictBody', {
                name: hardBlockingRoutineName,
              })}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              mode="contained"
              onPress={() => setHardRoutineConflictOpen(false)}
            >
              {t('ally.hardRoutineConflictDismiss')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

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
  listPad: { padding: 16, paddingBottom: 8 },
  celebrationCard: {
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  celebrationText: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  channelsNudgeCard: {
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  channelsNudgeTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  channelsNudgeBody: { fontSize: 14, lineHeight: 21, marginBottom: 12 },
  channelsNudgeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  activeCard: { marginBottom: 12, paddingVertical: 12 },
  microNowCard: {
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(186, 220, 205, 0.35)',
  },
  microNowTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  microNowHint: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  microVerifyBtn: { alignSelf: 'flex-start' },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activeTextCol: { flex: 1, minWidth: 0 },
  activeLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  activeTitle: { fontSize: 16, fontWeight: '600' },
  activeCta: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  headerCard: { marginBottom: 14, paddingVertical: 14 },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  userFirstName: { fontSize: 17, fontWeight: '700' },
  proBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  proBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  title: { fontSize: 22, fontWeight: '600' },
  card: { marginBottom: 14 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  cardDesc: { marginTop: 6, fontSize: 14, lineHeight: 20 },
  meta: { marginTop: 10, fontSize: 12, fontWeight: '600' },
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
  fab: { position: 'absolute', right: 20 },
  input: { marginBottom: 8 },
  urgentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  urgentLabel: { flex: 1, fontSize: 14 },
  emptyCard: { alignItems: 'center', paddingVertical: 22 },
  emptyIcon: { marginBottom: 12 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptyBody: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  messengerLinkHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 4,
  },
  pureAllyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 6,
  },
  pureAllyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pureAllyBadgeText: { fontSize: 11, fontWeight: '700' },
  messengerInactiveHint: { fontSize: 12, flex: 1, minWidth: 120, lineHeight: 17 },
});
