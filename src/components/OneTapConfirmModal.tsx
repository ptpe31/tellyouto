import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Checkbox, Menu, Button as PaperButton } from 'react-native-paper';
import { Bell, CalendarCheck, ChevronDown, ChevronRight, MapPin, Repeat, ShoppingCart, StickyNote } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { TimelineDatePickerLazy } from './TimelineDatePickerLazy';
import { GooglePlacesAutocompleteField } from './traffic/GooglePlacesAutocompleteField';
import { fetchLatestOneTapLogisticsMemory } from '../api/trankilV2Db';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import type { OneTapPredictedType, OneTapUniversalResult } from '../services/oneTapUniversalCapture';
import {
  ONE_TAP_PREDICTED_TYPES,
  logOneTapLogisticsRecognized,
  mergeOneTapDataOnTypeChange,
} from '../services/oneTapUniversalCapture';
import { printOneTapListDraft } from '../services/oneTapListPdf';
import { listItemDisplayQuantity } from '../utils/listQuantityDisplay';
import { ensureSentinelQuotaInitialized, getSentinelQuotaSnapshotLocalOnly } from '../services/QuotaManager';

export type OneTapConfirmModalProps = {
  visible: boolean;
  draft: OneTapUniversalResult | null;
  transcript: string;
  /** Affinage Gemini en arrière-plan (dual-path). */
  refinePhase?: 'idle' | 'local' | 'streaming' | 'done' | 'error';
  variant?: 'minimal' | 'debug';
  busy: boolean;
  onUserEdited?: () => void;
  onChangeDraft: (next: OneTapUniversalResult) => void;
  onChangeTranscript: (text: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

function StreamingIndicator() {
  const dot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(dot, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [dot]);
  const d1 = dot.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const d2 = dot.interpolate({ inputRange: [0, 0.33, 1], outputRange: [0.2, 1, 0.2] });
  const d3 = dot.interpolate({ inputRange: [0, 0.66, 1], outputRange: [0.2, 1, 0.2] });
  return (
    <View style={styles.streamingRow}>
      <Animated.Text style={[styles.streamingDot, { opacity: d1 }]}>•</Animated.Text>
      <Animated.Text style={[styles.streamingDot, { opacity: d2 }]}>•</Animated.Text>
      <Animated.Text style={[styles.streamingDot, { opacity: d3 }]}>•</Animated.Text>
    </View>
  );
}

function readDraftIntents(draft: OneTapUniversalResult): Record<string, unknown>[] {
  const data = draft.data as Record<string, unknown>;
  const raw = data.intents;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
}

function normalizeIncomingIntents(intents: Record<string, unknown>[]): Record<string, unknown>[] {
  const normalized = intents.map((it) => {
    const type = String(it.type ?? '').trim().toUpperCase();
    if (type !== 'LIST') return it;
    const baseCount = Math.max(1, Math.round(Number(it.baseCount ?? 1)));
    const itemsRaw = it.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    const nextItems = items.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
      const r = raw as Record<string, unknown>;
      if (r.baseQuantity !== undefined) return raw;
      const qty = Number(r.qty);
      if (!Number.isFinite(qty)) return raw;
      return { ...r, baseQuantity: qty / baseCount, includeInSave: r.includeInSave !== false };
    });
    return { ...it, baseCount, items: nextItems };
  });
  const priority = (it: Record<string, unknown>): number => {
    const t = String(it.type ?? '').trim().toUpperCase();
    if (t === 'TRIP') return 0;
    if (t === 'LIST') return 1;
    if (t === 'TASK' || t === 'RECURRING_TASK') return 2;
    if (t === 'HABIT') return 3;
    if (t === 'ANNIVERSARY') return 4;
    if (t === 'NOTE') return 5;
    return 9;
  };
  return normalized
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => priority(a.it) - priority(b.it) || a.idx - b.idx)
    .map((x) => x.it);
}

function normalizeIncomingIntentsPreserveOrder(intents: Record<string, unknown>[]): Record<string, unknown>[] {
  return intents.map((it) => {
    const type = String(it.type ?? '').trim().toUpperCase();
    if (type !== 'LIST') return it;
    const baseCount = Math.max(1, Math.round(Number(it.baseCount ?? 1)));
    const itemsRaw = it.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    const nextItems = items.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
      const r = raw as Record<string, unknown>;
      if (r.baseQuantity !== undefined) return raw;
      const qty = Number(r.qty);
      if (!Number.isFinite(qty)) return raw;
      return { ...r, baseQuantity: qty / baseCount, includeInSave: r.includeInSave !== false };
    });
    return { ...it, baseCount, items: nextItems };
  });
}

function intentLabel(it: Record<string, unknown> | null, predictedType: OneTapPredictedType): string {
  const type = String(it?.type ?? predictedType ?? '').trim().toUpperCase();
  if (type === 'LIST') {
    const t = String(it?.title ?? it?.content ?? '').trim();
    return `${t || 'Liste'}…`;
  }
  if (type === 'TASK') return 'Tâche…';
  if (type === 'HABIT') return 'Habitude…';
  if (type === 'TRIP') return 'Trajet…';
  if (type === 'NOTE') return 'Note…';
  return 'Analyse…';
}

function intentShortTitle(it: Record<string, unknown> | null, predictedType: OneTapPredictedType): string {
  const type = String(it?.type ?? predictedType ?? '').trim().toUpperCase();
  if (type === 'LIST') return String(it?.title ?? it?.content ?? '').trim() || 'Liste';
  if (type === 'TASK') return String(it?.content ?? it?.title ?? '').trim() || 'Tâche';
  if (type === 'HABIT') return String(it?.content ?? it?.title ?? '').trim() || 'Habitude';
  if (type === 'TRIP') return String(it?.destination ?? it?.content ?? it?.title ?? '').trim() || 'Trajet';
  const s = String(it?.content ?? it?.memo ?? it?.title ?? '').trim();
  return s || 'Note';
}

function intentEmoji(it: Record<string, unknown> | null, predictedType: OneTapPredictedType): string {
  const type = String(it?.type ?? predictedType ?? '').trim().toUpperCase();
  if (type === 'TRIP') return '🚗';
  if (type === 'LIST') return '🛒';
  if (type === 'TASK' || type === 'RECURRING_TASK') return '✅';
  if (type === 'HABIT') return '🔁';
  return '📝';
}

function IntentIcon({ type }: { type: string }) {
  const t = String(type || '').trim().toUpperCase();
  const color = '#0f172a';
  const size = 18;
  if (t === 'TRIP') return <MapPin size={size} color={color} />;
  if (t === 'LIST') return <ShoppingCart size={size} color={color} />;
  if (t === 'HABIT') return <Repeat size={size} color={color} />;
  if (t === 'TASK' || t === 'RECURRING_TASK') return <CalendarCheck size={size} color={color} />;
  return <StickyNote size={size} color={color} />;
}

function hasStreamedIntents(draft: OneTapUniversalResult): boolean {
  return readDraftIntents(draft).length > 0;
}

function deriveFallbackIntentFromDraft(draft: OneTapUniversalResult): Record<string, unknown>[] {
  const data = draft.data as Record<string, unknown>;
  const rawList = data.list;
  if (rawList && typeof rawList === 'object' && !Array.isArray(rawList)) {
    const list = rawList as Record<string, unknown>;
    const title = String(list.title ?? draft.title ?? 'Liste');
    const baseCount = Number(list.baseCount ?? 1);
    const unitLabel = String(list.unitLabel ?? 'personne');
    const cats = Array.isArray(list.categories) ? (list.categories as unknown[]) : [];
    const firstCat = (cats[0] as Record<string, unknown>) ?? {};
    const items = Array.isArray(firstCat.items) ? firstCat.items : [];
    return [
      {
        type: 'LIST',
        title,
        baseCount: Number.isFinite(baseCount) && baseCount > 0 ? baseCount : 1,
        unitLabel,
        items,
      },
    ];
  }
  const type = String(draft.predictedType || '').trim().toUpperCase();
  if (!type) return [];
  if (type === 'LIST') {
    const list = (data.list as Record<string, unknown> | null) ?? null;
    const title = String(list?.title ?? draft.title ?? 'Liste');
    const baseCount = Number(list?.baseCount ?? 1);
    const unitLabel = String(list?.unitLabel ?? 'personne');
    const cats = Array.isArray(list?.categories) ? (list?.categories as unknown[]) : [];
    const firstCat = (cats[0] as Record<string, unknown>) ?? {};
    const items = Array.isArray(firstCat.items) ? firstCat.items : [];
    return [
      {
        type: 'LIST',
        title,
        baseCount: Number.isFinite(baseCount) && baseCount > 0 ? baseCount : 1,
        unitLabel,
        items,
      },
    ];
  }
  if (type === 'TASK') {
    const due = String(data.dueDateTime ?? '');
    return [{ type: 'TASK', content: draft.title, due }];
  }
  if (type === 'HABIT') {
    const recurrence = String(data.cadenceDescription ?? data.recurrence ?? '');
    return [{ type: 'HABIT', content: draft.title, recurrence }];
  }
  if (type === 'TRIP') {
    const destination = String(data.destination_name ?? data.destination ?? draft.title ?? '');
    const arrivalDue = String(data.arrivalDue ?? data.dueDateTime ?? '');
    return [{ type: 'TRIP', destination, arrivalDue }];
  }
  const content = String(data.memo ?? draft.title ?? '');
  return [{ type: 'NOTE', content }];
}

function buildListBlockFromIntent(it: Record<string, unknown>): Record<string, unknown> | null {
  const title = String(it.title ?? it.content ?? '').trim() || 'Liste';
  const baseCountRaw = Number(it.baseCount ?? 1);
  const baseCount = Number.isFinite(baseCountRaw) && baseCountRaw > 0 ? Math.round(baseCountRaw) : 1;
  const unitLabel = String(it.unitLabel ?? 'personne').trim() || 'personne';
  const rawItems = Array.isArray(it.items) ? (it.items as unknown[]) : [];
  const items = rawItems
    .map((r) => {
      const o = r as Record<string, unknown>;
      const name = String(o.name ?? '').trim();
      if (!name) return null;
      const unit = String(o.unit ?? 'piece').trim() || 'piece';
      const scalable = o.scalable !== undefined ? Boolean(o.scalable) : true;
      const includeInSave = o.includeInSave !== false;
      const baseQuantityRaw =
        o.baseQuantity !== undefined ? Number(o.baseQuantity) : o.qty !== undefined ? Number(o.qty) / baseCount : 1 / baseCount;
      const baseQuantity = Number.isFinite(baseQuantityRaw) && baseQuantityRaw > 0 ? baseQuantityRaw : 1 / baseCount;
      return { name, baseQuantity, unit, scalable, includeInSave };
    })
    .filter(Boolean);
  return {
    title,
    baseCount,
    unitLabel,
    categories: [{ name: '—', items }],
  };
}

type StagedIntent = {
  id: string;
  intent: Record<string, unknown> | null;
  phase: 'loading' | 'shown';
  createdAtMs: number;
  revealedItemsCount?: number;
};

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateFromYmd(ymd: string | null | undefined): Date {
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function strData(d: Record<string, unknown>, key: string): string {
  const v = d[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

function setListBlock(draft: OneTapUniversalResult, list: Record<string, unknown>): OneTapUniversalResult {
  return { ...draft, data: { ...draft.data, list } };
}

function toggleListItemInclude(
  draft: OneTapUniversalResult,
  catIndex: number,
  itemIndex: number,
): OneTapUniversalResult {
  const list = { ...(draft.data.list as Record<string, unknown>) };
  const cats = [...(Array.isArray(list.categories) ? list.categories : [])];
  const cat = { ...(cats[catIndex] as Record<string, unknown>) };
  const items = [...(Array.isArray(cat.items) ? cat.items : [])];
  const item = { ...(items[itemIndex] as Record<string, unknown>) };
  const cur = item.includeInSave !== false;
  item.includeInSave = !cur;
  items[itemIndex] = item;
  cat.items = items;
  cats[catIndex] = cat;
  list.categories = cats;
  return setListBlock(draft, list);
}

function adjustListBaseCount(draft: OneTapUniversalResult, delta: number): OneTapUniversalResult {
  const list = { ...(draft.data.list as Record<string, unknown>) };
  const n = Math.max(1, Math.min(999, Math.round(Number(list.baseCount ?? 1)) + delta));
  list.baseCount = n;
  return setListBlock(draft, list);
}

function patchData(draft: OneTapUniversalResult, patch: Record<string, unknown>): OneTapUniversalResult {
  return { ...draft, data: { ...draft.data, ...patch } };
}

function readDueIso(data: Record<string, unknown>): string | null {
  const v = data.dueDateTime;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function readRecObj(data: Record<string, unknown>): Record<string, unknown> | null {
  const r = data.recurrence;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  return r as Record<string, unknown>;
}

export function OneTapConfirmModal({
  visible,
  draft,
  transcript,
  refinePhase = 'done',
  variant = 'minimal',
  busy,
  onUserEdited,
  onChangeDraft,
  onChangeTranscript,
  onConfirm,
  onDismiss,
}: OneTapConfirmModalProps) {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const insets = useSafeAreaInsets();
  const debugModal = __DEV__ || process.env.EXPO_PUBLIC_ONETAP_MODAL_DEBUG === '1';
  const hapticsFiredRef = useRef(false);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [tripMode, setTripMode] = useState<'FIXED' | 'AI'>('FIXED');
  const [navIndex, setNavIndex] = useState<0 | 1>(0);
  const navX = useRef(new Animated.Value(0)).current;
  const [cardWidth, setCardWidth] = useState(0);
  const backTimerRef = useRef<number | null>(null);

  const runFastLayoutAnim = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 140,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [dateTarget, setDateTarget] = useState<'TASK_DUE' | 'RECUR_NEXT' | 'UNIVERSAL_REMINDER' | null>(null);
  const [sentinelQuotaBalance, setSentinelQuotaBalance] = useState<number | null>(null);
  const [displayedIntents, setDisplayedIntents] = useState<Record<string, unknown>[]>([]);
  const [stagedIntents, setStagedIntents] = useState<StagedIntent[]>([]);
  const hasLocalEditsRef = useRef(false);
  const revealAnimRef = useRef<Record<string, Animated.Value>>({});
  const revealTimersRef = useRef<Record<string, number>>({});
  const itemRevealTimersRef = useRef<Record<string, number>>({});
  const stageDelayMs = Math.max(
    300,
    Math.min(3000, Number(process.env.EXPO_PUBLIC_ONETAP_STAGE_DELAY_MS ?? 1400) || 1400),
  );
  const itemRevealDelayMs = Math.max(
    40,
    Math.min(600, Number(process.env.EXPO_PUBLIC_ONETAP_ITEM_REVEAL_DELAY_MS ?? 120) || 120),
  );
  const listDebugSigRef = useRef<Record<string, string>>({});

  const showRefiningBanner = refinePhase === 'streaming' || refinePhase === 'local';
  const isGenerating = refinePhase === 'streaming' || refinePhase === 'local';
  const minimalUi = variant === 'minimal';

  const markUserEdited = useCallback(() => {
    hasLocalEditsRef.current = true;
    onUserEdited?.();
  }, [onUserEdited]);

  const typeLabels = useMemo(
    () =>
      ONE_TAP_PREDICTED_TYPES.reduce(
        (acc, k) => {
          acc[k] = t(`talkDebug.oneTapType.${k}`);
          return acc;
        },
        {} as Record<OneTapPredictedType, string>,
      ),
    [t],
  );

  const onPrintList = useCallback(async () => {
    if (!draft || draft.predictedType !== 'LIST') return;
    try {
      await printOneTapListDraft(draft);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const body =
        raw === 'PRINT_NATIVE_MODULE_MISSING'
          ? t('talkDebug.oneTapPrintNeedsNativeBuild')
          : raw;
      Alert.alert(t('talkDebug.oneTapPrintErrorTitle'), body);
    }
  }, [draft, t]);

  const hasUniversalReminder = useMemo(() => {
    if (!draft) return false;
    if (readDueIso(draft.data)) return true;
    return Boolean(readRecObj(draft.data));
  }, [draft]);

  useEffect(() => {
    if (!visible) return;
    if (!draft) return;
    if (draft.data.logisticsPotential !== true) return;
    void (async () => {
      await ensureSentinelQuotaInitialized();
      const snap = await getSentinelQuotaSnapshotLocalOnly();
      setSentinelQuotaBalance(snap.balance);
    })();
  }, [draft, visible]);

  if (!draft) return null;

  const patchDraftIntents = useCallback(
    (next: Record<string, unknown>[]) => {
      let data: Record<string, unknown> = { ...draft.data, intents: next };
      if (String(draft.predictedType || '').toUpperCase() === 'LIST') {
        const listIntent = next.find((x) => String((x as Record<string, unknown>)?.type ?? '').toUpperCase() === 'LIST');
        if (listIntent) {
          const list = buildListBlockFromIntent(listIntent as Record<string, unknown>);
          if (list) data = { ...data, list };
        }
      }
      onChangeDraft({ ...draft, data });
    },
    [draft, onChangeDraft],
  );

  useEffect(() => {
    if (!visible) {
      hapticsFiredRef.current = false;
      if (backTimerRef.current) {
        clearTimeout(backTimerRef.current);
        backTimerRef.current = null;
      }
      setDetailIndex(null);
      setTripMode('FIXED');
      setNavIndex(0);
      navX.setValue(0);
      return;
    }
    if (!hapticsFiredRef.current && Platform.OS !== 'web') {
      hapticsFiredRef.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [navX, visible]);

  useEffect(() => {
    if (!cardWidth) return;
    Animated.timing(navX, {
      toValue: -navIndex * cardWidth,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cardWidth, navIndex, navX]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  const didBootstrapIntentsRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      didBootstrapIntentsRef.current = false;
      hasLocalEditsRef.current = false;
      setStagedIntents([]);
      for (const k of Object.keys(revealTimersRef.current)) {
        clearTimeout(revealTimersRef.current[k]);
      }
      revealTimersRef.current = {};
      for (const k of Object.keys(itemRevealTimersRef.current)) {
        clearTimeout(itemRevealTimersRef.current[k]);
      }
      itemRevealTimersRef.current = {};
      revealAnimRef.current = {};
      listDebugSigRef.current = {};
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const next = readDraftIntents(draft);
    if (!next.length && !displayedIntents.length && !didBootstrapIntentsRef.current) {
      const derived = deriveFallbackIntentFromDraft(draft);
      if (derived.length) {
        didBootstrapIntentsRef.current = true;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        const normalized = normalizeIncomingIntents(derived);
        setDisplayedIntents(normalized);
        patchDraftIntents(normalized);
        return;
      }
    }
    if (next.length > displayedIntents.length) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    if (!hasLocalEditsRef.current) {
      const normalized = normalizeIncomingIntents(next);
      if (JSON.stringify(normalized) !== JSON.stringify(displayedIntents)) {
        setDisplayedIntents(normalized);
      }
    }
  }, [displayedIntents, draft, visible]);

  const getWorkingIntents = useCallback((): Record<string, unknown>[] => {
    const direct = readDraftIntents(draft);
    if (!hasLocalEditsRef.current) {
      if (direct.length) return normalizeIncomingIntents(direct);
      return normalizeIncomingIntents(deriveFallbackIntentFromDraft(draft));
    }
    if (displayedIntents.length) return displayedIntents;
    if (direct.length) return direct;
    return deriveFallbackIntentFromDraft(draft);
  }, [displayedIntents, draft]);

  const updateIntentAt = useCallback(
    (intentIndex: number, patch: Record<string, unknown>) => {
      markUserEdited();
      const intents = [...getWorkingIntents()];
      const base = { ...((intents[intentIndex] as Record<string, unknown>) ?? {}) };
      const nextIntent = { ...base, ...patch };
      intents[intentIndex] = nextIntent;
      setDisplayedIntents(intents);
      patchDraftIntents(intents);
    },
    [getWorkingIntents, markUserEdited, patchDraftIntents],
  );

  const logisticsMemoryKeyRef = useRef<string>('');
  useEffect(() => {
    if (!visible || !draft) return;
    if (draft.data?.logisticsPotential !== true && draft.predictedType !== 'TRIP') return;
    const detected = strData(draft.data as Record<string, unknown>, 'destination_name');
    const addr = strData(draft.data as Record<string, unknown>, 'location_address');
    if (!detected || addr) return;
    const key = detected.toLowerCase();
    if (logisticsMemoryKeyRef.current === key) return;
    logisticsMemoryKeyRef.current = key;
    fetchLatestOneTapLogisticsMemory(detected)
      .then((m) => {
        if (!m) return;
        const currentAddr = strData(draft.data as Record<string, unknown>, 'location_address');
        if (currentAddr) return;
        onChangeDraft(
          patchData(draft, {
            location_address: m.location_address,
            remind_to_leave: m.remind_to_leave === 1,
          }),
        );
      })
      .catch(() => undefined);
  }, [draft, onChangeDraft, visible]);

  const lastDebugSigRef = useRef<string>('');
  useEffect(() => {
    if (!debugModal || !visible) return;
    const working = getWorkingIntents();
    const sig = JSON.stringify({
      visible,
      refinePhase,
      isGenerating,
      predictedType: draft.predictedType,
      displayedIntentsLen: displayedIntents.length,
      draftIntentsLen: readDraftIntents(draft).length,
      workingLen: working.length,
      stagedLen: stagedIntents.length,
      stagedPhases: stagedIntents.map((s) => s.phase),
      firstWorkingType: String(working[0]?.type ?? ''),
      firstWorkingTitle: String(working[0]?.title ?? working[0]?.content ?? ''),
    });
    if (sig !== lastDebugSigRef.current) {
      lastDebugSigRef.current = sig;
      console.log('[OneTapModal][debug]', JSON.parse(sig));
    }
  }, [debugModal, displayedIntents.length, draft, getWorkingIntents, isGenerating, refinePhase, stagedIntents, visible]);

  useEffect(() => {
    if (!visible) return;
    const intents = getWorkingIntents();
    const targetCount = intents.length || (isGenerating ? 1 : 0);
    setStagedIntents((prev) => {
      if (targetCount === 0) return prev;
      const next: StagedIntent[] = [];
      for (let i = 0; i < targetCount; i++) {
        const it = intents[i] ?? null;
        const base = `${i}`;
        const existing = prev.find((p) => p.id === base);
        if (existing) {
          next.push({ ...existing, intent: it });
        } else {
          if (debugModal) {
            console.log('[OneTapModal][stage.add]', {
              id: base,
              idx: i,
              type: String(it?.type ?? draft.predictedType ?? ''),
              title: String(it?.title ?? it?.content ?? ''),
              phase: 'loading',
            });
          }
          next.push({ id: base, intent: it, phase: 'loading', createdAtMs: Date.now() });
        }
      }
      return next;
    });
  }, [draft.predictedType, getWorkingIntents, isGenerating, visible]);

  useEffect(() => {
    if (!visible) return;
    for (const st of stagedIntents) {
      if (st.phase !== 'loading') continue;
      if (revealTimersRef.current[st.id]) continue;
      if (debugModal) console.log('[OneTapModal][stage.timer.schedule]', { id: st.id });
      const elapsed = Date.now() - (st.createdAtMs || Date.now());
      const waitMs = Math.max(0, stageDelayMs - elapsed);
      revealTimersRef.current[st.id] = setTimeout(() => {
        if (debugModal) console.log('[OneTapModal][stage.timer.fire]', { id: st.id });
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setStagedIntents((prev) =>
          prev.map((p) => (p.id === st.id ? { ...p, phase: 'shown', revealedItemsCount: 0 } : p)),
        );
      }, waitMs) as unknown as number;
    }
  }, [debugModal, stagedIntents, stageDelayMs, visible]);

  useEffect(() => {
    if (!visible) return;
    for (const st of stagedIntents) {
      if (st.phase !== 'shown') continue;
      const it = st.intent ?? {};
      const type = String(it.type ?? '').trim().toUpperCase();
      if (type !== 'LIST') continue;
      const items = Array.isArray(it.items) ? (it.items as unknown[]) : [];
      const revealed = Math.max(0, Math.round(Number(st.revealedItemsCount ?? 0)));
      if (revealed >= items.length) continue;
      if (itemRevealTimersRef.current[st.id]) continue;
      if (debugModal) {
        console.log('[OneTapModal][items.timer.schedule]', {
          id: st.id,
          itemsLen: items.length,
          revealed,
          delayMs: itemRevealDelayMs,
        });
      }
      itemRevealTimersRef.current[st.id] = setTimeout(() => {
        delete itemRevealTimersRef.current[st.id];
        if (debugModal) {
          console.log('[OneTapModal][items.timer.fire]', {
            id: st.id,
            itemsLen: items.length,
            revealed,
          });
        }
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setStagedIntents((prev) =>
          prev.map((p) =>
            p.id === st.id
              ? { ...p, revealedItemsCount: Math.min(items.length, Math.max(0, Math.round(Number(p.revealedItemsCount ?? 0))) + 1) }
              : p,
          ),
        );
      }, itemRevealDelayMs) as unknown as number;
    }
  }, [itemRevealDelayMs, stagedIntents, visible]);

  const removeIntentAt = (intentIndex: number) => {
    markUserEdited();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const src = getWorkingIntents();
    const next = src.filter((_, i) => i !== intentIndex);
    setDisplayedIntents(next);
    patchDraftIntents(next);
  };

  const toggleIntentListItemInclude = (intentIndex: number, itemIndex: number) => {
    markUserEdited();
    const intents = [...getWorkingIntents()];
    const intent = { ...(intents[intentIndex] as Record<string, unknown>) };
    const itemsRaw = intent.items;
    const items = Array.isArray(itemsRaw) ? [...itemsRaw] : [];
    const it = { ...((items[itemIndex] as Record<string, unknown>) ?? {}) };
    const cur = it.includeInSave !== false;
    it.includeInSave = !cur;
    items[itemIndex] = it;
    intent.items = items;
    intents[intentIndex] = intent;
    setDisplayedIntents(intents);
    patchDraftIntents(intents);
  };

  const removeIntentListItem = (intentIndex: number, itemIndex: number) => {
    markUserEdited();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const intents = [...getWorkingIntents()];
    const intent = { ...(intents[intentIndex] as Record<string, unknown>) };
    const itemsRaw = intent.items;
    const items = Array.isArray(itemsRaw) ? [...itemsRaw] : [];
    items.splice(itemIndex, 1);
    intent.items = items;
    intents[intentIndex] = intent;
    setDisplayedIntents(intents);
    patchDraftIntents(intents);
  };

  const adjustIntentListBaseCount = (intentIndex: number, delta: number) => {
    markUserEdited();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const intents = [...getWorkingIntents()];
    const intent = { ...(intents[intentIndex] as Record<string, unknown>) };
    const before = Math.max(1, Math.round(Number(intent.baseCount ?? 1)));
    const n = Math.max(1, Math.min(999, before + delta));
    intent.baseCount = n;
    intents[intentIndex] = intent;
    setDisplayedIntents(intents);
    patchDraftIntents(intents);
    if (debugModal) {
      console.log('[OneTapModal][stepper]', { intentIndex, delta, before, after: n });
    }
  };

  const setIntentListUnitLabel = (intentIndex: number, unitLabel: string) => {
    markUserEdited();
    const intents = [...getWorkingIntents()];
    const intent = { ...(intents[intentIndex] as Record<string, unknown>) };
    intent.unitLabel = unitLabel;
    intents[intentIndex] = intent;
    setDisplayedIntents(intents);
    patchDraftIntents(intents);
  };

  const applyType = (next: OneTapPredictedType) => {
    if (next === draft.predictedType) {
      setMenuOpen(false);
      return;
    }
    markUserEdited();
    setDateTarget(null);
    const nextData = mergeOneTapDataOnTypeChange(draft.predictedType, next, draft.data, draft.title);
    onChangeDraft({
      ...draft,
      predictedType: next,
      data: nextData,
    });
    setMenuOpen(false);
  };

  const onDatePicked = (event: { type?: string }, date?: Date) => {
    const target = dateTarget;
    if (Platform.OS === 'android') {
      setDateTarget(null);
    }
    if (Platform.OS === 'android' && event.type === 'dismissed') {
      return;
    }
    if (date) {
      markUserEdited();
      const ymd = ymdFromDate(date);
      if (target === 'TASK_DUE') {
        onChangeDraft(patchData(draft, { dueDateYmd: ymd }));
      } else if (target === 'RECUR_NEXT') {
        onChangeDraft(patchData(draft, { nextDueYmd: ymd }));
      } else if (target === 'UNIVERSAL_REMINDER') {
        const d = new Date(date);
        d.setHours(9, 0, 0, 0);
        onChangeDraft(patchData(draft, { dueDateTime: d.toISOString() }));
      }
    }
    if (Platform.OS === 'ios') {
      setDateTarget(null);
    }
  };

  const renderUniversalReminderSection = () => {
    const iso = readDueIso(draft.data);
    const rec = readRecObj(draft.data);
    const showPicker = dateTarget === 'UNIVERSAL_REMINDER';
    let dueDisplay: string | null = null;
    if (iso) {
      try {
        const dt = new Date(iso);
        dueDisplay = Number.isNaN(dt.getTime()) ? iso : dt.toLocaleString(i18n.language);
      } catch {
        dueDisplay = iso;
      }
    }
    const recLine = rec
      ? [String(rec.summary ?? '').trim(), String(rec.frequency ?? '').trim()]
          .filter(Boolean)
          .join(' · ')
      : null;

    return (
      <View style={styles.reminderSection}>
        <View style={styles.reminderTitleRow}>
          <Bell size={18} color="#008080" />
          <Text style={styles.sectionTitle}>{t('talkDebug.oneTapUniversalReminderTitle')}</Text>
        </View>
        {hasUniversalReminder ? (
          <>
            {dueDisplay ? (
              <Text style={styles.reminderLine}>
                {t('talkDebug.oneTapUniversalDueLabel')}: {dueDisplay}
              </Text>
            ) : null}
            {recLine ? (
              <Text style={styles.reminderLine}>
                {t('talkDebug.oneTapUniversalRecLabel')}: {recLine}
              </Text>
            ) : null}
            <Pressable
              style={[styles.linkish, busy && styles.disabled]}
              disabled={busy}
              onPress={() => onChangeDraft(patchData(draft, { dueDateTime: null, recurrence: null }))}
            >
              <Text style={styles.linkishText}>{t('talkDebug.oneTapClearUniversalReminder')}</Text>
            </Pressable>
          </>
        ) : Platform.OS === 'web' ? (
          <>
            <Text style={styles.label}>{t('talkDebug.oneTapWebDueDateTimeIso')}</Text>
            <TextInput
              value={iso ?? ''}
              onChangeText={(text) =>
                onChangeDraft(
                  patchData(draft, {
                    dueDateTime: text.trim() === '' ? null : text.trim(),
                  }),
                )
              }
              style={styles.input}
              editable={!busy}
              placeholder="2026-04-20T09:00:00.000Z"
            />
          </>
        ) : (
          <Pressable
            style={[styles.addReminderBtn, busy && styles.disabled]}
            disabled={busy}
            onPress={() => setDateTarget('UNIVERSAL_REMINDER')}
          >
            <Text style={styles.addReminderBtnText}>{t('talkDebug.oneTapAddReminderCta')}</Text>
          </Pressable>
        )}
        {showPicker && Platform.OS !== 'web' ? (
          <TimelineDatePickerLazy
            value={iso ? new Date(iso) : new Date()}
            mode="date"
            display="default"
            onChange={onDatePicked}
          />
        ) : null}
      </View>
    );
  };

  const renderIntentCards = () => {
    if (!stagedIntents.length) return null;
    return (
      <View style={styles.section}>
        {stagedIntents.map((st, idx) => {
          const it = st.intent ?? {};
          const type = String(it.type ?? '').trim().toUpperCase();
          if (st.phase === 'loading') {
            const loadingType = String((st.intent as Record<string, unknown> | null)?.type ?? draft.predictedType ?? '')
              .trim()
              .toUpperCase();
            return (
              <View key={st.id} style={styles.intentLoadingRow}>
                <Text style={styles.intentType}>{loadingType || '...'}</Text>
                <View style={styles.loadingTitleRow}>
                  <Text style={styles.intentLoadingText}>{intentLabel(st.intent, draft.predictedType)}</Text>
                  <StreamingIndicator />
                </View>
              </View>
            );
          }
          const anim = revealAnimRef.current[st.id] ?? new Animated.Value(0);
          if (!revealAnimRef.current[st.id]) {
            revealAnimRef.current[st.id] = anim;
            Animated.timing(anim, {
              toValue: 1,
              duration: 220,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start();
          }
          const cardStyle = {
            opacity: anim,
            transform: [
              {
                translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
              },
            ],
          };
          if (type === 'TASK') {
            const title = String(it.content ?? it.title ?? '').trim() || '—';
            const dueIso = String(it.due ?? '').trim();
            let badge = '';
            if (dueIso) {
              try {
                const dt = new Date(dueIso);
                badge = Number.isNaN(dt.getTime())
                  ? dueIso
                  : dt.toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
              } catch {
                badge = dueIso;
              }
            }
            return (
              <Animated.View key={st.id} style={[styles.intentCard, cardStyle]}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>TASK</Text>
                  {badge ? <Text style={styles.intentBadge}>{badge}</Text> : null}
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
              </Animated.View>
            );
          }
          if (type === 'NOTE') {
            const title = String(it.content ?? it.title ?? '').trim() || '—';
            return (
              <Animated.View key={st.id} style={[styles.intentCard, cardStyle]}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>NOTE</Text>
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
              </Animated.View>
            );
          }
          if (type === 'LIST') {
            const title = String(it.title ?? it.content ?? '').trim() || 'Liste';
            const numberOfPeople = Math.max(1, Math.round(Number(it.baseCount ?? 1)));
            const unitLabel = String(it.unitLabel ?? 'personne');
            const items = Array.isArray(it.items) ? (it.items as unknown[]) : [];
            const revealed = Math.max(0, Math.round(Number(st.revealedItemsCount ?? items.length)));
            const shownItems = items.slice(0, revealed);
            const showControls = items.length > 0 && revealed >= items.length;
            if (debugModal) {
              const sample = items.slice(0, 3).map((raw) => {
                const ir = raw as Record<string, unknown>;
                const derivedBaseQuantity =
                  ir.baseQuantity !== undefined
                    ? Number(ir.baseQuantity)
                    : ir.qty !== undefined
                      ? Number(ir.qty) / numberOfPeople
                      : 1 / numberOfPeople;
                const displayRef: Record<string, unknown> = {
                  ...ir,
                  baseQuantity: Number.isFinite(derivedBaseQuantity) ? derivedBaseQuantity : 1 / numberOfPeople,
                };
                const name = String(ir.name ?? '').trim();
                const unit = String(ir.unit ?? '').trim();
                const q = listItemDisplayQuantity(displayRef, numberOfPeople);
                return `${name}:${q}${unit ? ` ${unit}` : ''}`;
              });
              const sig = JSON.stringify({
                id: st.id,
                phase: st.phase,
                isGenerating,
                title,
                baseCount: numberOfPeople,
                unitLabel,
                itemsLen: items.length,
                revealed,
                shownLen: shownItems.length,
                firstItem: items.length ? String((items[0] as Record<string, unknown>)?.name ?? '') : '',
                sample,
              });
              if (listDebugSigRef.current[st.id] !== sig) {
                listDebugSigRef.current[st.id] = sig;
                console.log('[OneTapModal][list.render]', JSON.parse(sig));
              }
            }
            return (
              <Animated.View key={st.id} style={[styles.intentCard, cardStyle]}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>LIST</Text>
                </View>

                <View style={styles.listTitleRow}>
                  <Text style={styles.intentTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  {!showControls ? <StreamingIndicator /> : null}
                </View>

                {showControls ? (
                  <View style={styles.listControlsBelow}>
                    <Text style={styles.intentBadge}>{`${numberOfPeople} ${unitLabel}`.trim()}</Text>
                    <View style={styles.listStepperInline}>
                      <Pressable
                        style={[styles.stepBtn, busy && styles.disabled]}
                        disabled={busy}
                        onPress={() => adjustIntentListBaseCount(idx, -1)}
                      >
                        <Text style={styles.stepBtnText}>−</Text>
                      </Pressable>
                      <Text style={styles.countText}>{numberOfPeople}</Text>
                      <Pressable
                        style={[styles.stepBtn, busy && styles.disabled]}
                        disabled={busy}
                        onPress={() => adjustIntentListBaseCount(idx, 1)}
                      >
                        <Text style={styles.stepBtnText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {isGenerating && !items.length ? (
                  <View style={styles.intentLoadingInline}>
                    <Text style={styles.intentLoadingInlineText}>Ingrédients…</Text>
                  </View>
                ) : null}
                <View style={styles.catBlock}>
                  {shownItems.map((raw, ii) => {
                    const ir = raw as Record<string, unknown>;
                    const derivedBaseQuantity =
                      ir.baseQuantity !== undefined
                        ? Number(ir.baseQuantity)
                        : ir.qty !== undefined
                          ? Number(ir.qty) / numberOfPeople
                          : 1 / numberOfPeople;
                    const displayRef: Record<string, unknown> = {
                      ...ir,
                      baseQuantity: Number.isFinite(derivedBaseQuantity) ? derivedBaseQuantity : 1 / numberOfPeople,
                    };
                    const label = String(ir.name ?? '').trim() || '—';
                    const displayQty = listItemDisplayQuantity(displayRef, numberOfPeople);
                    const unit = String(ir.unit ?? '');
                    const sub = displayQty > 0 ? `${displayQty}${unit ? ` ${unit}` : ''}` : '';
                    return (
                      <Pressable
                        key={`it-${idx}-${ii}`}
                        style={styles.listItemRow}
                        onPress={() => !busy && toggleIntentListItemInclude(idx, ii)}
                      >
                        <Pressable
                          style={[styles.ingredientDeleteBtn, busy && styles.disabled]}
                          disabled={busy}
                          onPress={() => !busy && removeIntentListItem(idx, ii)}
                          accessibilityRole="button"
                          accessibilityLabel="Supprimer ingrédient"
                        >
                          <View style={styles.intentDeleteMinus} />
                        </Pressable>
                        <Text style={styles.listBullet}>•</Text>
                        <Text style={styles.listItemLabel} numberOfLines={1}>
                          {label}
                        </Text>
                        <Text style={styles.listItemQty}>{sub}</Text>
                      </Pressable>
                    );
                  })}
                  {items.length > 0 && revealed < items.length ? <StreamingIndicator /> : null}
                </View>
              </Animated.View>
            );
          }
          if (type === 'HABIT') {
            const title = String(it.content ?? it.title ?? '').trim() || '—';
            const rec = String(it.recurrence ?? '').trim();
            return (
              <Animated.View key={st.id} style={[styles.intentCard, cardStyle]}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>HABIT</Text>
                  {rec ? <Text style={styles.intentBadge}>{rec}</Text> : null}
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
              </Animated.View>
            );
          }
          if (type === 'TRIP') {
            const detected = String(it.destination ?? it.content ?? '').trim() || strData(draft.data as Record<string, unknown>, 'destination_name') || '—';
            const addr = strData(draft.data as Record<string, unknown>, 'location_address');
            return (
              <Animated.View key={st.id} style={[styles.intentCard, cardStyle]}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>TRIP</Text>
                </View>
                <Text style={styles.intentTitle}>{detected}</Text>
                <View style={styles.tripAddressRow}>
                  <GooglePlacesAutocompleteField
                    value={addr}
                    onChangeText={(text) =>
                      onChangeDraft(
                        patchData(draft, {
                          logisticsPotential: true,
                          destination_name: detected,
                          location_address: text,
                          location_place_id: null,
                          location_lat: null,
                          location_lng: null,
                        }),
                      )
                    }
                    onSelect={(p) =>
                      onChangeDraft(
                        patchData(draft, {
                          logisticsPotential: true,
                          destination_name: detected,
                          location_address: p.formattedAddress,
                          location_place_id: p.placeId,
                          location_lat: p.lat,
                          location_lng: p.lng,
                        }),
                      )
                    }
                    disabled={busy}
                    placeholder={t('sentinel.addressPlaceholder')}
                    missingKeyLabel={t('sentinel.placesMissingKey')}
                  />
                </View>
              </Animated.View>
            );
          }
          return null;
        })}
      </View>
    );
  };

  const renderTypeBody = () => {
    const streamed = renderIntentCards();
    if (minimalUi) return streamed;
    if (streamed) return streamed;
    const d = draft.data;
    const logisticsBlock = () => {
      if (d.logisticsPotential !== true) return null;
      const detected = strData(d, 'destination_name');
      const addr = strData(d, 'location_address');
      const hasValid =
        String(d.location_place_id ?? '').trim().length > 0 &&
        typeof d.location_lat === 'number' &&
        Number.isFinite(d.location_lat) &&
        typeof d.location_lng === 'number' &&
        Number.isFinite(d.location_lng);
      return (
        <View style={styles.logisticsWrap}>
          <Text style={styles.logisticsTitle}>{t('sentinel.validationTitle')}</Text>
          <Text style={styles.logisticsHint}>
            {t('sentinel.detectedPlace', { place: detected || '—' })}
          </Text>
          <Text style={styles.label}>{t('sentinel.addressLabel')}</Text>
          <GooglePlacesAutocompleteField
            value={addr}
            onChangeText={(text) =>
              onChangeDraft(
                patchData(draft, {
                  location_address: text,
                  location_place_id: null,
                  location_lat: null,
                  location_lng: null,
                })
              )
            }
            onSelect={(p) =>
              onChangeDraft(
                patchData(draft, {
                  location_address: p.formattedAddress,
                  location_place_id: p.placeId,
                  location_lat: p.lat,
                  location_lng: p.lng,
                })
              )
            }
            disabled={busy}
            language={i18n.language}
            placeholder={t('sentinel.addressPlaceholder')}
            missingKeyLabel={t('sentinel.placesMissingKey')}
          />
          {!hasValid ? (
            <Text style={styles.logisticsWarn}>{t('sentinel.validationRequired')}</Text>
          ) : null}
          {!spectrum.isProUser && sentinelQuotaBalance !== null ? (
            <Text style={styles.logisticsQuota}>
              {t('quota_remaining', { count: sentinelQuotaBalance })}
            </Text>
          ) : null}
          {!spectrum.isProUser && sentinelQuotaBalance !== null && sentinelQuotaBalance <= 0 ? (
            <View style={styles.logisticsExhausted}>
              <Text style={styles.logisticsExhaustedTitle}>{t('quota_exhausted_title')}</Text>
              <Text style={styles.logisticsExhaustedDesc}>{t('quota_exhausted_desc')}</Text>
            </View>
          ) : null}
        </View>
      );
    };
    switch (draft.predictedType) {
      case 'LIST': {
        const list = (d.list && typeof d.list === 'object' ? d.list : {}) as Record<string, unknown>;
        const numberOfPeople = Math.max(1, Math.round(Number(list.baseCount ?? 1)));
        const unitLabel = String(list.unitLabel ?? 'personne');
        const cats = Array.isArray(list.categories) ? list.categories : [];
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapListSection')}</Text>
            <View style={styles.quantityRow}>
              <Pressable
                style={[styles.stepBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={() => onChangeDraft(adjustListBaseCount(draft, -1))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.countText}>{numberOfPeople}</Text>
              <Pressable
                style={[styles.stepBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={() => onChangeDraft(adjustListBaseCount(draft, 1))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
              <TextInput
                value={unitLabel}
                onChangeText={(text) => {
                  const nextList = { ...list, unitLabel: text };
                  onChangeDraft(setListBlock(draft, nextList));
                }}
                style={[styles.input, styles.unitInput]}
                editable={!busy}
                placeholder={t('talkDebug.oneTapListUnitPlaceholder')}
              />
            </View>
            <Text style={styles.label}>{t('talkDebug.oneTapListItems')}</Text>
            {cats.map((cat, ci) => {
              const cr = cat as Record<string, unknown>;
              const catName = String(cr.name ?? '').trim() || '—';
              const itemsRaw = cr.items;
              const items = Array.isArray(itemsRaw) ? itemsRaw : [];
              return (
                <View key={`cat-${ci}`} style={styles.catBlock}>
                  <Text style={styles.catName}>{catName}</Text>
                  {items.map((it, ii) => {
                    const ir = it as Record<string, unknown>;
                    const label = String(ir.name ?? '').trim() || '—';
                    const displayQty = listItemDisplayQuantity(ir, numberOfPeople);
                    const unit = String(ir.unit ?? '');
                    const included = ir.includeInSave !== false;
                    const sub =
                      displayQty > 0 ? `${displayQty}${unit ? ` ${unit}` : ''}` : '';
                    return (
                      <Pressable
                        key={`it-${ci}-${ii}`}
                        style={styles.checkRow}
                        onPress={() => !busy && onChangeDraft(toggleListItemInclude(draft, ci, ii))}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: included }}
                      >
                        <Checkbox.Android
                          status={included ? 'checked' : 'unchecked'}
                          onPress={() => !busy && onChangeDraft(toggleListItemInclude(draft, ci, ii))}
                        />
                        <View style={styles.checkLabelCol}>
                          <Text style={styles.checkLabel}>{label}</Text>
                          {sub ? <Text style={styles.checkSub}>{sub}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        );
      }
      case 'TASK': {
        const due = strData(d, 'dueDateYmd');
        const dueTime = strData(d, 'dueTimeHm');
        const notes = strData(d, 'notes');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapTaskSection')}</Text>
            {Platform.OS === 'web' ? (
              <>
                <Text style={styles.label}>{t('talkDebug.oneTapWebDateLabel')}</Text>
                <TextInput
                  value={due}
                  onChangeText={(text) =>
                    onChangeDraft(patchData(draft, { dueDateYmd: text.trim() || null }))
                  }
                  style={styles.input}
                  editable={!busy}
                  placeholder="YYYY-MM-DD"
                />
              </>
            ) : (
              <>
                <Pressable
                  style={[styles.dateCta, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => setDateTarget('TASK_DUE')}
                >
                  <Text style={styles.dateCtaText}>
                    {due ? due : t('talkDebug.oneTapPickDate')}
                  </Text>
                </Pressable>
                {due ? (
                  <Pressable
                    style={styles.linkish}
                    disabled={busy}
                    onPress={() => onChangeDraft(patchData(draft, { dueDateYmd: null }))}
                  >
                    <Text style={styles.linkishText}>{t('talkDebug.oneTapClearDate')}</Text>
                  </Pressable>
                ) : null}
                {dateTarget === 'TASK_DUE' ? (
                  <TimelineDatePickerLazy
                    value={dateFromYmd(due)}
                    mode="date"
                    display="default"
                    onChange={onDatePicked}
                  />
                ) : null}
              </>
            )}
            <Text style={styles.label}>{t('talkDebug.oneTapTaskDueTime')}</Text>
            <TextInput
              value={dueTime}
              onChangeText={(text) => onChangeDraft(patchData(draft, { dueTimeHm: text }))}
              style={styles.input}
              editable={!busy}
              placeholder="HH:mm"
            />
            <Text style={styles.label}>{t('talkDebug.oneTapTaskNotes')}</Text>
            <TextInput
              value={notes}
              onChangeText={(text) => onChangeDraft(patchData(draft, { notes: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            {logisticsBlock()}
          </View>
        );
      }
      case 'RECURRING_TASK': {
        const nextDue = strData(d, 'nextDueYmd');
        const cadence = strData(d, 'cadenceDescription');
        const anchor = strData(d, 'anchorNotes');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapRecurringSection')}</Text>
            {Platform.OS === 'web' ? (
              <>
                <Text style={styles.label}>{t('talkDebug.oneTapWebDateLabel')}</Text>
                <TextInput
                  value={nextDue}
                  onChangeText={(text) =>
                    onChangeDraft(patchData(draft, { nextDueYmd: text.trim() || null }))
                  }
                  style={styles.input}
                  editable={!busy}
                  placeholder="YYYY-MM-DD"
                />
              </>
            ) : (
              <>
                <Pressable
                  style={[styles.dateCta, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => setDateTarget('RECUR_NEXT')}
                >
                  <Text style={styles.dateCtaText}>
                    {nextDue ? nextDue : t('talkDebug.oneTapPickDate')}
                  </Text>
                </Pressable>
                {nextDue ? (
                  <Pressable
                    style={styles.linkish}
                    disabled={busy}
                    onPress={() => onChangeDraft(patchData(draft, { nextDueYmd: null }))}
                  >
                    <Text style={styles.linkishText}>{t('talkDebug.oneTapClearDate')}</Text>
                  </Pressable>
                ) : null}
                {dateTarget === 'RECUR_NEXT' ? (
                  <TimelineDatePickerLazy
                    value={dateFromYmd(nextDue)}
                    mode="date"
                    display="default"
                    onChange={onDatePicked}
                  />
                ) : null}
              </>
            )}
            <Text style={styles.label}>{t('talkDebug.oneTapCadence')}</Text>
            <TextInput
              value={cadence}
              onChangeText={(text) => onChangeDraft(patchData(draft, { cadenceDescription: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            <Text style={styles.label}>{t('talkDebug.oneTapAnchorNotes')}</Text>
            <TextInput
              value={anchor}
              onChangeText={(text) => onChangeDraft(patchData(draft, { anchorNotes: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            {logisticsBlock()}
          </View>
        );
      }
      case 'HABIT': {
        const cadence = strData(d, 'cadenceDescription');
        const pref = strData(d, 'preferredTimeHm');
        const notes = strData(d, 'notes');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapHabitSection')}</Text>
            <Text style={styles.label}>{t('talkDebug.oneTapCadence')}</Text>
            <TextInput
              value={cadence}
              onChangeText={(text) => onChangeDraft(patchData(draft, { cadenceDescription: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            <Text style={styles.label}>{t('talkDebug.oneTapPreferredTime')}</Text>
            <TextInput
              value={pref}
              onChangeText={(text) => onChangeDraft(patchData(draft, { preferredTimeHm: text }))}
              style={styles.input}
              editable={!busy}
              placeholder="HH:mm"
            />
            <Text style={styles.label}>{t('talkDebug.oneTapTaskNotes')}</Text>
            <TextInput
              value={notes}
              onChangeText={(text) => onChangeDraft(patchData(draft, { notes: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            {logisticsBlock()}
          </View>
        );
      }
      case 'ANNIVERSARY': {
        const person = strData(d, 'personName');
        const md = strData(d, 'monthDay');
        const remRaw = d.reminderDaysBefore;
        const rem =
          remRaw === null || remRaw === undefined ? '' : String(Math.max(0, Number(remRaw) || 0));
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapAnniversarySection')}</Text>
            <Text style={styles.label}>{t('talkDebug.oneTapPersonName')}</Text>
            <TextInput
              value={person}
              onChangeText={(text) => onChangeDraft(patchData(draft, { personName: text }))}
              style={styles.input}
              editable={!busy}
            />
            <Text style={styles.label}>{t('talkDebug.oneTapMonthDay')}</Text>
            <TextInput
              value={md}
              onChangeText={(text) => onChangeDraft(patchData(draft, { monthDay: text }))}
              style={styles.input}
              editable={!busy}
              placeholder="MM-DD"
            />
            <Text style={styles.label}>{t('talkDebug.oneTapReminderDays')}</Text>
            <TextInput
              value={rem}
              onChangeText={(text) => {
                const trim = text.trim();
                onChangeDraft(
                  patchData(draft, {
                    reminderDaysBefore: trim === '' ? null : Math.max(0, parseInt(trim, 10) || 0),
                  }),
                );
              }}
              style={styles.input}
              editable={!busy}
              keyboardType="number-pad"
            />
          </View>
        );
      }
      case 'NOTE':
      default: {
        const memo = strData(d, 'memo');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapNoteSection')}</Text>
            <TextInput
              value={memo}
              onChangeText={(text) => onChangeDraft(patchData(draft, { memo: text }))}
              style={[styles.input, styles.multiline]}
              multiline
              editable={!busy}
            />
          </View>
        );
      }
    }
  };

  const getSynthesisIntents = useCallback((): Record<string, unknown>[] => {
    if (hasLocalEditsRef.current) {
      return displayedIntents.length ? displayedIntents : normalizeIncomingIntentsPreserveOrder(readDraftIntents(draft));
    }
    const direct = readDraftIntents(draft);
    if (direct.length) return normalizeIncomingIntentsPreserveOrder(direct);
    return normalizeIncomingIntentsPreserveOrder(deriveFallbackIntentFromDraft(draft));
  }, [displayedIntents, draft]);

  const intents = getSynthesisIntents();

  const openDetail = (idx: number) => {
    runFastLayoutAnim();
    setDetailIndex(idx);
    setNavIndex(1);
  };

  const backToSynthesis = () => {
    runFastLayoutAnim();
    setNavIndex(0);
    if (backTimerRef.current) clearTimeout(backTimerRef.current);
    backTimerRef.current = setTimeout(() => {
      setDetailIndex(null);
      backTimerRef.current = null;
    }, 210) as unknown as number;
  };

  const intentBadge = (typeRaw: string) => {
    const type = String(typeRaw || '').trim().toUpperCase();
    const label =
      type === 'TASK' || type === 'RECURRING_TASK'
        ? t('talkDebug.oneTapBadgeTask', { defaultValue: 'Tâche' })
        : type === 'HABIT'
          ? t('talkDebug.oneTapBadgeHabit', { defaultValue: 'Routine' })
          : type === 'LIST'
            ? t('talkDebug.oneTapBadgeList', { defaultValue: 'Liste' })
            : type === 'TRIP'
              ? t('talkDebug.oneTapBadgeTrip', { defaultValue: 'Lieu' })
              : t('talkDebug.oneTapBadgeNote', { defaultValue: 'Note' });
    const palette =
      type === 'TASK' || type === 'RECURRING_TASK'
        ? { fg: '#0A84FF', bg: 'rgba(10,132,255,0.16)' }
        : type === 'HABIT'
          ? { fg: '#34C759', bg: 'rgba(52,199,89,0.16)' }
          : type === 'LIST'
            ? { fg: '#FF9F0A', bg: 'rgba(255,159,10,0.18)' }
            : type === 'TRIP'
              ? { fg: '#AF52DE', bg: 'rgba(175,82,222,0.16)' }
              : { fg: '#8E8E93', bg: 'rgba(142,142,147,0.18)' };
    return { label, ...palette };
  };

  const renderTripSynthesisBlock = () => {
    const addr = strData(draft.data as Record<string, unknown>, 'location_address');
    return (
      <View style={styles.tripBlock}>
        <Text style={styles.tripLabel}>{t('talkDebug.oneTapTripAddressLabel', { defaultValue: 'Adresse' })}</Text>
        <TextInput
          value={addr}
          onChangeText={(text) => onChangeDraft(patchData(draft, { logisticsPotential: true, location_address: text }))}
          style={styles.tripAddressInput}
          editable={!busy}
          placeholder={t('talkDebug.oneTapTripAddressPlaceholder', { defaultValue: 'Adresse' })}
          placeholderTextColor="rgba(15,23,42,0.35)"
        />
        <View style={styles.tripSegmentWrap}>
          <Pressable
            style={[styles.tripSegment, tripMode === 'FIXED' ? styles.tripSegmentActive : null, busy && styles.disabled]}
            onPress={() => setTripMode('FIXED')}
            disabled={busy}
          >
            <Text style={[styles.tripSegmentText, tripMode === 'FIXED' ? styles.tripSegmentTextActive : null]}>
              {t('talkDebug.oneTapTripModeFixed', { defaultValue: '🕓 Fixe' })}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tripSegment, tripMode === 'AI' ? styles.tripSegmentActive : null, busy && styles.disabled]}
            onPress={() => setTripMode('AI')}
            disabled={busy}
          >
            <Text style={[styles.tripSegmentText, tripMode === 'AI' ? styles.tripSegmentTextActive : null]}>
              {t('talkDebug.oneTapTripModeAi', { defaultValue: '🚀 Créneau de départ IA' })}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderSynthesisView = () => {
    return (
      <>
        <View style={styles.synthHeader}>
          <Text style={styles.synthTitle}>{t('talkDebug.oneTapSynthesisTitle', { defaultValue: 'Synthèse' })}</Text>
          {transcript.trim() ? (
            <View style={styles.transcriptCard}>
              <Text style={styles.transcriptText}>{transcript.trim()}</Text>
            </View>
          ) : null}
        </View>
        <ScrollView style={styles.synthScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.intentList}>
            {intents.length ? (
              <>
                <Text style={styles.sectionHeader}>{t('talkDebug.oneTapSynthesisSummaryHeader', { defaultValue: 'RÉSUMÉ' })}</Text>
                <View style={styles.summaryCard}>
                  {intents.map((it, idx) => {
                    const title = intentShortTitle(it, draft.predictedType);
                    const type = String(it?.type ?? draft.predictedType ?? '').trim().toUpperCase();
                    const badge = intentBadge(type);
                    const isLast = idx === intents.length - 1;
                    return (
                      <View key={`syn-${idx}`} style={[styles.intentItem, !isLast ? styles.intentItemSep : null]}>
                        <Pressable
                          style={[styles.intentRow, busy && styles.disabled]}
                          onPress={() => !busy && openDetail(idx)}
                          disabled={busy}
                        >
                          <View style={styles.intentIcon}>
                            <IntentIcon type={type} />
                          </View>
                          <View style={styles.intentCenter}>
                            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                              <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
                            </View>
                            <Text style={styles.intentRowTitle} numberOfLines={1}>
                              {title}
                            </Text>
                          </View>
                          <ChevronRight size={18} color="rgba(15,23,42,0.35)" />
                        </Pressable>
                        {type === 'TRIP' ? renderTripSynthesisBlock() : null}
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}
          </View>
          <View style={styles.synthBottomPad} />
        </ScrollView>
        <View style={styles.synthFooter}>
          <Pressable
            style={[styles.primaryBtn, busy && styles.disabled]}
            onPress={onConfirm}
            disabled={busy}
          >
            <Text style={styles.primaryBtnText}>
              {intents.length
                ? t('talkDebug.oneTapConfirmAll', { defaultValue: 'TOUT CONFIRMER' })
                : t('talkDebug.oneTapSaveForLater', { defaultValue: 'ENREGISTRER' })}
            </Text>
          </Pressable>
          <Pressable style={[styles.secondaryBtn, busy && styles.disabled]} onPress={onDismiss} disabled={busy}>
            <Text style={styles.secondaryBtnText}>{t('common.cancel', { defaultValue: 'Annuler' })}</Text>
          </Pressable>
        </View>
      </>
    );
  };

  const renderDetailView = () => {
    if (detailIndex === null) {
      return <View style={styles.detailEmpty} />;
    }
    const it = intents[detailIndex] ?? null;
    const type = String(it?.type ?? draft.predictedType ?? '').trim().toUpperCase();
    const title = intentShortTitle(it, draft.predictedType);
    const destination = String((it as Record<string, unknown> | null)?.destination ?? '').trim();
    const addr = strData(draft.data as Record<string, unknown>, 'location_address');
    const listItems = Array.isArray((it as Record<string, unknown> | null)?.items)
      ? ((it as Record<string, unknown>).items as unknown[])
      : [];

    return (
      <>
        <View style={styles.detailHeader}>
          <Pressable style={styles.backBtn} onPress={backToSynthesis} disabled={busy}>
            <Text style={styles.backBtnText}>‹</Text>
            <Text style={styles.backBtnLabel}>{t('common.back', { defaultValue: 'Retour' })}</Text>
          </Pressable>
          <Text style={styles.detailTitle} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.detailHeaderSpacer} />
        </View>
        <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>{t('talkDebug.oneTapIntentType', { defaultValue: 'Type' })}</Text>
            <Text style={styles.detailValue}>{type || '—'}</Text>
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>{t('talkDebug.oneTapIntentTitle', { defaultValue: 'Titre' })}</Text>
            <TextInput
              value={type === 'TRIP' ? destination : String((it as Record<string, unknown> | null)?.title ?? (it as Record<string, unknown> | null)?.content ?? '').trim()}
              onChangeText={(text) => {
                if (type === 'LIST') updateIntentAt(detailIndex, { title: text });
                else if (type === 'TRIP') updateIntentAt(detailIndex, { destination: text });
                else if (type === 'NOTE') updateIntentAt(detailIndex, { content: text });
                else updateIntentAt(detailIndex, { content: text });
              }}
              style={styles.detailInput}
              editable={!busy}
              placeholder={t('talkDebug.oneTapIntentTitlePlaceholder', { defaultValue: 'Titre' })}
              placeholderTextColor="rgba(15,23,42,0.35)"
            />
          </View>

          {type === 'TRIP' ? (
            <View style={styles.detailCard}>
              <Text style={styles.detailLabel}>{t('talkDebug.oneTapTripAddressLabel', { defaultValue: 'Adresse' })}</Text>
              <TextInput
                value={addr}
                onChangeText={(text) =>
                  onChangeDraft(
                    patchData(draft, {
                      logisticsPotential: true,
                      location_address: text,
                    }),
                  )
                }
                style={styles.detailInput}
                editable={!busy}
                placeholder={t('talkDebug.oneTapTripAddressPlaceholder', { defaultValue: 'Adresse' })}
                placeholderTextColor="rgba(15,23,42,0.35)"
              />
            </View>
          ) : null}

          {type === 'LIST' ? (
            <View style={styles.detailCard}>
              <Text style={styles.detailLabel}>{t('talkDebug.oneTapListItems', { defaultValue: 'Éléments' })}</Text>
              <View style={styles.listDetailWrap}>
                {listItems.map((raw, ii) => {
                  const ir = raw as Record<string, unknown>;
                  const label = String(ir.name ?? '').trim() || '—';
                  const included = ir.includeInSave !== false;
                  return (
                    <View key={`li-${detailIndex}-${ii}`} style={styles.listDetailRow}>
                      <Pressable
                        style={[styles.listCheck, included ? styles.listCheckOn : null]}
                        onPress={() => !busy && toggleIntentListItemInclude(detailIndex, ii)}
                        disabled={busy}
                      >
                        <Text style={[styles.listCheckText, included ? styles.listCheckTextOn : null]}>{included ? '✓' : ''}</Text>
                      </Pressable>
                      <Text style={styles.listDetailLabel} numberOfLines={1}>
                        {label}
                      </Text>
                      <Pressable
                        style={[styles.listDeleteBtn, busy && styles.disabled]}
                        onPress={() => !busy && removeIntentListItem(detailIndex, ii)}
                        disabled={busy}
                      >
                        <Text style={styles.listDeleteText}>Suppr.</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.detailFooter}>
          <Pressable
            style={[styles.dangerBtn, busy && styles.disabled]}
            onPress={() => {
              runFastLayoutAnim();
              removeIntentAt(detailIndex);
              backToSynthesis();
            }}
            disabled={busy}
          >
            <Text style={styles.dangerBtnText}>{t('common.delete', { defaultValue: 'Supprimer' })}</Text>
          </Pressable>
        </View>
      </>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View
          style={styles.card}
          onLayout={(e) => {
            const w = Math.max(0, Math.round(e.nativeEvent.layout.width));
            if (w && w !== cardWidth) setCardWidth(w);
          }}
        >
          {cardWidth ? (
            <Animated.View
              style={[
                styles.navTrack,
                {
                  width: cardWidth * 2,
                  transform: [{ translateX: navX }],
                },
              ]}
            >
              <View style={[styles.navPane, { width: cardWidth }]}>{renderSynthesisView()}</View>
              <View style={[styles.navPane, { width: cardWidth }]}>{renderDetailView()}</View>
            </Animated.View>
          ) : (
            renderSynthesisView()
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(245,245,247,0.92)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 26,
    padding: 16,
    gap: 8,
    maxHeight: '92%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 2,
  },
  scroll: { maxHeight: '72%' },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  chatTranscript: { fontSize: 15, fontWeight: '600', color: '#0f172a', lineHeight: 20, marginTop: 4, marginBottom: 14 },
  chatDivider: { height: 1, backgroundColor: 'rgba(15,23,42,0.10)', marginBottom: 10 },
  refineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(15,118,110,0.07)',
  },
  refineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0f766e' },
  section: { marginTop: 8, marginBottom: 4 },
  reminderSection: {
    marginTop: 4,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(15,118,110,0.06)',
  },
  reminderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  reminderLine: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  addReminderBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: '#fff',
  },
  addReminderBtnText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#008080', marginBottom: 8 },
  intentCard: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.98)',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  intentHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  intentDeleteBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  intentDeleteMinus: {
    width: 11,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#fff',
  },
  intentType: { fontSize: 12, fontWeight: '900', color: '#0f766e' },
  intentBadge: { fontSize: 12, fontWeight: '800', color: '#475569' },
  intentTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginTop: 6 },
  streamingRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 6 },
  streamingDot: { fontSize: 18, fontWeight: '900', color: '#0f766e', marginHorizontal: 2 },
  listHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 'auto' },
  listStepperInline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  ingredientDeleteBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  listBullet: { fontSize: 14, fontWeight: '900', color: 'rgba(15,23,42,0.25)', marginRight: 8 },
  listItemLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0f172a' },
  listItemQty: { fontSize: 13, fontWeight: '800', color: '#475569', marginLeft: 10 },
  intentLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.70)',
    marginBottom: 14,
  },
  intentLoadingText: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  loadingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  listControlsBelow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  tripAddressRow: { marginTop: 10 },
  intentLoadingInline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  intentLoadingInlineText: { fontSize: 13, fontWeight: '800', color: '#475569' },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 8 },
  input: {
    borderBottomWidth: 1,
    borderColor: 'rgba(15,23,42,0.10)',
    borderRadius: 0,
    paddingHorizontal: 2,
    paddingVertical: 10,
    backgroundColor: 'transparent',
    color: '#0f172a',
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  multilineSm: { minHeight: 64, textAlignVertical: 'top' },
  typeAnchor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: 'rgba(15,23,42,0.10)',
    paddingHorizontal: 2,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  typeAnchorText: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 20, fontWeight: '800', color: '#007AFF' },
  countText: { fontSize: 16, fontWeight: '800', color: '#0f172a', minWidth: 24, textAlign: 'center' },
  unitInput: { flex: 1, minWidth: 0 },
  catBlock: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  catName: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  checkLabelCol: { flex: 1 },
  checkLabel: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  checkSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  logisticsWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  logisticsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  logisticsLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: '#64748b' },
  logisticsTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  logisticsHint: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8 },
  logisticsWarn: { fontSize: 12, fontWeight: '700', color: '#b91c1c', marginTop: 6 },
  logisticsQuota: { fontSize: 12, fontWeight: '700', color: '#0f766e', marginTop: 10 },
  logisticsExhausted: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(244,63,94,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.22)',
  },
  logisticsExhaustedTitle: { fontSize: 13, fontWeight: '800', color: '#b91c1c', marginBottom: 2 },
  logisticsExhaustedDesc: { fontSize: 12, fontWeight: '600', color: '#475569' },
  dateCta: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#008080',
  },
  dateCtaText: { fontSize: 15, fontWeight: '700', color: '#008080', textAlign: 'center' },
  linkish: { alignSelf: 'flex-start', marginTop: 6, marginBottom: 4 },
  linkishText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 8 },
  actionsWithPrint: { justifyContent: 'space-between', flexWrap: 'wrap' },
  actionsSpacer: { flex: 1, minWidth: 8 },
  btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 18 },
  btnPrimary: { backgroundColor: '#007AFF' },
  btnPrimaryText: { fontWeight: '800', color: '#fff' },
  synthHeader: { gap: 10 },
  synthTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a' },
  transcriptCard: {
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(241,245,249,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  transcriptText: { fontSize: 13, fontWeight: '600', color: '#0f172a', lineHeight: 18 },
  synthScroll: { flex: 1 },
  intentList: { marginTop: 14, gap: 10 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: 'rgba(60,60,67,0.60)',
    paddingHorizontal: 2,
  },
  summaryCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    overflow: 'hidden',
  },
  navTrack: { flexDirection: 'row' },
  navPane: { flex: 1 },
  intentItem: {},
  intentItemSep: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(60,60,67,0.18)' },
  intentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  intentIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(15,23,42,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  intentCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '900' },
  intentRowTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0f172a', minWidth: 0 },
  tripBlock: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 0,
    gap: 10,
  },
  tripLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(15,23,42,0.60)' },
  tripAddressInput: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#F2F2F7',
    color: '#0f172a',
  },
  tripSegmentWrap: {
    flexDirection: 'row',
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.06)',
    padding: 3,
    gap: 4,
  },
  tripSegment: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripSegmentActive: { backgroundColor: '#fff' },
  tripSegmentText: { fontSize: 12, fontWeight: '800', color: 'rgba(15,23,42,0.55)', textAlign: 'center' },
  tripSegmentTextActive: { color: '#0f172a' },
  emptyState: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(241,245,249,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  emptyText: { fontSize: 14, fontWeight: '700', color: 'rgba(15,23,42,0.70)' },
  synthBottomPad: { height: 10 },
  synthFooter: { gap: 10, marginTop: 10 },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 0.3 },
  secondaryBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10 },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: 'rgba(15,23,42,0.55)' },
  detailEmpty: { flex: 1 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6 },
  backBtnText: { fontSize: 22, fontWeight: '900', color: '#007AFF', marginTop: -1 },
  backBtnLabel: { fontSize: 14, fontWeight: '800', color: '#007AFF' },
  detailTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '900', color: '#0f172a' },
  detailHeaderSpacer: { width: 56 },
  detailScroll: { flex: 1 },
  detailCard: {
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(241,245,249,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    marginTop: 10,
    gap: 8,
  },
  detailLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(15,23,42,0.60)' },
  detailValue: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  detailInput: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  listDetailWrap: { gap: 10, marginTop: 2 },
  listDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listCheck: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  listCheckOn: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  listCheckText: { fontSize: 13, fontWeight: '900', color: 'transparent' },
  listCheckTextOn: { color: '#fff' },
  listDetailLabel: { flex: 1, fontSize: 14, fontWeight: '800', color: '#0f172a' },
  listDeleteBtn: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10, backgroundColor: 'rgba(255,59,48,0.10)' },
  listDeleteText: { fontSize: 12, fontWeight: '900', color: '#ff3b30' },
  detailFooter: { marginTop: 10 },
  dangerBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,59,48,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerBtnText: { fontSize: 14, fontWeight: '900', color: '#ff3b30' },
  disabled: { opacity: 0.45 },
});
