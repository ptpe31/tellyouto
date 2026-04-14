import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { Leaf } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { getUserStatus, updateUserStatus } from '../../api/localDb';
import {
  getHerbierCount,
  getLocalEcoScore,
  getTrankilV2UnorganizedCount,
  getTrankilV2UserStats,
  harvestCurrentFlower,
} from '../../api/trankilV2Db';
import { flowerTypeForMonth } from '../../constants/Seasons';
import { STRINGS } from '../../constants/Strings';
import { applyAdReward, canRunAdSession, getSuggestedAdRewardType, showRewardedAd } from '../../services/AdManager';
import { useSaturation } from '../../context/SaturationContext';
import { LifeFlower } from '../../components/LifeFlower';
import { AdBanner } from './AdBanner';
import { GrowthArcGraph } from './GrowthArcGraph';
import { InsectSwarm } from './InsectSwarm';
import { RewardedActionPanel } from './RewardedActionPanel';
import type { BloomVisualState } from './types';
import { ZEN_PROJECT_CREDITS_MAX, ZEN_XP_PER_LEVEL } from './types';

const BLOOM_CYCLE: BloomVisualState[] = ['bloom', 'wilted', 'single_task'];
const INSECT_TIME_PENALTY_MS = 48 * 60 * 60 * 1000;

function computeSwarmCount(
  unorganizedCount: number,
  lastOrganizeAt: number | null,
  hasPrestige: boolean,
): number {
  let base = 0;
  if (unorganizedCount >= 4 && unorganizedCount <= 7) base = 3;
  else if (unorganizedCount > 7) base = 10;
  const stale =
    lastOrganizeAt != null && Date.now() - lastOrganizeAt > INSECT_TIME_PENALTY_MS;
  const raw = base + (stale ? 5 : 0);
  return hasPrestige ? Math.max(0, Math.floor(raw * 0.8)) : raw;
}

export function ZenGardenScreen() {
  const { isSaturated, animationMultiplier, runWithWeight, clearSaturationPulse } = useSaturation();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: winH, width: winW } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState(12);
  const [xp, setXp] = useState(780);
  const [credits, setCredits] = useState(2);
  const [remainingIntents, setRemainingIntents] = useState(10);
  const [weatherMode, setWeatherMode] = useState<'CLOUDY' | 'SUNNY'>('CLOUDY');
  const [vibrancyMode, setVibrancyMode] = useState(0.82);
  const [adBusy, setAdBusy] = useState(false);
  const [sprayVisible, setSprayVisible] = useState(false);
  const [swarmCount, setSwarmCount] = useState(0);
  const [swarmVisibleCount, setSwarmVisibleCount] = useState(0);
  const [dismissSwarmSignal, setDismissSwarmSignal] = useState(0);
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugTapCount, setDebugTapCount] = useState(0);
  const [profileMessage, setProfileMessage] = useState<string>(
    STRINGS.ads.profileBalanced,
  );
  const [localAffinity, setLocalAffinity] = useState(0.5);
  const [aestheticScore, setAestheticScore] = useState(0);
  const [utilityScore, setUtilityScore] = useState(0);
  const [growthScore, setGrowthScore] = useState(0);
  const [herbierCount, setHerbierCount] = useState(0);
  const [localEcoScore, setLocalEcoScore] = useState(0);
  const [previewPlant, setPreviewPlant] = useState<BloomVisualState | null>(
    null,
  );
  const sprayAnim = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    try {
      const row = await getUserStatus();
      const v2 = await getTrankilV2UserStats();
      const unorganizedCount = await getTrankilV2UnorganizedCount();
      const herbierTotal = await getHerbierCount();
      const nextSwarmCount = computeSwarmCount(
        unorganizedCount,
        v2.last_organize_at,
        herbierTotal > 3,
      );
      setLevel(row.current_level);
      setXp(row.current_xp);
      setCredits(row.credits_projet_ia);
      setWeatherMode(v2.weather_mode);
      setVibrancyMode(v2.vibrancy_mode);
      setRemainingIntents(v2.remaining_intents);
      setGrowthScore(v2.growth_score);
      setLocalAffinity(v2.local_affinity);
      setAestheticScore(v2.aesthetic_score);
      setUtilityScore(v2.utility_score);
      setHerbierCount(herbierTotal);
      setLocalEcoScore(await getLocalEcoScore());
      setSwarmVisibleCount(nextSwarmCount + Math.max(0, v2.debug_spawn_flies || 0));
      setSwarmCount(nextSwarmCount);
      if (v2.utility_score > v2.aesthetic_score + 1) {
        setProfileMessage(STRINGS.ads.profileUtility);
      } else if (v2.aesthetic_score > v2.utility_score + 1) {
        setProfileMessage(STRINGS.ads.profileAesthetic);
      } else {
        setProfileMessage(STRINGS.ads.profileBalanced);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const derivedPlant: BloomVisualState = credits <= 0 ? 'wilted' : 'bloom';
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

  const quotaText = t('quota.format', {
    current: Math.min(credits, ZEN_PROJECT_CREDITS_MAX),
    total: ZEN_PROJECT_CREDITS_MAX,
  });

  const killAllInsects = useCallback(() => {
    setDismissSwarmSignal((s) => s + 1);
  }, []);

  const onAdReward = useCallback(async () => {
    const gate = await canRunAdSession();
    if (!gate.ok) {
      Alert.alert(STRINGS.ads.watchAd, gate.reason ?? STRINGS.ads.cooldownActive);
      return;
    }
    setAdBusy(true);
    let didClean = false;
    try {
      const rewardType = await getSuggestedAdRewardType();
      const watched = await showRewardedAd(rewardType);
      if (!watched) return;
      const next = await applyAdReward(rewardType);
      setWeatherMode(next.weather_mode);
      setVibrancyMode(next.vibrancy_mode);
      if (rewardType === STRINGS.AD_REWARDS.REWARD_CLEAN) {
        didClean = true;
        clearSaturationPulse();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setRemainingIntents(10);
        setSwarmCount(0);
        killAllInsects();
        setSprayVisible(true);
        Speech.speak('psshhh', { rate: 1.0, pitch: 0.8 });
        Animated.sequence([
          Animated.timing(sprayAnim, { toValue: 0.95, duration: Math.round(130 * animationMultiplier), useNativeDriver: true }),
          Animated.timing(sprayAnim, { toValue: 0, duration: Math.round(280 * animationMultiplier), useNativeDriver: true }),
        ]).start(() => setSprayVisible(false));
      } else {
        setPreviewPlant('bloom');
      }
    } finally {
      setAdBusy(false);
      if (!didClean) {
        await load();
      }
    }
  }, [animationMultiplier, clearSaturationPulse, killAllInsects, load, sprayAnim]);

  const adLabel = useMemo(() => {
    if (remainingIntents <= 0 || utilityScore > aestheticScore + 1) {
      return STRINGS.ads.profileUtility;
    }
    if (aestheticScore > utilityScore + 1) {
      return STRINGS.ads.profileAesthetic;
    }
    if (weatherMode === 'CLOUDY') return STRINGS.ads.sunNudge;
    return profileMessage;
  }, [remainingIntents, weatherMode, aestheticScore, utilityScore, profileMessage]);

  const insectWarning = swarmCount > 7 ? STRINGS.INSECT_WARNING.swarm : STRINGS.INSECT_WARNING.lightBuzz;
  const ritualHint =
    localAffinity >= 0.72
      ? STRINGS.profiling.localFastLane
      : STRINGS.profiling.localBalanced;

  const onQuotaTap = useCallback(() => {
    setDebugTapCount((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setDebugVisible(true);
        return 0;
      }
      return next;
    });
    setTimeout(() => setDebugTapCount(0), 1400);
  }, []);

  const onHarvestFlower = useCallback(async () => {
    const monthFlower = flowerTypeForMonth(new Date().getMonth());
    await harvestCurrentFlower(monthFlower, monthFlower);
    Alert.alert(STRINGS.HARVEST_SUCCESS.title, STRINGS.HARVEST_SUCCESS.body);
    await load();
  }, [load]);

  const gradientColors: readonly [string, string, string, string, string] =
    weatherMode === 'SUNNY'
      ? ['#b7ebcd', '#c7efd8', '#e0f6cf', '#f4f8df', '#fff6dc']
      : ['#b8cfc4', '#d4e0d6', '#e8eee4', '#eef2e8', '#f5f4ef'];

  return (
    <LinearGradient
      colors={gradientColors}
      locations={[0, 0.22, 0.45, 0.72, 1]}
      start={{ x: 0.08, y: 0 }}
      end={{ x: 0.55, y: 1 }}
      style={[styles.root, { paddingTop: insets.top + 8, opacity: 0.86 + vibrancyMode * 0.14 }]}
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
        <View style={styles.body}>
          <View style={styles.topZone}>
            <GrowthArcGraph
              levelLine={t('zenGarden.levelShort', { level })}
              growthLine={t('zenGarden.growthXp', {
                current: xp,
                total: ZEN_XP_PER_LEVEL,
              })}
              xpIntoLevel={xp}
              xpForNext={ZEN_XP_PER_LEVEL}
            />
          </View>

          <View style={styles.plantZone}>
            <Pressable onLongPress={cyclePreview} delayLongPress={480}>
              <LifeFlower
                growthStage={visualPlant === 'wilted' ? Math.min(growthScore, 25) : growthScore}
                size={Math.min(220, Math.max(150, Math.round(winW * 0.46)))}
                flowerGlyph={localEcoScore >= 20 ? '🍃' : localEcoScore >= 8 ? '🌿' : undefined}
              />
            </Pressable>
            <InsectSwarm
              count={swarmVisibleCount}
              dismissSignal={dismissSwarmSignal}
              onDismissed={() => setSwarmVisibleCount(0)}
            />
          </View>

          <View style={[styles.panelZone, { paddingBottom: insets.bottom + 12 }]}>
            <RewardedActionPanel
              onBoostPress={() => runWithWeight(() => void onBoost())}
              onVideoPress={() => runWithWeight(() => void onVideo(), { bypass: true })}
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
              onQuotaPress={onQuotaTap}
            />
            <Text
              style={[styles.whisper, { marginTop: winH * 0.018 }]}
              accessibilityRole="text"
            >
              {`${t('zenGarden.whisper')} ${ritualHint}`}
            </Text>
            <Text style={styles.sobrietyLine}>
              {STRINGS.FLOWER.SOBRIETY_SCORE}: {localEcoScore}
            </Text>
            {swarmVisibleCount > 0 ? (
              <View style={styles.escapeCtaWrap}>
                <AdBanner
                  label={`${insectWarning} ${adLabel}`}
                  cta={STRINGS.ads.watchAd}
                  onPress={() => runWithWeight(() => void onAdReward(), { bypass: true })}
                  disabled={adBusy}
                />
              </View>
            ) : null}
            {growthScore >= 100 ? (
              <Pressable style={styles.harvestBtn} onPress={() => void onHarvestFlower()}>
                <Text style={styles.harvestBtnText}>{STRINGS.herbier.harvestAction}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
      {sprayVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.sprayOverlay, { opacity: sprayAnim }]}
        />
      ) : null}
      {isSaturated ? (
        <>
          <View pointerEvents="none" style={styles.saturationShade} />
          <BlurView pointerEvents="none" intensity={12} tint="dark" style={styles.saturationBlur} />
        </>
      ) : null}
      <Modal visible={debugVisible} transparent animationType="fade" onRequestClose={() => setDebugVisible(false)}>
        <Pressable style={styles.debugOverlay} onPress={() => setDebugVisible(false)}>
          <View style={styles.debugCard}>
            <Text style={styles.debugTitle}>{STRINGS.profiling.debugTitle}</Text>
            <Text style={styles.debugLine}>{STRINGS.FLOWER.DEBUG_AESTHETIC}: {aestheticScore.toFixed(2)}</Text>
            <Text style={styles.debugLine}>{STRINGS.FLOWER.DEBUG_UTILITY}: {utilityScore.toFixed(2)}</Text>
            <Text style={styles.debugLine}>{STRINGS.FLOWER.DEBUG_LOCAL_AFFINITY}: {localAffinity.toFixed(2)}</Text>
            <Text style={styles.debugLine}>{STRINGS.FLOWER.DEBUG_INSECTS}: {swarmCount}</Text>
            <Text style={styles.debugLine}>{STRINGS.FLOWER.DEBUG_HERBIER}: {herbierCount}</Text>
            <Text style={styles.debugLine}>{STRINGS.FLOWER.DEBUG_SOBRIETY}: {localEcoScore}</Text>
          </View>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: '5%',
    paddingBottom: 6,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2e5f68',
    letterSpacing: 0.3,
  },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  body: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    alignItems: 'center',
  },
  topZone: {
    width: '100%',
    flexShrink: 0,
    paddingTop: '1%',
  },
  plantZone: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '2%',
  },
  panelZone: {
    width: '100%',
    flexShrink: 0,
    alignItems: 'center',
    paddingHorizontal: '4%',
  },
  whisper: {
    width: '100%',
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(46, 95, 104, 0.42)',
    textAlign: 'center',
    letterSpacing: 0.65,
    lineHeight: 18,
  },
  sobrietyLine: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    textAlign: 'center',
  },
  sprayOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(226, 247, 255, 0.96)',
  },
  harvestBtn: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#0d9488',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  harvestBtnText: { color: '#f8fafc', fontSize: 13, fontWeight: '800' },
  escapeCtaWrap: {
    width: '100%',
    zIndex: 8,
  },
  saturationShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(78,84,90,0.22)',
  },
  saturationBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  debugOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.34)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  debugCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.2)',
    padding: 14,
  },
  debugTitle: { fontSize: 16, fontWeight: '800', color: '#0f766e', marginBottom: 8 },
  debugLine: { fontSize: 13, color: '#334155', marginBottom: 4, fontWeight: '600' },
});
