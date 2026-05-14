import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  DeviceEventEmitter,
  LayoutAnimation,
  Platform,
  StyleSheet,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTION_PEEK_SNAPSHOT_EVENT_NAME,
  MICRO_CAPTURE_START_EVENT_NAME,
} from '../constants/intentionEvents';

import { computeDealerBalletSlots, dealerPortraitMetrics } from './dealerBalletLayout';
import { DealerMaterializeCard } from './DealerMaterializeCard';
import { getIntentionColor } from '../utils/intentionColorHash';

type DealerBulkPeekItem = {
  intentionId: string;
  title: string;
  categoryTag: string;
  predictedType: string;
};

type PeekFirstSavePayload = {
  intentionId?: unknown;
  categoryTag?: unknown;
  predictedType?: unknown;
  title?: unknown;
  transcript?: unknown;
  dealerBulkItems?: DealerBulkPeekItem[];
};

type PeekSnapshotPayload = {
  categoryTag?: unknown;
  predictedType?: unknown;
  title?: unknown;
  /** Dictée brute (Path A) — mot-clé fantôme DealerBoard (regex dernier mot). */
  transcript?: unknown;
};

/** Dernier mot = dernière suite de non-blancs en fin de chaîne (titres FR / ponctuation). */
const LAST_WORD_REGEX = /(\S+)\s*$/u;

export function extractLastWordFromTitle(title: string): string {
  const t = title.trim();
  if (!t) return '—';
  return t.match(LAST_WORD_REGEX)?.[1] ?? '—';
}

/** Dernier mot du transcript brut (Path A) — même regex que le titre pour cohérence visuelle. */
export function extractLastWordFromTranscript(transcript: string): string {
  const t = String(transcript || '').trim();
  if (!t) return '';
  return t.match(LAST_WORD_REGEX)?.[1] ?? '';
}

type DealerBoardCard = {
  id: string;
  slotKey: string;
  intentionId?: string;
  title: string;
  categoryTag: string;
  predictedType: string;
  lastWord: string;
  materialized: boolean;
  validated: boolean;
  peekSnapshotRise: boolean;
  archived?: boolean;
};

const MAX_CARDS = 8;
const DEALER_IDLE_SUCTION_MS = 30000;
const MATERIALIZE_SETTLE_MS = 520;

function configureDealerLayoutAnimation() {
  LayoutAnimation.configureNext({
    duration: 320,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

function fallbackBadgeDelta(width: number, height: number, insetTop: number): { dx: number; dy: number } {
  const margin = 14;
  const pillHalfW = 30;
  const bx = width - margin - pillHalfW;
  const by = insetTop + 40;
  const cx = width / 2;
  const cy = height / 2;
  return { dx: bx - cx, dy: by - cy };
}

function normalizeDealerRows(p: PeekFirstSavePayload): DealerBulkPeekItem[] {
  const bulk = p.dealerBulkItems;
  if (bulk && bulk.length > 0) {
    return bulk
      .map((b) => ({
        intentionId: String(b.intentionId ?? '').trim(),
        title: String(b.title ?? ''),
        categoryTag: String(b.categoryTag ?? '').trim(),
        predictedType: String(b.predictedType ?? '').trim(),
      }))
      .filter((r) => r.intentionId.length > 0);
  }
  const intentionId = String(p.intentionId ?? '').trim();
  if (!intentionId) return [];
  return [
    {
      intentionId,
      title: String(p.title ?? ''),
      categoryTag: String(p.categoryTag ?? '').trim(),
      predictedType: String(p.predictedType ?? '').trim(),
    },
  ];
}

/**
 * Calque Talk — identité **Matérialisation** : fantôme sur `INTENTION_PEEK_SNAPSHOT`, ballet + remplissage sur
 * `INTENTION_PEEK_FIRST_SAVE`, aspiration NEW. Proxies uniquement (pas de SQLite).
 */
export type DealerBoardProps = {
  /** Index de l’intention active (mixeur Talk ↔ feuille). */
  selectedIntentionIndex?: number;
  onSelectIntentionIndex?: (index: number) => void;
};

export function DealerBoard({
  selectedIntentionIndex = 0,
  onSelectIntentionIndex,
}: DealerBoardProps = {}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [cards, setCards] = useState<DealerBoardCard[]>([]);
  const [materializeWave, setMaterializeWave] = useState(0);
  const [suctionWave, setSuctionWave] = useState(0);
  const [suctionMode, setSuctionMode] = useState<'timer' | 'micro'>('timer');
  const [badgeDelta, setBadgeDelta] = useState<{ dx: number; dy: number } | null>(null);
  const [peekTick, setPeekTick] = useState(0);

  const idleSuctionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const materializeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeMeasureRef = useRef<View>(null);

  const activeCards = useMemo(() => cards.filter((c) => !c.archived), [cards]);
  const activeRef = useRef(activeCards);
  activeRef.current = activeCards;

  const { cw, ch } = useMemo(() => dealerPortraitMetrics(windowWidth), [windowWidth]);
  const balletSlots = useMemo(
    () => computeDealerBalletSlots(Math.min(activeCards.length, MAX_CARDS), cw, ch),
    [activeCards.length, cw, ch],
  );

  const clearIdleSuctionTimer = useCallback(() => {
    if (idleSuctionTimerRef.current) {
      clearTimeout(idleSuctionTimerRef.current);
      idleSuctionTimerRef.current = null;
    }
  }, []);

  const clearMaterializeTimer = useCallback(() => {
    if (materializeTimerRef.current) {
      clearTimeout(materializeTimerRef.current);
      materializeTimerRef.current = null;
    }
  }, []);

  const resolvedTarget = badgeDelta ?? fallbackBadgeDelta(windowWidth, windowHeight, insets.top);

  const triggerSuction = useCallback((mode: 'timer' | 'micro') => {
    setSuctionMode(mode);
    setSuctionWave((w) => w + 1);
  }, []);

  const measureBadge = useCallback(() => {
    badgeMeasureRef.current?.measureInWindow((x, y, w, h) => {
      const cx = windowWidth / 2;
      const cy = windowHeight / 2;
      const bx = x + w / 2;
      const by = y + h / 2;
      setBadgeDelta({ dx: bx - cx, dy: by - cy });
    });
  }, [windowHeight, windowWidth]);

  const markDealerProxyArchivedLocally = useCallback((id: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, archived: true } : c)));
  }, []);

  const onMaterialized = useCallback((id: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, materialized: true } : c)));
  }, []);

  const onValidated = useCallback((id: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, validated: true } : c)));
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTION_PEEK_SNAPSHOT_EVENT_NAME, (raw: unknown) => {
      const p = raw as PeekSnapshotPayload;
      configureDealerLayoutAnimation();
      clearMaterializeTimer();
      clearIdleSuctionTimer();
      setMaterializeWave(0);
      setSuctionWave(0);
      const categoryTag = String(p?.categoryTag ?? '');
      const predictedType = String(p?.predictedType ?? '');
      const rawTs = String(p?.transcript ?? '').trim();
      const kwFromTranscript = extractLastWordFromTranscript(rawTs);
      const titleStr = String(p?.title ?? '');
      const lastWordGhost = kwFromTranscript || extractLastWordFromTitle(titleStr);
      setCards([
        {
          id: 'peek-ghost',
          slotKey: 'slot-0',
          intentionId: undefined,
          title: titleStr,
          categoryTag,
          predictedType,
          lastWord: lastWordGhost || '—',
          materialized: false,
          validated: false,
          peekSnapshotRise: true,
        },
      ]);
    });
    return () => sub.remove();
  }, [clearIdleSuctionTimer, clearMaterializeTimer]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, (raw: unknown) => {
      const p = raw as PeekFirstSavePayload;
      const rows = normalizeDealerRows(p);
      if (rows.length === 0) return;
      configureDealerLayoutAnimation();
      clearMaterializeTimer();
      setMaterializeWave(0);
      const mapped: DealerBoardCard[] = rows.slice(0, MAX_CARDS).map((r, i) => ({
        id: r.intentionId,
        slotKey: `slot-${i}`,
        intentionId: r.intentionId,
        title: r.title,
        categoryTag: r.categoryTag,
        predictedType: r.predictedType,
        lastWord: extractLastWordFromTitle(r.title),
        materialized: false,
        validated: false,
        peekSnapshotRise: false,
      }));
      setCards(mapped);
      materializeTimerRef.current = setTimeout(() => {
        materializeTimerRef.current = null;
        setMaterializeWave((w) => w + 1);
      }, MATERIALIZE_SETTLE_MS);
      setPeekTick((t) => t + 1);
    });
    return () => {
      sub.remove();
      clearMaterializeTimer();
    };
  }, [clearMaterializeTimer]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(MICRO_CAPTURE_START_EVENT_NAME, () => {
      clearIdleSuctionTimer();
      if (activeRef.current.length === 0) return;
      triggerSuction('micro');
    });
    return () => sub.remove();
  }, [clearIdleSuctionTimer, triggerSuction]);

  useEffect(() => {
    if (activeCards.length === 0) {
      clearIdleSuctionTimer();
      clearMaterializeTimer();
      setSuctionWave(0);
      setMaterializeWave(0);
      setCards((prev) => (prev.some((c) => c.archived) ? prev.filter((c) => !c.archived) : prev));
    }
  }, [activeCards.length, clearIdleSuctionTimer, clearMaterializeTimer]);

  useEffect(() => {
    if (activeRef.current.length === 0) return;
    clearIdleSuctionTimer();
    idleSuctionTimerRef.current = setTimeout(() => {
      idleSuctionTimerRef.current = null;
      triggerSuction('timer');
    }, DEALER_IDLE_SUCTION_MS);
    return clearIdleSuctionTimer;
  }, [peekTick, clearIdleSuctionTimer, triggerSuction]);

  const fromEnterY = Math.min(windowHeight * 0.62, windowHeight - insets.bottom - 40);

  return (
    <View pointerEvents="box-none" style={styles.layer} collapsable={false}>
      <View
        ref={badgeMeasureRef}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.badgeGhost, { top: insets.top + 4, right: 12 }]}
        onLayout={measureBadge}
      />
      <View pointerEvents="none" style={styles.deckSlot}>
        {activeCards.map((c, index) => {
          const slot = balletSlots[index] ?? { dx: 0, dy: 0 };
          const titleAccent = getIntentionColor(c.title);
          const selected = index === selectedIntentionIndex;
          const canPress = typeof onSelectIntentionIndex === 'function';
          return (
            <View key={c.slotKey} style={[styles.cardAnchor, { zIndex: index + 1 }]}>
              <Pressable
                disabled={!canPress}
                onPress={() => onSelectIntentionIndex?.(index)}
                style={[styles.cardHit, { width: cw, height: ch }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                hitSlop={8}
              >
                <DealerMaterializeCard
                  cardId={c.id}
                  slotKey={c.slotKey}
                  slotDx={slot.dx}
                  slotDy={slot.dy}
                  cw={cw}
                  ch={ch}
                  peekSnapshotRise={c.peekSnapshotRise}
                  fromEnterY={fromEnterY}
                  categoryTag={c.categoryTag}
                  predictedType={c.predictedType}
                  titleAccentColor={titleAccent}
                  selected={selected}
                  lastWord={c.lastWord}
                  materialized={c.materialized}
                  validated={c.validated}
                  materializeWave={materializeWave}
                  onMaterialized={onMaterialized}
                  onValidated={onValidated}
                  suctionWave={suctionWave}
                  suctionMode={suctionMode}
                  badgeTargetDx={resolvedTarget.dx}
                  badgeTargetDy={resolvedTarget.dy}
                  staggerIndex={index}
                  onSuctionArrived={markDealerProxyArchivedLocally}
                />
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 400,
  },
  badgeGhost: {
    position: 'absolute',
    width: 56,
    height: 28,
    opacity: 0,
  },
  deckSlot: {
    ...StyleSheet.absoluteFillObject,
  },
  cardAnchor: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHit: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
