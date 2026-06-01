import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import {
  countTrankilV2RootTodoTasksDueOnLocalDate,
  getFreeCaptureQuotaSnapshot,
  getTrankilV2IntentionById,
  getTrankilV2UnorganizedCount,
  listTrankilV2MergedTodayTimelineWithLowPressure,
  listTrankilV2PinnedIntentions,
  type TrankilIntentStatus,
} from '../api/trankilV2Db';
import { MAX_PINS_COUNT } from '../config/appConfig';
import {
  CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH_EVENT_NAME,
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTION_PEEK_SNAPSHOT_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import { logCaptureFlow } from '../utils/captureFlowLog';
import {
  buildPeekPendingRowFromSnapshot,
  capturePeekPathAHeightPx,
  capturePeekPathBHeightPx,
  CAPTURE_SHEET_FULL_MAX_RATIO,
} from '../utils/capturePeekLayout';
import { getIntentionColor } from '../utils/intentionColorHash';
import { mapTrankilIntentionToTimelineItemRow, type TrankilV2TimelineItemRow } from '../api';
import { resolveTalkDebugSuggestionsBottomOffset, TALK_DEBUG_MIC_DOCK_MIN_HEIGHT } from '../constants/captureOverlayLayout';
import { useCapturePresentation } from '../context/CapturePresentationContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { DealerBoard } from '../components/DealerBoard';
import { SentinelFocusBadge } from '../components/SentinelFocusBadge';
import { IntentionSuggestionsBanner } from '../components/IntentionSuggestionsBanner';
import { IntentionDetailSheet } from '../components/IntentionDetailSheet';
import { PilotStatusHeader } from '../components/PilotStatusHeader';
import { formatYmdLocal } from '../services/TimeSorter';
import { resolveSpeechLangForSession } from '../utils/speechLocale';
import type { AppTabParamList } from '../navigation/types';
import { useOptionalIntentionContext } from '../context/IntentionContext';
import { useDesignTokens } from '../hooks/useDesignTokens';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import { formatCreationSubtitle } from '../utils/timeFormat';

/**
 * Écran **Talk / Debug** : Phoenix texte + micro global → `IntentionContext.submitCapturePayload` (Bulk(1)),
 * événements peek (`INTENTION_PEEK_*`).
 *
 * @module TalkDebugScreen
 */

function normalizeCategoryId(raw: unknown): string {
  const up = String(raw ?? '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) return up;
  return 'PERSO';
}

type TalkPeekBulkItem = {
  intentionId: string;
  title: string;
  categoryTag: string;
  predictedType: string;
};

function normalizeTalkPeekBulkItems(p: {
  intentionId?: unknown;
  title?: unknown;
  categoryTag?: unknown;
  predictedType?: unknown;
  dealerBulkItems?: unknown;
}): TalkPeekBulkItem[] {
  const bulk = p.dealerBulkItems;
  if (Array.isArray(bulk) && bulk.length > 0) {
    return bulk
      .map((b: unknown) => {
        const o = b as Record<string, unknown>;
        return {
          intentionId: String(o?.intentionId ?? '').trim(),
          title: String(o?.title ?? ''),
          categoryTag: String(o?.categoryTag ?? '').trim(),
          predictedType: String(o?.predictedType ?? '').trim(),
        };
      })
      .filter((r) => r.intentionId.length > 0)
      .slice(0, 8);
  }
  const intentionId = String(p?.intentionId ?? '').trim();
  if (!intentionId) return [];
  return [
    {
      intentionId,
      title: String(p?.title ?? ''),
      categoryTag: String(p?.categoryTag ?? '').trim(),
      predictedType: String(p?.predictedType ?? '').trim(),
    },
  ];
}

function buildPreviewRowFromBulkItem(
  it: TalkPeekBulkItem,
  contentRaw: string,
  untitled: string,
): TrankilV2TimelineItemRow {
  const categoryId = normalizeCategoryId(it.categoryTag);
  const rawType = String(it.predictedType ?? 'NOTE').trim().toUpperCase();
  const allowed = new Set(['TASK', 'NOTE', 'HABIT', 'LIST', 'TRIP', 'PROJECT', 'AUDIO']);
  const type = (allowed.has(rawType) ? rawType : 'NOTE') as TrankilV2TimelineItemRow['type'];
  const title = String(it.title ?? '').trim();
  return {
    id: it.intentionId,
    type,
    category_id: categoryId,
    display_title: title || untitled,
    content_raw: contentRaw,
    due_date: null,
    metadata_json: '{}',
    status: 'TODO',
    created_at: Date.now(),
    updated_at: Date.now(),
    is_archived: 0,
    is_dirty: 0,
  } as unknown as TrankilV2TimelineItemRow;
}

/** Écran principal onglet Talk : capture, quotas, suggestions, feuille détail peek/full. */
export function TalkDebugScreen() {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const intentionFlow = useOptionalIntentionContext();
  const {
    setPresentation,
    resetPresentation,
    registerOverlayLifecycleHandlers,
    isPipelineOverlayVisible,
    pipelineOverlayVisibleRef,
    captureRecordingActive,
  } = useCapturePresentation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const designTokens = useDesignTokens();
  const navigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const [detailOpen, setDetailOpen] = useState(false);
  const [peekDetailRows, setPeekDetailRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [selectedIntentionIndex, setSelectedIntentionIndex] = useState(0);
  const [detailPosition, setDetailPosition] = useState<'peek' | 'full'>('full');
  const [detailPeekHeightPx, setDetailPeekHeightPx] = useState(() => capturePeekPathAHeightPx());
  const [peekCapturePhase, setPeekCapturePhase] = useState<'idle' | 'path_a' | 'path_b'>('idle');
  const [phoenixInput, setPhoenixInput] = useState('');
  const [phoenixSubmitting, setPhoenixSubmitting] = useState(false);
  const [freeQuotaSnapshot, setFreeQuotaSnapshot] = useState<{ remaining: number; max: number } | null>(null);
  const [todayTodoCount, setTodayTodoCount] = useState(0);
  const [headerUnorganizedCount, setHeaderUnorganizedCount] = useState(0);
  const [pinnedRows, setPinnedRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [todayFocusRows, setTodayFocusRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [sacredDetailOpen, setSacredDetailOpen] = useState(false);
  const [sacredDetailRow, setSacredDetailRow] = useState<TrankilV2TimelineItemRow | null>(null);

  useFocusEffect(
    useCallback(() => {
      setPresentation({
        variant: 'talkDebug',
        compact: false,
        dashboardPipelineHost: true,
        micHidden: false,
        waveformA11yLabel: t('talkDebug.voiceWaveformA11y'),
        lockedHintText: t('talkDebug.micQuotaUpsellHint'),
      });
      const unregister = registerOverlayLifecycleHandlers({
        onPipelineSprintComplete: () => setSelectedIntentionIndex(0),
      });
      return () => {
        unregister();
        resetPresentation();
      };
    }, [registerOverlayLifecycleHandlers, resetPresentation, setPresentation, t]),
  );

  useEffect(() => {
    setPresentation({ disabled: phoenixSubmitting });
  }, [phoenixSubmitting, setPresentation]);

  const refreshPilotHeader = useCallback(async () => {
    const ymd = formatYmdLocal(new Date());
    const status: TrankilIntentStatus = 'TODO';
    const [unorg, todayN, snap, pinned, todayTimeline] = await Promise.all([
      getTrankilV2UnorganizedCount(),
      countTrankilV2RootTodoTasksDueOnLocalDate(ymd),
      spectrum.isProUser ? Promise.resolve(null) : getFreeCaptureQuotaSnapshot(),
      listTrankilV2PinnedIntentions(MAX_PINS_COUNT),
      listTrankilV2MergedTodayTimelineWithLowPressure(ymd, status, 'ALL', { limit: 200, offset: 0 }),
    ]);
    setHeaderUnorganizedCount(unorg);
    setTodayTodoCount(todayN);
    setPinnedRows(pinned.map(mapTrankilIntentionToTimelineItemRow));
    setTodayFocusRows(todayTimeline);
    if (snap) {
      setFreeQuotaSnapshot({ remaining: snap.remaining, max: snap.max });
    } else {
      setFreeQuotaSnapshot(null);
    }
  }, [spectrum.isProUser]);

  useFocusEffect(
    useCallback(() => {
      void refreshPilotHeader();
    }, [refreshPilotHeader]),
  );

  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => void refreshPilotHeader()),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [refreshPilotHeader]);

  const detailRow = useMemo(() => {
    if (peekDetailRows.length === 0) return null;
    const i = Math.min(Math.max(0, selectedIntentionIndex), peekDetailRows.length - 1);
    return peekDetailRows[i] ?? null;
  }, [peekDetailRows, selectedIntentionIndex]);

  const intentionMixAccentColor = useMemo(() => {
    const title = String(detailRow?.display_title ?? '').trim();
    return title.length > 0 ? getIntentionColor(title) : null;
  }, [detailRow?.display_title]);

  useEffect(() => {
    const n = peekDetailRows.length;
    if (n === 0) {
      setSelectedIntentionIndex(0);
      return;
    }
    setSelectedIntentionIndex((i) => Math.min(Math.max(0, i), n - 1));
  }, [peekDetailRows.length]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setPeekDetailRows([]);
    setSelectedIntentionIndex(0);
    setDetailPosition('full');
    setDetailPeekHeightPx(capturePeekPathAHeightPx());
    setPeekCapturePhase('idle');
  }, []);

  const openFocusTripDetail = useCallback((row: TrankilV2TimelineItemRow) => {
    setSacredDetailRow(row);
    setSacredDetailOpen(true);
  }, []);

  const closeSacredDetail = useCallback(() => {
    setSacredDetailOpen(false);
    setSacredDetailRow(null);
  }, []);

  const openSacredDetail = useCallback((r: TrankilV2TimelineItemRow) => {
    setSacredDetailRow(r);
    setSacredDetailOpen(true);
  }, []);

  const patchSacredDetailRow = useCallback((id: string, patch: Partial<TrankilV2TimelineItemRow>) => {
    setPinnedRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setSacredDetailRow((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
    if (patch.is_pinned === 0) {
      setPinnedRows((prev) => prev.filter((r) => r.id !== id));
      setSacredDetailOpen(false);
      setSacredDetailRow(null);
    }
  }, []);

  const patchPeekDetailRow = useCallback((id: string, patch: Partial<TrankilV2TimelineItemRow>) => {
    setPeekDetailRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const applyPeekFirstSavePayload = useCallback((payload: unknown) => {
    const p = payload as {
      intentionId?: unknown;
      title?: unknown;
      transcript?: unknown;
      categoryTag?: unknown;
      predictedType?: unknown;
      dealerBulkItems?: unknown;
    };
    const items = normalizeTalkPeekBulkItems(p);
    if (items.length === 0) return;
    const primaryId = String(p?.intentionId ?? items[0].intentionId).trim();
    const transcript = String(p?.transcript ?? '').trim();
    const untitled = t('timeline.untitled');
    const rows = items.map((it) =>
      buildPreviewRowFromBulkItem(it, it.intentionId === primaryId ? transcript : '', untitled),
    );
    setPeekCapturePhase('path_b');
    setDetailPeekHeightPx(capturePeekPathBHeightPx());
    setPeekDetailRows(rows);
    setSelectedIntentionIndex(0);
    setDetailPosition('peek');
    setDetailOpen(true);
    items.forEach((it) => {
      void (async () => {
        const full = await getTrankilV2IntentionById(it.intentionId);
        if (!full) return;
        const mapped = mapTrankilIntentionToTimelineItemRow(full);
        setPeekDetailRows((prev) => prev.map((x) => (x.id === it.intentionId ? mapped : x)));
      })();
    });
  }, [t]);

  useEffect(() => {
    if (isFocused) return;
    const inCapturePeekFlow =
      peekCapturePhase !== 'idle' || peekDetailRows.some((r) => r.id === 'peek_pending');
    if (!detailOpen || !inCapturePeekFlow) return;
    closeDetail();
  }, [closeDetail, detailOpen, isFocused, peekCapturePhase, peekDetailRows]);

  useEffect(() => {
    const dashboardBalletLocksPeekUi = () => isPipelineOverlayVisible || pipelineOverlayVisibleRef.current;

    const subSnap = DeviceEventEmitter.addListener(INTENTION_PEEK_SNAPSHOT_EVENT_NAME, (payload) => {
      if (!isFocusedRef.current) return;
      if (dashboardBalletLocksPeekUi()) return;
      const peekRow = buildPeekPendingRowFromSnapshot(
        payload as { categoryTag?: unknown; predictedType?: unknown; title?: unknown },
        normalizeCategoryId,
      );
      setPeekDetailRows([peekRow]);
      setSelectedIntentionIndex(0);
      setDetailPosition('peek');
      setDetailPeekHeightPx(capturePeekPathAHeightPx());
      setPeekCapturePhase('path_a');
      setDetailOpen(true);
    });
    const subFirstSave = DeviceEventEmitter.addListener(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, (payload) => {
      if (!isFocusedRef.current) return;
      if (dashboardBalletLocksPeekUi()) return;
      applyPeekFirstSavePayload(payload);
    });
    const subDeferred = DeviceEventEmitter.addListener(
      CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH_EVENT_NAME,
      (payload) => {
        if (!isFocusedRef.current) return;
        applyPeekFirstSavePayload(payload);
      },
    );
    return () => {
      subSnap.remove();
      subFirstSave.remove();
      subDeferred.remove();
    };
  }, [applyPeekFirstSavePayload, isPipelineOverlayVisible, pipelineOverlayVisibleRef]);

  const onSubmitPhoenix = useCallback(async () => {
    const transcript = phoenixInput.trim();
    if (!transcript) return;
    if (!intentionFlow) {
      Alert.alert('Capture', 'IntentionProvider manquant (Dev Client requis).');
      return;
    }
    setPhoenixSubmitting(true);
    try {
      intentionFlow.startCapture();
      logCaptureFlow(undefined, 'phoenix_submit_invoke', { transcriptLen: transcript.length });
      await intentionFlow.submitCapturePayload({ transcript, audioUri: null, lang: resolveSpeechLangForSession(i18n.language) });
      setPhoenixInput('');
    } catch (e) {
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    } finally {
      setPhoenixSubmitting(false);
    }
  }, [i18n.language, intentionFlow, phoenixInput]);

  return (
    <View style={[styles.root, { backgroundColor: designTokens.backgroundColor }]}>
      <IntentionDetailSheet
        visible={detailOpen}
        row={detailRow}
        theme={theme}
        onClose={closeDetail}
        onPatchRow={patchPeekDetailRow}
        initialPosition={detailPosition}
        peekHeightPx={detailPeekHeightPx}
        validationMode
        peekCapturePhase={peekCapturePhase}
        captureSheetMaxHeightRatio={peekCapturePhase !== 'idle' ? CAPTURE_SHEET_FULL_MAX_RATIO : undefined}
        intentionMixAccentColor={intentionMixAccentColor}
        morphSheetContentOnIntentionChange={peekDetailRows.length > 1}
      />
      <IntentionDetailSheet
        visible={sacredDetailOpen}
        row={sacredDetailRow}
        theme={theme}
        onClose={closeSacredDetail}
        onPatchRow={patchSacredDetailRow}
        initialPosition="full"
      />
      <View style={[styles.headerSafe, { paddingTop: Math.max(insets.top, 6) }]}>
        <View style={styles.phoenixRow}>
          <TextInput
            value={phoenixInput}
            onChangeText={setPhoenixInput}
            placeholder="Tape ton intention ici..."
            placeholderTextColor={designTokens.textSecondary}
            style={[
              styles.phoenixInput,
              {
                color: designTokens.textPrimary,
                backgroundColor: designTokens.cardBackground,
                borderColor: designTokens.textSecondary,
                borderRadius: designTokens.borderRadius * 0.75,
              },
            ]}
            editable={!phoenixSubmitting}
            returnKeyType="send"
            onSubmitEditing={() => void onSubmitPhoenix()}
          />
          <TouchableOpacity
            style={[
              styles.phoenixSendBtn,
              {
                backgroundColor: designTokens.accentColor,
                borderRadius: designTokens.borderRadius * 0.75,
              },
              phoenixSubmitting ? styles.disabled : null,
            ]}
            onPress={() => void onSubmitPhoenix()}
            disabled={phoenixSubmitting}
            activeOpacity={0.8}
          >
            <Text style={[styles.phoenixSendText, { color: '#FFFFFF' }]}>Envoyer</Text>
          </TouchableOpacity>
        </View>
        <PilotStatusHeader
          variant="talkDebug"
          isProUser={spectrum.isProUser}
          freeRemaining={freeQuotaSnapshot?.remaining ?? 0}
          freeMax={freeQuotaSnapshot?.max ?? 3}
          dayOfMonth={new Date().getDate()}
          todayTodoCount={todayTodoCount}
          piggyCount={headerUnorganizedCount}
          onPressCredits={() => {
            if (rootNavigationRef.isReady()) {
              rootNavigationRef.navigate('ProSubscription');
            }
          }}
          onPressCalendar={() =>
            navigation.navigate('Timeline', {
              initialTimeNav: 'TODAY',
              initialContext: 'ALL',
            })
          }
          onPressPiggy={() =>
            navigation.navigate('Timeline', {
              initialTimeNav: 'TODAY',
              initialContext: 'PIGGY',
            })
          }
          translate={t}
        />
        {pinnedRows.length > 0 ? (
          <View style={styles.sacredSpace}>
            <Text style={[styles.sacredTitle, { color: designTokens.textSecondary }]}>
              {t('talkDebug.sacredSpace.title')}
            </Text>
            {pinnedRows.map((r) => {
              const title = String(r.display_title ?? '').trim() || t('timeline.untitled');
              const rel = formatCreationSubtitle(Number(r.created_at), t, i18n.language);
              return (
                <Pressable
                  key={r.id}
                  onPress={() => openSacredDetail(r)}
                  style={({ pressed }) => [styles.sacredRow, { opacity: pressed ? 0.82 : 1 }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.sacredPin, { color: designTokens.textPrimary }]}>📌</Text>
                  <Text style={[styles.sacredText, { color: designTokens.textPrimary }]} numberOfLines={1}>
                    {title}
                    {rel ? (
                      <Text style={[styles.sacredDate, { color: designTokens.textSecondary }]}> ({rel})</Text>
                    ) : null}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.middleSpacer} />

      <View style={styles.sentinelFocusDock}>
        <SentinelFocusBadge
          rows={todayFocusRows}
          todayYmd={formatYmdLocal(new Date())}
          theme={theme}
          onOpenDetail={openFocusTripDetail}
          onOpenProPaywall={() => {
            if (rootNavigationRef.isReady()) {
              rootNavigationRef.navigate('ProSubscription');
            }
          }}
        />
      </View>

      <IntentionSuggestionsBanner
        visible={!captureRecordingActive && !isPipelineOverlayVisible}
        bottomOffset={resolveTalkDebugSuggestionsBottomOffset()}
      />

      <View style={styles.bottomSpacer} />

      <DealerBoard
        selectedIntentionIndex={selectedIntentionIndex}
        onSelectIntentionIndex={setSelectedIntentionIndex}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerSafe: { paddingHorizontal: 16, paddingBottom: 8 },
  phoenixRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  phoenixInput: {
    flex: 1,
    fontSize: 15,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '700',
  },
  phoenixSendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  phoenixSendText: { fontSize: 14, fontWeight: '900' },
  sacredSpace: { marginTop: 6, gap: 4 },
  sacredTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 },
  sacredRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  sacredPin: { fontSize: 14, width: 20, textAlign: 'center' },
  sacredText: { flex: 1, fontSize: 14, fontWeight: '600' },
  sacredDate: { fontWeight: '500', fontSize: 13 },
  middleSpacer: { flex: 1, minHeight: 0 },
  sentinelFocusDock: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  bottomSpacer: { minHeight: TALK_DEBUG_MIC_DOCK_MIN_HEIGHT },
  disabled: { opacity: 0.5 },
});
