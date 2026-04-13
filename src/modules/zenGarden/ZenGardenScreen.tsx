import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Leaf } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getUserStatus, updateUserStatus } from '../../api/localDb';
import { BloomStatusVisual } from './BloomStatusVisual';
import { GrowthArcGraph } from './GrowthArcGraph';
import { RewardedActionPanel } from './RewardedActionPanel';
import type { BloomVisualState } from './types';
import {
  ZEN_PROJECT_CREDITS_MAX,
  ZEN_XP_PER_LEVEL,
} from './types';

const BLOOM_CYCLE: BloomVisualState[] = ['bloom', 'wilted', 'single_task'];

export function ZenGardenScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState(12);
  const [xp, setXp] = useState(780);
  const [credits, setCredits] = useState(2);
  const [previewPlant, setPreviewPlant] = useState<BloomVisualState | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const row = await getUserStatus();
      setLevel(row.current_level);
      setXp(row.current_xp);
      setCredits(row.credits_projet_ia);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const derivedPlant: BloomVisualState =
    credits <= 0 ? 'wilted' : 'bloom';
  const visualPlant: BloomVisualState = previewPlant ?? derivedPlant;

  const cyclePreview = useCallback(() => {
    setPreviewPlant((prev) => {
      const auto: BloomVisualState = credits <= 0 ? 'wilted' : 'bloom';
      const base = prev ?? auto;
      const idx = BLOOM_CYCLE.indexOf(base);
      const next = BLOOM_CYCLE[(idx + 1) % BLOOM_CYCLE.length];
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return next;
    });
  }, [credits]);

  const onBoost = useCallback(async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const row = await getUserStatus();
    let nextXp = row.current_xp + 40;
    let nextLevel = row.current_level;
    while (nextXp >= ZEN_XP_PER_LEVEL) {
      nextXp -= ZEN_XP_PER_LEVEL;
      nextLevel += 1;
    }
    await updateUserStatus({
      credits_projet_ia: ZEN_PROJECT_CREDITS_MAX,
      current_xp: nextXp,
      current_level: nextLevel,
    });
    setPreviewPlant(null);
    await load();
  }, [load]);

  const onVideo = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const row = await getUserStatus();
    await updateUserStatus({
      credits_projet_ia: Math.min(
        ZEN_PROJECT_CREDITS_MAX,
        row.credits_projet_ia + 3,
      ),
    });
    await load();
  }, [load]);

  const progress = xp / ZEN_XP_PER_LEVEL;
  const quotaText = t('quota.format', {
    current: Math.min(credits, ZEN_PROJECT_CREDITS_MAX),
    total: ZEN_PROJECT_CREDITS_MAX,
  });

  return (
    <LinearGradient
      colors={['#d8e3d4', '#eef2e8', '#f5f4ef']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.4, y: 1 }}
      style={[styles.root, { paddingTop: insets.top + 8 }]}
    >
      <View style={styles.header}>
        <Leaf size={22} color="#2d6f70" />
        <Text style={styles.headerTitle}>{t('zenGarden.screenTitle')}</Text>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color="#2d6f70" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <GrowthArcGraph
            progress={progress}
            levelLabel={t('zenGarden.levelShort', { level })}
            growthXpLabel={t('zenGarden.growthXp', {
              current: xp,
              total: ZEN_XP_PER_LEVEL,
            })}
          />
          <View style={styles.centerBlock}>
            <BloomStatusVisual
              state={visualPlant}
              onLongPressCycle={cyclePreview}
              accessibilityLabel={t('zenGarden.plantA11y')}
            />
          </View>
          <RewardedActionPanel
            onBoostPress={() => void onBoost()}
            onVideoPress={() => void onVideo()}
            projectCreditsCurrent={Math.min(credits, ZEN_PROJECT_CREDITS_MAX)}
            projectCreditsMax={ZEN_PROJECT_CREDITS_MAX}
            boostLabel={t('zenGarden.actionBoost')}
            videoLabel={t('zenGarden.actionVideoReward')}
            panelTitle={t('zenGarden.actionZoneTitle')}
            quotaText={quotaText}
            quotaAccessibilityLabel={t('zenGarden.quotaA11y', {
              current: Math.min(credits, ZEN_PROJECT_CREDITS_MAX),
              total: ZEN_PROJECT_CREDITS_MAX,
            })}
          />
          <Text style={styles.whisper}>{t('zenGarden.whisper')}</Text>
        </ScrollView>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2e5f68',
    letterSpacing: 0.3,
  },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    alignItems: 'center',
  },
  centerBlock: {
    marginTop: 4,
    marginBottom: 22,
    alignItems: 'center',
  },
  whisper: {
    marginTop: 18,
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(46, 95, 104, 0.38)',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
});
