import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BookOpen,
  Briefcase,
  Car,
  Coffee,
  Gift,
  Heart,
  Home,
  Leaf,
  Moon,
  Music,
  Plane,
  Sparkles,
  Star,
  Sun,
  Target,
  Zap,
} from 'lucide-react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  applyMelimeloGrouping,
  getUserStatus,
  listUnclusteredPendingIntentions,
  updateUserStatus,
  type IntentionRow,
} from '../api/localDb';
import { useMagicShake } from '../hooks/useMagicShake';
import type { AppTabParamList } from '../navigation/types';
import {
  geminiMelimeloClusterNotes,
  getGeminiApiKey,
  type MelimeloGeminiGroup,
} from '../services/geminiSemanticLab';

const { width: SW, height: SH } = Dimensions.get('window');
const BUBBLE_W = 108;
const BUBBLE_H = 72;
const CHAOS_TOP = 88;
const CHAOS_H = Math.min(SH * 0.38, 280);

const ICON_MAP: Record<
  string,
  React.ComponentType<{ size: number; color: string }>
> = {
  briefcase: Briefcase,
  home: Home,
  heart: Heart,
  star: Star,
  book: BookOpen,
  leaf: Leaf,
  zap: Zap,
  coffee: Coffee,
  music: Music,
  moon: Moon,
  sun: Sun,
  car: Car,
  plane: Plane,
  target: Target,
  gift: Gift,
};

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function chaosPosition(id: string): { left: number; top: number; rotate: string } {
  const s = hashSeed(id);
  const left = (s % 68) * 0.01 * (SW - BUBBLE_W - 16) + 8;
  const top = CHAOS_TOP + ((s >> 5) % 72) * 0.01 * (CHAOS_H - BUBBLE_H - 12) + 6;
  const deg = ((s % 19) - 9) * 1.1;
  return { left, top, rotate: `${deg}deg` };
}

type Phase = 'chaos' | 'thinking' | 'crystallizing' | 'sorted';

type SortedPile = MelimeloGeminiGroup & { clusterId: string };

function MeliBubble({
  item,
  chaosLeft,
  chaosTop,
  rotateDeg,
  intensitySV,
  phase,
  targetX,
  targetY,
}: {
  item: IntentionRow;
  chaosLeft: number;
  chaosTop: number;
  rotateDeg: string;
  intensitySV: SharedValue<number>;
  phase: Phase;
  targetX: number;
  targetY: number;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const jx = useSharedValue(0);
  const jy = useSharedValue(0);

  useEffect(() => {
    if (phase === 'thinking') {
      jx.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 95 }),
          withTiming(-1, { duration: 95 }),
          withTiming(0.6, { duration: 70 }),
          withTiming(-0.8, { duration: 80 }),
        ),
        -1,
        false,
      );
      jy.value = withRepeat(
        withSequence(
          withTiming(-0.7, { duration: 110 }),
          withTiming(0.9, { duration: 100 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(jx);
      cancelAnimation(jy);
      jx.value = withTiming(0, { duration: 160 });
      jy.value = withTiming(0, { duration: 160 });
    }
  }, [phase, jx, jy]);

  useEffect(() => {
    if (phase === 'crystallizing') {
      const dx = targetX - chaosLeft;
      const dy = targetY - chaosTop;
      tx.value = withSpring(dx, { damping: 17, stiffness: 210, mass: 0.85 });
      ty.value = withSpring(dy, { damping: 17, stiffness: 210, mass: 0.85 });
    } else if (phase === 'chaos') {
      tx.value = 0;
      ty.value = 0;
    }
  }, [phase, targetX, targetY, chaosLeft, chaosTop, tx, ty]);

  const line = (item.title || item.description || '…').trim();
  const preview = line.length > 56 ? `${line.slice(0, 54)}…` : line;

  const anim = useAnimatedStyle(() => {
    const amp = 6 + 14 * intensitySV.value;
    return {
      transform: [
        { translateX: tx.value + jx.value * amp },
        { translateY: ty.value + jy.value * amp },
        { rotate: rotateDeg },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          left: chaosLeft,
          top: chaosTop,
        },
        anim,
      ]}
    >
      <Text style={styles.bubbleText} numberOfLines={3}>
        {preview}
      </Text>
    </Animated.View>
  );
}

export function MeliMeloScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<BottomTabNavigationProp<AppTabParamList, 'MeliMelo'>>();
  const [items, setItems] = useState<IntentionRow[]>([]);
  const [frozenItems, setFrozenItems] = useState<IntentionRow[]>([]);
  const [phase, setPhase] = useState<Phase>('chaos');
  const [sortedPiles, setSortedPiles] = useState<SortedPile[]>([]);
  const [credits, setCredits] = useState(0);
  const intensitySV = useSharedValue(0);
  const gateOpenRef = useRef(true);

  const reload = useCallback(async () => {
    const [rows, status] = await Promise.all([
      listUnclusteredPendingIntentions(),
      getUserStatus(),
    ]);
    setItems(rows);
    setCredits(status.credits_projet_ia);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      gateOpenRef.current = true;
      setPhase('chaos');
      setSortedPiles([]);
      setFrozenItems([]);
    }, [reload]),
  );

  const bubbleRows =
    frozenItems.length > 0 ? frozenItems : items;

  const chaosMap = useMemo(() => {
    const m = new Map<string, { left: number; top: number; rotate: string }>();
    for (const it of bubbleRows) {
      m.set(it.id, chaosPosition(it.id));
    }
    return m;
  }, [bubbleRows]);

  const targetsById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    if (sortedPiles.length === 0) return m;
    const gCount = sortedPiles.length;
    const baseY = CHAOS_TOP + CHAOS_H + 36;
    sortedPiles.forEach((pile, gi) => {
      const colX = (SW / (gCount + 1)) * (gi + 1) - BUBBLE_W / 2;
      pile.noteIds.forEach((id, idx) => {
        m.set(id, { x: colX, y: baseY + idx * 58 });
      });
    });
    return m;
  }, [sortedPiles]);

  const handleSustainedShake = useCallback(() => {
    if (!gateOpenRef.current) return;

    if (items.length === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    if (credits <= 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      gateOpenRef.current = false;
      setTimeout(() => {
        gateOpenRef.current = true;
      }, 2200);
      Alert.alert(t('sorting.noCreditTitle'), t('sorting.noCreditBody'), [
        { text: t('sorting.noCreditCancel'), style: 'cancel' },
        {
          text: t('sorting.goZenGarden'),
          onPress: () => navigation.navigate('ZenGarden'),
        },
      ]);
      return;
    }

    if (!getGeminiApiKey()) {
      Alert.alert(t('sorting.noApiKeyTitle'), t('sorting.noApiKeyBody'));
      return;
    }

    gateOpenRef.current = false;
    setFrozenItems([...items]);
    setPhase('thinking');

    const notes = items.map((row) => ({
      id: row.id,
      text: [row.title, row.description, row.raw_transcript]
        .filter(Boolean)
        .join('\n')
        .trim(),
    }));

    void (async () => {
      try {
        const { groups } = await geminiMelimeloClusterNotes(notes, {
          uiLanguage: i18n.language || 'fr',
          orphanTitle: t('sorting.orphanGroup'),
        });

        const piles: SortedPile[] = groups.map((g) => ({
          ...g,
          clusterId: randomUUID(),
        }));

        setSortedPiles(piles);
        setPhase('crystallizing');

        await new Promise((r) => setTimeout(r, 920));

        await applyMelimeloGrouping(
          piles.map((p) => ({
            clusterId: p.clusterId,
            themeLabel: p.title,
            intentionIds: p.noteIds,
          })),
        );

        const st = await getUserStatus();
        await updateUserStatus({
          credits_projet_ia: Math.max(0, st.credits_projet_ia - 1),
        });

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhase('sorted');
        setCredits((c) => Math.max(0, c - 1));
        await reload();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(t('sorting.errorTitle'), msg);
        setPhase('chaos');
        setSortedPiles([]);
        setFrozenItems([]);
        gateOpenRef.current = true;
      }
    })();
  }, [items, credits, t, i18n.language, navigation, reload]);

  useMagicShake({
    enabled:
      Platform.OS !== 'web' &&
      (phase === 'chaos' || phase === 'thinking'),
    intensitySV,
    gateOpenRef,
    onSustainedShake: handleSustainedShake,
  });

  useEffect(() => {
    if (phase === 'thinking') {
      gateOpenRef.current = false;
    }
  }, [phase]);

  const onDismissSorted = useCallback(() => {
    setSortedPiles([]);
    setFrozenItems([]);
    setPhase('chaos');
    gateOpenRef.current = true;
    void reload();
  }, [reload]);

  return (
    <LinearGradient
      colors={['#e8ebe4', '#f2f0ea', '#f7f5f0']}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={[styles.root, { paddingTop: insets.top + 6 }]}
    >
      <View style={styles.titleRow}>
        <Sparkles size={22} color="#2d6f70" />
        <Text style={styles.title}>{t('sorting.screenTitle')}</Text>
      </View>

      <View style={[styles.chaosZone, { height: CHAOS_H }]}>
        {items.length === 0 && phase === 'chaos' ? (
          <Text style={styles.empty}>{t('sorting.empty')}</Text>
        ) : null}
        {bubbleRows.map((it) => {
          const c = chaosMap.get(it.id);
          if (!c) return null;
          const tgt = targetsById.get(it.id) ?? {
            x: c.left,
            y: c.top,
          };
          return (
            <MeliBubble
              key={it.id}
              item={it}
              chaosLeft={c.left}
              chaosTop={c.top}
              rotateDeg={c.rotate}
              intensitySV={intensitySV}
              phase={phase}
              targetX={tgt.x}
              targetY={tgt.y}
            />
          );
        })}
      </View>

      {phase === 'sorted' && sortedPiles.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pilesScroll}
        >
          {sortedPiles.map((pile) => {
            const Icon = ICON_MAP[pile.icon] ?? Leaf;
            return (
              <View key={pile.clusterId} style={styles.pileCol}>
                <View style={styles.pileHeader}>
                  <Icon size={16} color="#2e5f68" />
                  <Text style={styles.pileTitle} numberOfLines={2}>
                    {pile.title}
                  </Text>
                </View>
                <Text style={styles.pileMeta}>
                  {t('sorting.pileCount', { count: pile.noteIds.length })}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {phase === 'sorted' ? (
        <Pressable style={styles.dismissBtn} onPress={onDismissSorted}>
          <Text style={styles.dismissText}>{t('sorting.dismiss')}</Text>
        </Pressable>
      ) : null}

      <View style={styles.flexSpacer} />
      <Text style={styles.shakeHint}>
        {Platform.OS === 'web'
          ? t('sorting.webNoShake')
          : t('sorting.shakeInstruction')}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 12 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2e5f68',
  },
  chaosZone: {
    position: 'relative',
    marginHorizontal: 4,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.1)',
    overflow: 'hidden',
  },
  empty: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    fontSize: 14,
    color: 'rgba(46, 95, 104, 0.45)',
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_W,
    minHeight: BUBBLE_H,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 252, 248, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.18)',
    shadowColor: '#334',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  bubbleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2a4540',
    lineHeight: 15,
  },
  pilesScroll: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 12,
  },
  pileCol: {
    width: 120,
    marginRight: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.12)',
  },
  pileHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pileTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: '#2e5f68',
  },
  pileMeta: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(46, 95, 104, 0.5)',
  },
  dismissBtn: {
    alignSelf: 'center',
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 128, 128, 0.14)',
  },
  dismissText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f766e',
  },
  flexSpacer: { flex: 1, minHeight: 8 },
  shakeHint: {
    marginBottom: 18,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(46, 95, 104, 0.38)',
    letterSpacing: 0.3,
    paddingHorizontal: 20,
  },
});
