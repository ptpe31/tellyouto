import { randomUUID } from 'expo-crypto';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DeviceEventEmitter,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
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
import { Check, Sparkles } from 'lucide-react-native';

import {
  insertIntention,
  listIntentionsDescending,
  markIntentionQuickComplete,
  LOCAL_DB_RESET_EVENT,
  type IntentionRow,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { AllyThoughtBubble, FocusModePicker, NeumorphicCard } from '../components';
import type { FocusCapsuleMode } from '../navigation/types';
import {
  requestAlarmPermissionIfNeeded,
  syncRailAlarmsWithTimeline,
} from '../services/alarmManager';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import {
  useUserSpectrum,
  type RadarMoodIndex,
} from '../context/UserSpectrumContext';
import { useFocusCalendarConflict } from '../hooks/useFocusCalendarConflict';
import {
  buildTimelineSlots,
  computeIntentionPriority,
  estimateDurationMinutes,
  inferIsLateNightIntent,
  type BusyInterval,
  type TimelineSlot,
} from '../services/agentLogic';
import { getRadarAllyThoughtI18nKeyWithHabits } from '../services/agentVoice';
import {
  getQuickCompleteStreak,
  recordQuickCompleteWithoutCapsule,
} from '../services/focusHabits';
import { palette } from '../theme/colors';
import { neumorphicInset, neumorphicRaised } from '../theme/neumorphism';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MOOD_EMOJIS = ['😫', '😐', '🙂', '😄', '🚀'] as const;

function getNextTimelineSlot(
  slots: TimelineSlot[],
  active: IntentionRow | null,
): TimelineSlot | null {
  if (slots.length === 0) return null;
  if (!active) {
    return slots.length > 1 ? (slots[1] ?? null) : null;
  }
  const i = slots.findIndex((s) => s.intention.id === active.id);
  if (i >= 0) {
    return slots[i + 1] ?? null;
  }
  return slots.find((s) => s.intention.id !== active.id) ?? null;
}

export function RadarScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { spectrum, setRadarMood } = useUserSpectrum();
  const { connectEnabled, refreshBusy } = useCalendarIntegration();
  const { shouldWarnForLaunch } = useFocusCalendarConflict();

  const [rows, setRows] = useState<IntentionRow[]>([]);
  const [slots, setSlots] = useState<TimelineSlot[]>([]);
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

  const load = useCallback(async () => {
    const list = await listIntentionsDescending();
    const pending = list.filter((r) => r.status !== 'done');
    setRows(pending);
    let busyForAgent: BusyInterval[] = [];
    if (connectEnabled) {
      busyForAgent = await refreshBusy();
    }
    const now = new Date();
    const built = buildTimelineSlots(
      pending,
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
  }, [
    spectrum.structure,
    spectrum.momentum,
    spectrum.zen,
    spectrum.stats,
    connectEnabled,
    refreshBusy,
  ]);

  useFocusEffect(
    useCallback(() => {
      void load();
      if (connectEnabled) void refreshBusy();
      void getQuickCompleteStreak().then(setQuickStreak);
      setAllyTick((n) => n + 1);
      const id = setInterval(() => setAllyTick((n) => n + 1), 60_000);
      return () => clearInterval(id);
    }, [load, connectEnabled, refreshBusy]),
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

  const activeIntention = useMemo(
    () => rows.find((r) => r.status === 'active') ?? null,
    [rows],
  );

  const allyMessageKey = useMemo(
    () =>
      getRadarAllyThoughtI18nKeyWithHabits(
        spectrum,
        new Date(),
        quickStreak,
      ),
    [spectrum, allyTick, quickStreak],
  );

  const nowSlot = useMemo(() => {
    if (activeIntention) return null;
    return slots[0] ?? null;
  }, [activeIntention, slots]);

  const nextSlot = useMemo(
    () => getNextTimelineSlot(slots, activeIntention),
    [slots, activeIntention],
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

  const openActiveCapsule = useCallback(() => {
    if (!activeIntention) return;
    if (shouldWarnForLaunch('chrono', activeIntention)) {
      setPendingFocus({ row: activeIntention, mode: 'chrono' });
      setCalendarConflictOpen(true);
      return;
    }
    navigateFocus(activeIntention, 'chrono');
  }, [activeIntention, shouldWarnForLaunch, navigateFocus]);

  const launchFromSlot = useCallback(
    (intention: IntentionRow) => {
      if (shouldWarnForLaunch('chrono', intention)) {
        setPendingFocus({ row: intention, mode: 'chrono' });
        setCalendarConflictOpen(true);
        return;
      }
      setFocusPickTarget(intention);
    },
    [shouldWarnForLaunch],
  );

  const onQuickExitMain = useCallback(
    async (item: IntentionRow) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
    const userForcedUrgent = urgent;
    const priority = computeIntentionPriority(trimmedTitle, desc, spectrum, now, {
      userForcedUrgent,
    });
    const is_late_night = inferIsLateNightIntent(trimmedTitle, desc, now);
    const estimated_duration = estimateDurationMinutes(trimmedTitle, desc, spectrum);

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
      platform_user_id: spectrum.platform_user_id,
      created_at: Date.now(),
      estimated_duration,
      user_forced_urgent: userForcedUrgent,
      is_late_night,
      alarm_enabled: alarm,
    });

    setTitle('');
    setDescription('');
    setUrgent(false);
    setAlarm(false);
    setDialogOpen(false);
    await load();
    void syncPendingIntentions();

    const list = await listIntentionsDescending();
    const pending = list.filter((r) => r.status !== 'done');
    let busyForAgent: BusyInterval[] = [];
    if (connectEnabled) {
      busyForAgent = await refreshBusy();
    }
    const railNow = new Date();
    const built = buildTimelineSlots(
      pending,
      {
        structure: spectrum.structure,
        momentum: spectrum.momentum,
        zen: spectrum.zen,
        stats: spectrum.stats,
      },
      railNow,
      { busyIntervals: busyForAgent },
    );
    await syncRailAlarmsWithTimeline({
      pendingIntentions: pending,
      slots: built,
      now: railNow,
    });
    DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
  };

  const onPickMood = (idx: number) => {
    void setRadarMood(idx as RadarMoodIndex);
  };

  const inset = neumorphicInset(theme);
  const raised = neumorphicRaised(theme);

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollPad,
          { paddingBottom: 100 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.kicker, { color: theme.colors.primary }]}>
          {t('radar.cockpitKicker')}
        </Text>
        <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
          {t('tabs.radar')}
        </Text>

        <AllyThoughtBubble
          eyebrow={t('radar.allyEyebrow')}
          message={t(allyMessageKey)}
        />

        <NeumorphicCard style={styles.moodSection}>
          <Text
            style={[styles.moodPrompt, { color: theme.colors.onSurfaceVariant }]}
          >
            {t('radar.moodTitle')}
          </Text>
          <View style={styles.moodRow}>
            {MOOD_EMOJIS.map((emoji, idx) => {
              const selected = spectrum.radar_mood === idx;
              return (
                <Pressable
                  key={emoji}
                  onPress={() => onPickMood(idx)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  hitSlop={6}
                >
                  <View
                    style={[
                      styles.moodCircle,
                      selected
                        ? [
                            raised,
                            styles.moodCircleSelected,
                            { borderColor: palette.teal },
                          ]
                        : [inset, styles.moodCircleIdle],
                    ]}
                  >
                    <Text style={styles.moodEmoji}>{emoji}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </NeumorphicCard>

        <Text style={[styles.sectionLabel, { color: theme.colors.primary }]}>
          {t('radar.sectionNow')}
        </Text>
        <NeumorphicCard style={styles.nowCard}>
          {activeIntention ? (
            <>
              <Text
                style={[styles.nowEyebrow, { color: theme.colors.primary }]}
              >
                {t('radar.activeSessionTitle')}
              </Text>
              <Text
                style={[styles.nowTitle, { color: theme.colors.onSurface }]}
              >
                {activeIntention.title}
              </Text>
              {activeIntention.description ? (
                <Text
                  style={[
                    styles.nowDesc,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={3}
                >
                  {activeIntention.description}
                </Text>
              ) : null}
              <Pressable
                onPress={openActiveCapsule}
                style={({ pressed }) => [
                  styles.heroCta,
                  {
                    backgroundColor: theme.colors.primary,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <Text style={[styles.heroCtaText, { color: theme.colors.onPrimary }]}>
                  {t('radar.continueCta')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void onQuickExitMain(activeIntention)}
                style={styles.doneLinkRow}
                accessibilityRole="button"
                accessibilityLabel={t('radar.done')}
              >
                <Check
                  size={22}
                  color={theme.colors.onSurfaceVariant}
                  strokeWidth={2.2}
                />
                <Text
                  style={[
                    styles.doneLinkText,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {t('radar.done')}
                </Text>
              </Pressable>
            </>
          ) : nowSlot ? (
            <>
              <Text
                style={[styles.nowEyebrow, { color: theme.colors.primary }]}
              >
                {t('timeline.suggestedWindow', {
                  start: nowSlot.startLabel,
                  end: nowSlot.endLabel,
                })}
              </Text>
              <Text
                style={[styles.nowTitle, { color: theme.colors.onSurface }]}
              >
                {nowSlot.intention.title}
              </Text>
              {nowSlot.intention.description ? (
                <Text
                  style={[
                    styles.nowDesc,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={3}
                >
                  {nowSlot.intention.description}
                </Text>
              ) : null}
              <Pressable
                onPress={() => launchFromSlot(nowSlot.intention)}
                style={({ pressed }) => [
                  styles.heroCta,
                  {
                    backgroundColor: theme.colors.primary,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <Text style={[styles.heroCtaText, { color: theme.colors.onPrimary }]}>
                  {t('radar.launchCta')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void onQuickExitMain(nowSlot.intention)}
                style={styles.doneLinkRow}
                accessibilityRole="button"
              >
                <Check
                  size={22}
                  color={theme.colors.onSurfaceVariant}
                  strokeWidth={2.2}
                />
                <Text
                  style={[
                    styles.doneLinkText,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {t('radar.done')}
                </Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.emptyNowBlock}>
              <Sparkles
                color={theme.colors.primary}
                size={36}
                style={{ marginBottom: 10 }}
              />
              <Text
                style={[styles.nowTitle, { color: theme.colors.onSurface }]}
              >
                {t('radar.emptyTitle')}
              </Text>
              <Text
                style={[
                  styles.nowIdleHint,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {t('radar.nowIdle')}
              </Text>
            </View>
          )}
        </NeumorphicCard>

        <Text style={[styles.sectionLabel, { color: theme.colors.primary }]}>
          {t('radar.sectionNext')}
        </Text>
        <NeumorphicCard style={styles.nextCard}>
          {nextSlot ? (
            <>
              <Text
                style={[styles.nextTime, { color: theme.colors.primary }]}
              >
                {t('radar.nextStarts', { time: nextSlot.startLabel })}
              </Text>
              <Text
                style={[styles.nextTitle, { color: theme.colors.onSurface }]}
              >
                {nextSlot.intention.title}
              </Text>
              {nextSlot.intention.description ? (
                <Text
                  style={[
                    styles.nextDesc,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={2}
                >
                  {nextSlot.intention.description}
                </Text>
              ) : null}
            </>
          ) : (
            <Text
              style={[styles.nextEmpty, { color: theme.colors.onSurfaceVariant }]}
            >
              {rows.length === 0
                ? t('radar.emptyCockpit')
                : t('radar.emptyBody')}
            </Text>
          )}
        </NeumorphicCard>
      </ScrollView>

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
  scrollPad: { padding: 16, paddingTop: 12 },
  kicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  heroTitle: { fontSize: 26, fontWeight: '800', marginBottom: 12 },
  moodSection: { marginBottom: 18, paddingVertical: 14 },
  moodPrompt: { fontSize: 14, fontWeight: '600', marginBottom: 12 },
  moodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  moodCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodCircleIdle: { opacity: 0.95 },
  moodCircleSelected: {
    borderWidth: 2,
  },
  moodEmoji: { fontSize: 22 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  nowCard: {
    marginBottom: 20,
    paddingVertical: 20,
    paddingHorizontal: 18,
    minHeight: 200,
  },
  nowEyebrow: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  nowTitle: { fontSize: 24, fontWeight: '800', lineHeight: 30 },
  nowDesc: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  heroCta: {
    marginTop: 20,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCtaText: { fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  doneLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    alignSelf: 'center',
  },
  doneLinkText: { fontSize: 15, fontWeight: '600' },
  emptyNowBlock: { alignItems: 'center', paddingVertical: 8 },
  nowIdleHint: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
  },
  nextCard: { paddingVertical: 16, paddingHorizontal: 16, marginBottom: 8 },
  nextTime: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  nextTitle: { fontSize: 18, fontWeight: '700' },
  nextDesc: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  nextEmpty: { fontSize: 15, lineHeight: 22 },
  fab: { position: 'absolute', right: 20 },
  input: { marginBottom: 8 },
  urgentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  urgentLabel: { flex: 1, fontSize: 14 },
});
