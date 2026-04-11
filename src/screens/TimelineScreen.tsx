import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listIntentionsDescending,
  markIntentionQuickComplete,
  LOCAL_DB_RESET_EVENT,
  type IntentionRow,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { FocusModePicker, NeumorphicCard } from '../components';
import { TimeIndicator } from '../components/TimeIndicator';
import type { FocusCapsuleMode } from '../navigation/types';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  buildTimelineSlots,
  type TimelineSlot,
} from '../services/agentLogic';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { recordQuickCompleteWithoutCapsule } from '../services/focusHabits';

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
};

function TimelineSlotRow({
  item,
  theme,
  t,
  onExitComplete,
  onRequestLaunch,
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
        <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
          {item.intention.title}
        </Text>
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

  const [slots, setSlots] = useState<TimelineSlot[]>([]);
  const [focusPickTarget, setFocusPickTarget] = useState<IntentionRow | null>(
    null,
  );

  const load = useCallback(async () => {
    const rows = (await listIntentionsDescending()).filter(
      (r) => r.status !== 'done',
    );
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const built = buildTimelineSlots(
      rows,
      {
        structure: spectrum.structure,
        momentum: spectrum.momentum,
        zen: spectrum.zen,
        stats: spectrum.stats,
      },
      new Date(),
    );
    setSlots(built);
  }, [spectrum]);

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

  const renderItem = ({ item }: { item: TimelineSlot }) => (
    <TimelineSlotRow
      item={item}
      theme={theme}
      t={t}
      onExitComplete={onQuickExitComplete}
      onRequestLaunch={setFocusPickTarget}
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
        extraData={theme.dark}
        contentContainerStyle={[
          styles.listPad,
          { paddingBottom: 24 + insets.bottom },
        ]}
        ListHeaderComponent={
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
          </View>
        }
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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listPad: { padding: 16 },
  header: { marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 6 },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  card: { marginBottom: 14 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
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
