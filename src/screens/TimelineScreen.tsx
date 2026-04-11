import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react-native';
import {
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
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listIntentionsDescending,
  LOCAL_DB_RESET_EVENT,
  type IntentionRow,
} from '../api/localDb';
import { NeumorphicCard } from '../components';
import { TimeIndicator } from '../components/TimeIndicator';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  buildTimelineSlots,
  type TimelineSlot,
} from '../services/agentLogic';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function TimelineScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { spectrum } = useUserSpectrum();
  const navigation = useNavigation();

  const [slots, setSlots] = useState<TimelineSlot[]>([]);

  const load = useCallback(async () => {
    const rows = (await listIntentionsDescending()).filter(
      (r) => r.status !== 'done',
    );
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const built = buildTimelineSlots(rows, {
      structure: spectrum.structure,
      momentum: spectrum.momentum,
      zen: spectrum.zen,
      stats: spectrum.stats,
    });
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
    return () => sub.remove();
  }, [load]);

  const launch = (intention: IntentionRow) => {
    navigation.getParent()?.navigate('FocusCapsule', {
      intentionId: intention.id,
    });
  };

  const renderItem = ({ item }: { item: TimelineSlot }) => (
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
      <Pressable
        onPress={() => launch(item.intention)}
        style={({ pressed }) => [
          styles.launch,
          {
            backgroundColor: theme.colors.primary,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        <Text style={{ color: theme.colors.onPrimary, fontWeight: '600' }}>
          {t('timeline.launch')}
        </Text>
      </Pressable>
    </NeumorphicCard>
  );

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <FlatList
        data={slots}
        keyExtractor={(item) => item.intention.id}
        renderItem={renderItem}
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
  launch: {
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 14,
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
