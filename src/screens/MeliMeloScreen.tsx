import { LinearGradient } from 'expo-linear-gradient';
import { Accelerometer } from 'expo-sensors';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Animated,
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  consumeTrankilV2IntentCredit,
  deleteTrankilV2IntentionById,
  getTrankilV2UserStats,
  incrementBehaviorScores,
  growthPointsForType,
  listTrankilV2OrganizedIntentions,
  listTrankilV2UnorganizedIntentions,
  markTrankilV2IntentionDone,
  updateTrankilV2IntentionClassification,
  updateTrankilV2IntentionOrganization,
  updateTrankilV2IntentionQuick,
  updateTrankilV2IntentionTemporal,
  type TrankilV2IntentionRow,
} from '../api/trankilV2Db';
import { LifeFlower } from '../components/LifeFlower';
import { STRINGS } from '../constants/Strings';
import { useSaturation } from '../context/SaturationContext';
import { askGeminiExpert } from '../services/GeminiExpert';
import { analyzeLocally } from '../services/Gatekeeper';
import { awardZenForAction } from '../services/ZenEngine';
import {
  formatYmdLocal,
  groupIntentionsByTimeHorizon,
  TIME_HORIZON_META,
  type TimeHorizonKey,
} from '../services/TimeSorter';

const TYPE_ICON: Record<string, string> = {
  TASK: '🔨',
  HABIT: '🔄',
  NOTE: '💡',
  AUDIO: '🎙️',
  PROJECT: '💡',
};

const FOCUS_CIRCLES = [
  { id: 'maison', emoji: '🏠', label: 'Maison' },
  { id: 'travail', emoji: '📈', label: 'Travail' },
  { id: 'sante', emoji: '🥗', label: 'Santé' },
  { id: 'projets', emoji: '💡', label: 'Projets' },
  { id: 'zen', emoji: '🧘', label: 'Zen' },
] as const;

const PASTELS = ['#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#ede9fe', '#ffe4e6'];
const SHAKE_THRESHOLD = 2.05;
const SHAKE_HIT_WINDOW_MS = 700;
const SHAKE_REQUIRED_HITS = 4;
const SHAKE_COOLDOWN_MS = 2400;

type ViewMode = 'vrac' | 'focus';

type SortClassification = {
  type: 'TASK' | 'HABIT' | 'PROJECT' | 'NOTE';
  category: string | null;
  title: string;
  isAmbiguous: boolean;
  isLocalProcessed: number;
};

function pastelFromCategory(category: string | null): string {
  const key = (category || 'default').toLowerCase();
  let n = 0;
  for (let i = 0; i < key.length; i += 1) n = (n + key.charCodeAt(i) * 13) % 997;
  return PASTELS[n % PASTELS.length];
}

function looksIncomplete(item: TrankilV2IntentionRow): boolean {
  const title = item.title?.trim() || '';
  const category = item.category_id?.trim() || '';
  return title.length < 4 || !category;
}

function categoryFromType(type: SortClassification['type']): string {
  if (type === 'HABIT') return STRINGS.TAG_KEYS.ZEN;
  if (type === 'TASK') return STRINGS.TAG_KEYS.TRAVAIL;
  if (type === 'PROJECT') return STRINGS.TAG_KEYS.PROJETS;
  return STRINGS.TAG_KEYS.A_TRIER;
}

function isClearlyClassified(item: TrankilV2IntentionRow): boolean {
  const hasCategory = Boolean(item.category_id?.trim());
  const actionableType = item.type === 'TASK' || item.type === 'HABIT' || item.type === 'PROJECT';
  return hasCategory && actionableType;
}

function safeJsonParse(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractGeminiClassification(item: TrankilV2IntentionRow): SortClassification | null {
  const meta = safeJsonParse(item.metadata_json);
  const rawType = String(
    meta.gemini_type ?? meta.type ?? meta.intent_type ?? meta.intentType ?? '',
  )
    .trim()
    .toUpperCase();
  const rawCategory = String(
    meta.gemini_category ?? meta.category ?? meta.suggested_category ?? '',
  )
    .trim()
    .toLowerCase();
  const rawTitle = String(meta.gemini_title ?? meta.title ?? '').trim();
  if (!rawType) return null;
  const type: SortClassification['type'] =
    rawType === 'PROJECT' ? 'PROJECT' : rawType === 'HABIT' ? 'HABIT' : rawType === 'TASK' ? 'TASK' : 'NOTE';
  const category = rawCategory || (type !== 'NOTE' ? categoryFromType(type) : null);
  return {
    type,
    category,
    title: rawTitle || item.title,
    isAmbiguous: type === 'NOTE' || !category,
    isLocalProcessed: item.is_local_processed,
  };
}

async function classifyWithLocalAi(item: TrankilV2IntentionRow): Promise<SortClassification> {
  const prompt = [item.title, item.content_raw].filter(Boolean).join('\n').trim();
  const local = await analyzeLocally(prompt, 'fr');
  const type: SortClassification['type'] =
    local.localType === 'HABIT' ? 'HABIT' : local.localType === 'TASK' ? 'TASK' : 'NOTE';
  const category = local.structured?.suggestedTags?.[0]?.trim() || (type !== 'NOTE' ? categoryFromType(type) : null);
  const isAmbiguous = local.isExpertNeeded || type === 'NOTE' || !category;
  return {
    type,
    category,
    title: item.title,
    isAmbiguous,
    isLocalProcessed: isAmbiguous ? item.is_local_processed : 1,
  };
}

function normalizeCategory(category: string | null): string {
  return (category || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matchesCircle(item: TrankilV2IntentionRow, circleId: string): boolean {
  const c = normalizeCategory(item.category_id);
  if (!c) return circleId === 'projets';
  if (circleId === 'maison') return /maison|home|famille/.test(c);
  if (circleId === 'travail') return /travail|work|pro/.test(c);
  if (circleId === 'sante') return /sante|health|sport|forme/.test(c);
  if (circleId === 'zen') return /zen|calme|mind|serenite/.test(c);
  return true;
}

export function MeliMeloScreen() {
  const { isSaturated, runWithWeight } = useSaturation();
  const [saturationToast, setSaturationToast] = useState('');
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<TrankilV2IntentionRow[]>([]);
  const [organizedItems, setOrganizedItems] = useState<TrankilV2IntentionRow[]>([]);
  const [editing, setEditing] = useState<TrankilV2IntentionRow | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [remainingCredits, setRemainingCredits] = useState(0);
  const [showShakeConfirm, setShowShakeConfirm] = useState(false);
  const [isSorting, setIsSorting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('vrac');
  const [selectedCircle, setSelectedCircle] = useState<(typeof FOCUS_CIRCLES)[number]['id']>('maison');
  const [growthScore, setGrowthScore] = useState(0);
  const [flowerPulseKey, setFlowerPulseKey] = useState(0);
  const [morningFocusId, setMorningFocusId] = useState<string | null>(null);
  const [hybridToast, setHybridToast] = useState('');
  const [activeVracItem, setActiveVracItem] = useState<TrankilV2IntentionRow | null>(null);

  const flyAnim = useRef(new Animated.Value(0)).current;
  const shakeHitsRef = useRef<number[]>([]);
  const lastShakeAtRef = useRef(0);
  const autoSortRunningRef = useRef(false);

  useEffect(() => {
    if (UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const reload = useCallback(async () => {
    const [rows, organized, stats] = await Promise.all([
      listTrankilV2UnorganizedIntentions(),
      listTrankilV2OrganizedIntentions(),
      getTrankilV2UserStats(),
    ]);
    setItems(rows);
    setOrganizedItems(organized);
    setRemainingCredits(stats.ia_credits);
    setGrowthScore(stats.zen_points);
    setMorningFocusId(stats.morning_focus_item_id ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    Accelerometer.setUpdateInterval(110);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      if (isSorting || showShakeConfirm || items.length === 0 || viewMode !== 'vrac') return;
      const mag = Math.hypot(x, y, z);
      const norm = Math.abs(mag - 1);
      const now = Date.now();
      if (norm > SHAKE_THRESHOLD) {
        shakeHitsRef.current.push(now);
        shakeHitsRef.current = shakeHitsRef.current.filter((ts) => now - ts < SHAKE_HIT_WINDOW_MS);
        const cooledDown = now - lastShakeAtRef.current > SHAKE_COOLDOWN_MS;
        if (cooledDown && shakeHitsRef.current.length >= SHAKE_REQUIRED_HITS) {
          shakeHitsRef.current = [];
          lastShakeAtRef.current = now;
          setShowShakeConfirm(true);
        }
      }
    });
    return () => sub.remove();
  }, [isSorting, showShakeConfirm, items.length, viewMode]);

  const mentalLoad = useMemo(() => {
    if (items.length === 0) return STRINGS.GARDEN_RITUALS.ALL_CLEAR;
    if (items.length > 5) return STRINGS.GARDEN_RITUALS.SWARM_WARNING;
    return `${STRINGS.GARDEN_RITUALS.IN_PROGRESS}: ${items.length} brouillon(s).`;
  }, [items.length]);

  const onDelete = useCallback(
    (id: string) => {
      Alert.alert(STRINGS.GARDEN_RITUALS.DELETE_DRAFT_TITLE, STRINGS.GARDEN_RITUALS.DELETE_DRAFT_BODY, [
        { text: STRINGS.COMMON.CANCEL, style: 'cancel' },
        {
          text: STRINGS.COMMON.DELETE,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteTrankilV2IntentionById(id);
              await reload();
            })();
          },
        },
      ]);
    },
    [reload],
  );

  const openEdit = useCallback((item: TrankilV2IntentionRow) => {
    setEditing(item);
    setEditTitle(item.title);
    setEditCategory(item.category_id ?? '');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const nextTitle = editTitle.trim() || editing.title;
    const nextCategory = editCategory.trim() || null;
    if (nextCategory) {
      await updateTrankilV2IntentionClassification(editing.id, {
        title: nextTitle,
        category_id: nextCategory,
        is_organized: 1,
      });
      setHybridToast(t('sorting.classifiedIn', { category: nextCategory }));
      setTimeout(() => setHybridToast(''), 1600);
    } else {
      await updateTrankilV2IntentionQuick(editing.id, {
        title: nextTitle,
        category_id: null,
      });
      setHybridToast(t('sorting.addedToPile'));
      setTimeout(() => setHybridToast(''), 1600);
    }
    setEditing(null);
    await reload();
  }, [editing, editTitle, editCategory, reload]);

  const runAiSortForItem = useCallback(
    async (item: TrankilV2IntentionRow) => {
      if (remainingCredits <= 0) {
        Alert.alert(
          STRINGS.GARDEN_RITUALS.INSUFFICIENT_CREDITS,
          STRINGS.GARDEN_RITUALS.INSUFFICIENT_CREDITS_BODY,
        );
        return;
      }
      const prompt = [item.title, item.content_raw].filter(Boolean).join('\n').trim();
      const expert = await askGeminiExpert(prompt || item.title || 'Intention à clarifier');
      const first = expert.find((row) => row.type === 'PROJECT' || row.type === 'TASK' || row.type === 'HABIT');
      if (!first) {
        setHybridToast(t('sorting.addedToPile'));
        setTimeout(() => setHybridToast(''), 1600);
        return;
      }
      await consumeTrankilV2IntentCredit();
      setRemainingCredits((c) => Math.max(0, c - 1));
      const category = first.suggested_category?.trim().toLowerCase() || categoryFromType(first.type);
      await updateTrankilV2IntentionClassification(item.id, {
        type: first.type,
        title: first.title?.trim() || item.title,
        category_id: category,
        is_organized: 1,
      });
      setHybridToast(t('sorting.classifiedIn', { category }));
      setTimeout(() => setHybridToast(''), 1600);
      await reload();
    },
    [remainingCredits, reload, t],
  );

  useEffect(() => {
    if (items.length === 0 || autoSortRunningRef.current || isSorting) return;
    autoSortRunningRef.current = true;
    void (async () => {
      try {
        let sortedCount = 0;
        let ambiguousCount = 0;
        for (const item of items) {
          if (item.is_organized === 1) continue;
          if (isClearlyClassified(item)) {
            await updateTrankilV2IntentionClassification(item.id, {
              is_organized: 1,
              category_id: item.category_id?.trim().toLowerCase() || null,
            });
            sortedCount += 1;
            setHybridToast(
              t('sorting.classifiedIn', {
                category: item.category_id?.trim() || STRINGS.TAG_KEYS.PROJETS,
              }),
            );
            continue;
          }
          const geminiMeta = extractGeminiClassification(item);
          if (geminiMeta && !geminiMeta.isAmbiguous) {
            await updateTrankilV2IntentionClassification(item.id, {
              type: geminiMeta.type,
              title: geminiMeta.title,
              category_id: geminiMeta.category,
              is_organized: 1,
              is_local_processed: geminiMeta.isLocalProcessed,
            });
            sortedCount += 1;
            setHybridToast(t('sorting.classifiedIn', { category: geminiMeta.category }));
            continue;
          }
          const localClass = await classifyWithLocalAi(item);
          if (!localClass.isAmbiguous) {
            await updateTrankilV2IntentionClassification(item.id, {
              type: localClass.type,
              category_id: localClass.category,
              title: localClass.title,
              is_organized: 1,
              is_local_processed: localClass.isLocalProcessed,
            });
            sortedCount += 1;
            setHybridToast(t('sorting.classifiedIn', { category: localClass.category }));
            continue;
          }
          ambiguousCount += 1;
        }
        if (sortedCount > 0 || ambiguousCount > 0) {
          if (ambiguousCount > 0) {
            setHybridToast(t('sorting.addedToPile'));
          }
          setTimeout(() => setHybridToast(''), 1600);
          await reload();
        }
      } finally {
        autoSortRunningRef.current = false;
      }
    })();
  }, [isSorting, items, reload, t]);

  const runMagicSort = useCallback(async () => {
    if (items.length === 0) return;
    if (remainingCredits <= 0) {
      Alert.alert(
        STRINGS.GARDEN_RITUALS.INSUFFICIENT_CREDITS,
        STRINGS.GARDEN_RITUALS.INSUFFICIENT_CREDITS_BODY,
      );
      return;
    }

    setIsSorting(true);
    Animated.timing(flyAnim, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();

    try {
      await consumeTrankilV2IntentCredit();
      await incrementBehaviorScores({ utilityDelta: 1 });
      setRemainingCredits((c) => Math.max(0, c - 1));

      for (const item of items) {
        if (!looksIncomplete(item) && isClearlyClassified(item)) {
          await updateTrankilV2IntentionOrganization(item.id, {
            is_organized: 1,
            category_id: item.category_id?.trim().toLowerCase() || item.category_id,
          });
          continue;
        }

        const prompt = [item.title, item.content_raw].filter(Boolean).join('\n').trim();
        const expert = await askGeminiExpert(prompt || t('sorting.intentToClarify'));
        const first = expert[0];

        if (!first) {
          continue;
        }
        const nextCategory =
          first.suggested_category?.trim().toLowerCase() || item.category_id || categoryFromType(first.type);
        await updateTrankilV2IntentionClassification(item.id, {
          type: first.type,
          is_organized: 1,
          title: first.title?.trim() || item.title,
          category_id: nextCategory,
        });
        setHybridToast(t('sorting.classifiedIn', { category: nextCategory }));
      }

      await reload();
      setViewMode('focus');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(STRINGS.GARDEN_RITUALS.MAGIC_SHAKE_ERROR, msg);
    } finally {
      flyAnim.setValue(0);
      setIsSorting(false);
    }
  }, [items, remainingCredits, flyAnim, reload, t]);

  const focusItems = useMemo(
    () => organizedItems.filter((it) => matchesCircle(it, selectedCircle)),
    [organizedItems, selectedCircle],
  );

  const horizonCandidates = useMemo(
    () =>
      [...items, ...organizedItems].filter(
        (it) =>
          it.status !== 'DONE' &&
          (it.type === 'TASK' || it.type === 'HABIT' || it.type === 'PROJECT'),
      ),
    [items, organizedItems],
  );

  const parentTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of [...items, ...organizedItems]) {
      if (row.type === 'PROJECT') {
        map.set(row.id, row.title);
      }
    }
    return map;
  }, [items, organizedItems]);

  const horizons = useMemo(
    () => groupIntentionsByTimeHorizon(horizonCandidates),
    [horizonCandidates],
  );

  const actionItems = focusItems.filter((it) => it.type === 'TASK' || it.type === 'PROJECT');
  const ritualItems = focusItems.filter((it) => it.type === 'HABIT');
  const noteItems = focusItems.filter((it) => it.type === 'NOTE');
  const audioItems = focusItems.filter((it) => it.type === 'AUDIO');

  const completeItem = useCallback(
    async (item: TrankilV2IntentionRow) => {
      if (item.status === 'DONE') return;
      await markTrankilV2IntentionDone(item.id);
      if (growthPointsForType(item.type) > 0) {
        const next =
          item.type === 'PROJECT'
            ? (await awardZenForAction('PROJECT_VALIDATION')).stats
            : (await awardZenForAction('TASK_VALIDATION')).stats;
        setGrowthScore(next.zen_points);
        setFlowerPulseKey((k) => k + 1);
      }
      await reload();
    },
    [reload],
  );

  const quickRebalance = useCallback(
    async (item: TrankilV2IntentionRow, target: 'TODAY' | 'NO_PRESSURE') => {
      const dueDate = target === 'TODAY' ? formatYmdLocal(new Date()) : null;
      const category = target === 'TODAY' ? item.category_id : 'sans_pression';
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const meta = safeJsonParse(item.metadata_json);
      const nextMeta = JSON.stringify(
        {
          ...meta,
          has_alarm: Boolean(dueDate),
          due_date: dueDate,
          rebalance_from: 'rearbitrate',
        },
        null,
        2,
      );
      await updateTrankilV2IntentionTemporal(item.id, {
        due_date: dueDate,
        category_id: category,
        metadata_json: nextMeta,
      });
      await reload();
    },
    [reload],
  );

  const animatedCardStyle = {
    transform: [
      {
        translateY: flyAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -90] }),
      },
    ],
    opacity: flyAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  } as const;

  return (
    <LinearGradient
      colors={['#e8ebe4', '#f2f0ea', '#f7f5f0']}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={[styles.root, { paddingTop: insets.top + 8 }]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('sorting.screenTitle')} · {t('sorting.organization')}</Text>
        <Text style={styles.creditBadge}>{t('economy.aiCreditsCount', { count: remainingCredits })}</Text>
      </View>

      <View style={styles.modeRow}>
        <Pressable style={[styles.modeBtn, viewMode === 'vrac' ? styles.modeBtnActive : null]} onPress={() => setViewMode('vrac')}>
          <Text style={[styles.modeBtnText, viewMode === 'vrac' ? styles.modeBtnTextActive : null]}>
            {STRINGS.GARDEN_RITUALS.VRAC}
          </Text>
        </Pressable>
        <Pressable style={[styles.modeBtn, viewMode === 'focus' ? styles.modeBtnActive : null]} onPress={() => setViewMode('focus')}>
          <Text style={[styles.modeBtnText, viewMode === 'focus' ? styles.modeBtnTextActive : null]}>
            {STRINGS.GARDEN_RITUALS.FOCUS_CIRCLES}
          </Text>
        </Pressable>
      </View>

      {viewMode === 'vrac' ? (
        <>
          <Text style={styles.mentalLoad}>{mentalLoad}</Text>
          <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}> 
            {(Object.keys(TIME_HORIZON_META) as TimeHorizonKey[]).map((hKey) => {
              const rows = horizons[hKey];
              if (!rows.length) return null;
              const horizonLabel = TIME_HORIZON_META[hKey];
              return (
                <View key={hKey} style={styles.horizonSection}>
                  <Text style={styles.horizonTitle}>
                    {horizonLabel.emoji} {t(horizonLabel.labelKey)}
                  </Text>
                  {rows.map((item) => {
                    const bg = pastelFromCategory(item.category_id);
                    const icon = TYPE_ICON[item.type] ?? '📌';
                    const parentProject = item.parent_id ? parentTitleById.get(item.parent_id) : null;
                    return (
                      <Swipeable
                        key={item.id}
                        enabled={!isSorting}
                        renderRightActions={() => (
                          <Pressable style={styles.deleteAction} onPress={() => onDelete(item.id)}>
                            <Text style={styles.deleteActionText}>{STRINGS.COMMON.DELETE}</Text>
                          </Pressable>
                        )}
                      >
                        <Animated.View style={animatedCardStyle}>
                          <Pressable
                            style={[styles.card, { backgroundColor: bg }]}
                            onPress={() => setActiveVracItem(item)}
                            disabled={isSorting}
                          >
                            <View style={styles.titleWithEco}>
                              <Text style={styles.cardTitle}>{icon} {item.title}</Text>
                              {item.is_local_processed === 1 ? (
                                <Text style={styles.ecoBadge}>🍃 {STRINGS.LOCAL_ECO_LABEL}</Text>
                              ) : null}
                            </View>
                            {parentProject ? (
                              <Text style={styles.parentProjectBadge}>🏗️ {parentProject}</Text>
                            ) : null}
                            <Text style={styles.cardMeta}>{item.type} · {item.category_id || 'sans-categorie'}</Text>
                            <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleString()}</Text>
                            {hKey === 'REARBITRATE' ? (
                              <View style={styles.rearbRow}>
                                <Pressable
                                  style={styles.rearbBtn}
                                  onPress={() => {
                                    void quickRebalance(item, 'TODAY');
                                  }}
                                >
                                  <Text style={styles.rearbBtnText}>{t('horizons.rebalanceToToday')}</Text>
                                </Pressable>
                                <Pressable
                                  style={styles.rearbBtn}
                                  onPress={() => {
                                    void quickRebalance(item, 'NO_PRESSURE');
                                  }}
                                >
                                  <Text style={styles.rearbBtnText}>{t('horizons.rebalanceToNoPressure')}</Text>
                                </Pressable>
                              </View>
                            ) : null}
                          </Pressable>
                        </Animated.View>
                      </Swipeable>
                    );
                  })}
                </View>
              );
            })}
            {horizonCandidates.length === 0 ? (
              <Text style={styles.empty}>{STRINGS.GARDEN_RITUALS.EMPTY_DRAFTS}</Text>
            ) : null}
          </ScrollView>
        </>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circlesRow}>
            {FOCUS_CIRCLES.map((circle) => {
              const selected = selectedCircle === circle.id;
              return (
                <Pressable
                  key={circle.id}
                  style={[styles.circle, selected ? styles.circleSelected : null]}
                  onPress={() =>
                    runWithWeight(() => {
                      if (isSaturated) {
                        setSaturationToast(STRINGS.saturation.overloadedToast);
                        setTimeout(() => setSaturationToast(''), 1500);
                        return;
                      }
                      setSelectedCircle(circle.id);
                    })
                  }
                >
                  <Text style={styles.circleEmoji}>{circle.emoji}</Text>
                  <Text style={styles.circleLabel}>{circle.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.lifeCard}>
            <View style={styles.lifeHeader}>
              <Text style={styles.lifeTitle}>
                {STRINGS.GARDEN_RITUALS.LIFE_CARD} · {FOCUS_CIRCLES.find((c) => c.id === selectedCircle)?.label}
              </Text>
              <LifeFlower growthStage={growthScore} pulseKey={flowerPulseKey} size={82} />
            </View>

            {focusItems.length === 0 ? (
              <Text style={styles.poeticEmpty}>{STRINGS.GARDEN_RITUALS.CALM_EMPTY}</Text>
            ) : (
              <ScrollView style={styles.lifeScroll}>
                {actionItems.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionTitle}>🔨 {STRINGS.GARDEN_RITUALS.ACTIONS}</Text>
                    {actionItems.map((item) => (
                      <Pressable key={item.id} style={[styles.rowItem, item.id === morningFocusId ? styles.focusGlow : null]} onPress={() => void completeItem(item)}>
                        <Text style={styles.checkbox}>{item.status === 'DONE' ? '☑️' : '⬜️'}</Text>
                        <Text style={[styles.rowText, item.status === 'DONE' ? styles.doneText : null]}>
                          {item.title}
                        </Text>
                        {item.is_local_processed === 1 ? <Text style={styles.ecoMini}>🍃</Text> : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {ritualItems.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionTitle}>🔄 {STRINGS.GARDEN_RITUALS.RITUALS}</Text>
                    {ritualItems.map((item) => (
                      <Pressable key={item.id} style={[styles.rowItem, item.id === morningFocusId ? styles.focusGlow : null]} onPress={() => void completeItem(item)}>
                        <Text style={styles.checkbox}>{item.status === 'DONE' ? '☑️' : '⬜️'}</Text>
                        <View style={styles.ritualCol}>
                          <Text style={[styles.rowText, item.status === 'DONE' ? styles.doneText : null]}>{item.title}</Text>
                          {item.is_local_processed === 1 ? <Text style={styles.ecoMini}>🍃</Text> : null}
                          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${growthScore}%` }]} /></View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {noteItems.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionTitle}>💡 {STRINGS.GARDEN_RITUALS.REFLECTIONS}</Text>
                    {noteItems.map((item) => (
                      <View key={item.id} style={styles.noteBox}>
                        <Text style={styles.noteText}>{item.title}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {audioItems.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionTitle}>🎙️ {STRINGS.GARDEN_RITUALS.AUDIOS}</Text>
                    {audioItems.map((item) => (
                      <View key={item.id} style={styles.audioMini}>
                        <Text style={styles.audioPlay}>▶︎</Text>
                        <Text style={styles.audioText}>{item.title || STRINGS.GARDEN_RITUALS.RAW_AUDIO}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </>
      )}

      <Modal visible={showShakeConfirm} transparent animationType="fade" onRequestClose={() => setShowShakeConfirm(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {STRINGS.GARDEN_RITUALS.SHAKE_CONFIRM_TITLE} {items.length} elements ? ({STRINGS.GARDEN_RITUALS.SHAKE_CONFIRM_COST})
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setShowShakeConfirm(false)}>
                <Text style={styles.modalCancelText}>{STRINGS.COMMON.CANCEL}</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalSave]} onPress={() => { setShowShakeConfirm(false); void runMagicSort(); }}>
                <Text style={styles.modalSaveText}>
                  {isSorting ? STRINGS.GARDEN_RITUALS.SHAKE_SORTING : STRINGS.GARDEN_RITUALS.SHAKE_SORT}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(editing)} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{STRINGS.GARDEN_RITUALS.QUICK_EDIT}</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder={STRINGS.GARDEN_RITUALS.TITLE_PLACEHOLDER}
              style={styles.input}
            />
            <TextInput
              value={editCategory}
              onChangeText={setEditCategory}
              placeholder={STRINGS.GARDEN_RITUALS.CATEGORY_PLACEHOLDER}
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setEditing(null)}>
                <Text style={styles.modalCancelText}>{STRINGS.COMMON.CANCEL}</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalSave]} onPress={() => void saveEdit()}>
                <Text style={styles.modalSaveText}>{STRINGS.COMMON.SAVE}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={Boolean(activeVracItem)}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveVracItem(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('sorting.actionTitle')}</Text>
            <Text style={styles.cardMeta}>
              {activeVracItem?.title || ''}
            </Text>
            <View style={styles.modalActionsColumn}>
              <Pressable
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => {
                  if (!activeVracItem) return;
                  openEdit(activeVracItem);
                  setActiveVracItem(null);
                }}
              >
                <Text style={styles.modalCancelText}>{t('sorting.manualSortFree')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalSave]}
                onPress={() => {
                  if (!activeVracItem) return;
                  const target = activeVracItem;
                  setActiveVracItem(null);
                  void runAiSortForItem(target);
                }}
              >
                <Text style={styles.modalSaveText}>{t('sorting.aiSortPaid')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {hybridToast ? <Text style={styles.hybridToast}>{hybridToast}</Text> : null}
      {saturationToast ? <Text style={styles.saturationToast}>{saturationToast}</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 12 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#2e5f68' },
  creditBadge: {
    fontSize: 11,
    color: '#2e5f68',
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  modeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, marginBottom: 10 },
  modeBtn: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.65)' },
  modeBtnActive: { backgroundColor: '#dbeafe', borderWidth: 1, borderColor: 'rgba(45,111,112,0.35)' },
  modeBtnText: { color: '#4b5563', fontWeight: '700', fontSize: 12 },
  modeBtnTextActive: { color: '#155e75' },
  mentalLoad: { marginHorizontal: 12, marginBottom: 10, fontSize: 13, color: '#51635f', fontWeight: '600' },
  list: { gap: 10, paddingHorizontal: 4 },
  horizonSection: {
    marginBottom: 10,
  },
  horizonTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#20525d',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(31,41,55,0.12)',
    marginBottom: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#24333a' },
  cardMeta: { marginTop: 4, fontSize: 12, color: '#4b5563' },
  cardDate: { marginTop: 2, fontSize: 11, color: '#6b7280' },
  parentProjectBadge: {
    alignSelf: 'flex-start',
    marginTop: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    color: '#24535e',
    fontWeight: '700',
    backgroundColor: 'rgba(36,83,94,0.12)',
  },
  rearbRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  rearbBtn: {
    flex: 1,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(36,83,94,0.28)',
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  rearbBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1f3f47',
    textAlign: 'center',
  },
  titleWithEco: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ecoBadge: {
    fontSize: 10,
    color: '#166534',
    fontWeight: '700',
    backgroundColor: 'rgba(187,247,208,0.62)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  empty: { fontSize: 14, color: 'rgba(46, 95, 104, 0.45)', fontWeight: '600', textAlign: 'center', marginTop: 20 },
  deleteAction: {
    width: 96,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 12,
    marginVertical: 2,
  },
  deleteActionText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  circlesRow: { paddingHorizontal: 8, gap: 10, paddingBottom: 10 },
  circle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(107,114,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSelected: {
    transform: [{ scale: 1.05 }],
    borderColor: '#008080',
    borderWidth: 2,
  },
  circleEmoji: { fontSize: 22 },
  circleLabel: { marginTop: 4, fontSize: 11, fontWeight: '700', color: '#334155' },
  lifeCard: {
    flex: 1,
    borderRadius: 20,
    marginHorizontal: 8,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  lifeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lifeTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#2f4f5a', marginRight: 8 },
  poeticEmpty: { marginTop: 16, textAlign: 'center', color: '#5b6b67', fontSize: 13, fontStyle: 'italic' },
  lifeScroll: { marginTop: 8 },
  sectionBlock: { marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#2e5f68', marginBottom: 6 },
  rowItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  focusGlow: {
    backgroundColor: 'rgba(253,224,71,0.18)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  checkbox: { fontSize: 17, marginRight: 8 },
  rowText: { flex: 1, color: '#24333a', fontSize: 13, fontWeight: '600' },
  ecoMini: { marginLeft: 6, fontSize: 12, color: '#166534' },
  doneText: { textDecorationLine: 'line-through', color: '#94a3b8' },
  ritualCol: { flex: 1 },
  progressTrack: { marginTop: 4, height: 7, borderRadius: 4, backgroundColor: '#dbe7e2', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#34d399' },
  noteBox: { borderRadius: 10, backgroundColor: 'rgba(250,250,250,0.7)', padding: 10, marginBottom: 6 },
  noteText: { color: '#334155', fontSize: 13, lineHeight: 18 },
  audioMini: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 10, backgroundColor: 'rgba(250,250,250,0.75)', marginBottom: 6 },
  audioPlay: { fontSize: 16, marginRight: 8, color: '#0f766e' },
  audioText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1f2937', marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  modalActionsColumn: { gap: 8 },
  modalBtn: { borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  modalCancel: { backgroundColor: '#e5e7eb' },
  modalSave: { backgroundColor: '#008080' },
  modalCancelText: { color: '#111827', fontWeight: '700' },
  modalSaveText: { color: '#fff', fontWeight: '700' },
  hybridToast: {
    position: 'absolute',
    bottom: 52,
    alignSelf: 'center',
    backgroundColor: 'rgba(11,76,99,0.86)',
    color: '#f0fdff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: '90%',
    textAlign: 'center',
  },
  saturationToast: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(15,23,42,0.78)',
    color: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: '90%',
    textAlign: 'center',
  },
});
