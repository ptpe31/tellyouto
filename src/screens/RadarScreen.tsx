import { randomUUID } from 'expo-crypto';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
  insertIntention,
  listIntentionsDescending,
  markIntentionQuickComplete,
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
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  computeIntentionPriority,
  estimateDurationMinutes,
  inferIsLateNightIntent,
} from '../services/agentLogic';
import { getRadarAllyThoughtI18nKeyWithHabits } from '../services/agentVoice';
import {
  getQuickCompleteStreak,
  recordQuickCompleteWithoutCapsule,
} from '../services/focusHabits';

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
  const navigation = useNavigation();
  const { spectrum } = useUserSpectrum();

  const [rows, setRows] = useState<IntentionRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [allyTick, setAllyTick] = useState(0);
  const [quickStreak, setQuickStreak] = useState(0);
  const [focusPickTarget, setFocusPickTarget] = useState<IntentionRow | null>(
    null,
  );

  const load = useCallback(async () => {
    const list = await listIntentionsDescending();
    setRows(list.filter((r) => r.status !== 'done'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void getQuickCompleteStreak().then(setQuickStreak);
      setAllyTick((n) => n + 1);
      const id = setInterval(() => setAllyTick((n) => n + 1), 60_000);
      return () => clearInterval(id);
    }, [load]),
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
      getRadarAllyThoughtI18nKeyWithHabits(spectrum, new Date(), quickStreak),
    [spectrum, allyTick, quickStreak],
  );

  const openActiveCapsule = useCallback(() => {
    if (!activeIntention) return;
    navigation.getParent()?.navigate('FocusCapsule', {
      intentionId: activeIntention.id,
      mode: 'chrono',
    });
  }, [activeIntention, navigation]);

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
      navigation.getParent()?.navigate('FocusCapsule', {
        intentionId: row.id,
        mode,
      });
    },
    [focusPickTarget, navigation],
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
    });

    setTitle('');
    setDescription('');
    setUrgent(false);
    setDialogOpen(false);
    await load();
    void syncPendingIntentions();
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

  const listHeader = (
    <>
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

      <NeumorphicCard style={styles.headerCard}>
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>
          {t('tabs.radar')}
        </Text>
      </NeumorphicCard>

      <AllyThoughtBubble
        eyebrow={t('radar.allyEyebrow')}
        message={t(allyMessageKey)}
      />
    </>
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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listPad: { padding: 16, paddingBottom: 8 },
  activeCard: { marginBottom: 12, paddingVertical: 12 },
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
});
