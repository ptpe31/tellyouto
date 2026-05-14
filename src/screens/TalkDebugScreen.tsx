import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
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
} from '../api/trankilV2Db';
import {
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTION_PEEK_SNAPSHOT_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import { logCaptureFlow, CAPTURE_PIPELINE_PROGRESS_EVENT, type CapturePipelineProgressPayload } from '../utils/captureFlowLog';
import {
  buildPeekPendingRowFromSnapshot,
  capturePeekPathAHeightPx,
  capturePeekPathBHeightPx,
  CAPTURE_SHEET_FULL_MAX_RATIO,
} from '../utils/capturePeekLayout';
import { getIntentionColor } from '../utils/intentionColorHash';
import { mapTrankilIntentionToTimelineItemRow, type TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { DealerBoard } from '../components/DealerBoard';
import { IntentionSuggestionsBanner } from '../components/IntentionSuggestionsBanner';
import { PassProModal } from '../components/PassProModal';
import { AIUniversalProgressOverlay } from '../components/AIUniversalProgressOverlay';
import { TalkCaptureMicButton, type TalkCaptureEndPayload, type TalkCaptureMicButtonHandle } from '../components/TalkCaptureMicButton';
import { IntentionDetailSheet } from '../components/IntentionDetailSheet';
import { PilotStatusHeader } from '../components/PilotStatusHeader';
import { formatYmdLocal } from '../services/TimeSorter';
import { resolveSpeechLangForSession } from '../utils/speechLocale';
import type { AppTabParamList } from '../navigation/types';
import { useOptionalIntentionContext } from '../context/IntentionContext';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import {
  AI_PROGRESS_FINAL_SPRINT_MS,
  AI_PROGRESS_INERTIA_TOTAL_MS,
  AI_PROGRESS_REVEAL_HOLD_MS,
  useAIProgressInertia,
} from '../hooks/useAIProgressInertia';

/**
 * Écran **Talk / Debug** : Phoenix texte + micro → `IntentionContext.submitCapturePayload` (Bulk(1)),
 * événements peek (`INTENTION_PEEK_*`). Le pipeline complet vit dans `TalkCaptureMicButton` + contexte.
 *
 * @module TalkDebugScreen
 */

/** Horodatage perf cohérent avec les logs `[OneTapPerf]` (T0, etc.). */
function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Normalise un tag catégorie UI vers les codes domaine SQLite (fallback `PERSO`). */
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
  const [passProVisible, setPassProVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const [detailOpen, setDetailOpen] = useState(false);
  const [peekDetailRows, setPeekDetailRows] = useState<TrankilV2TimelineItemRow[]>([]);
  const [selectedIntentionIndex, setSelectedIntentionIndex] = useState(0);
  const setSelectedIntentionIndexRef = useRef<(n: number) => void>(() => {});
  const [detailPosition, setDetailPosition] = useState<'peek' | 'full'>('full');
  const [detailPeekHeightPx, setDetailPeekHeightPx] = useState(() => capturePeekPathAHeightPx());
  const [peekCapturePhase, setPeekCapturePhase] = useState<'idle' | 'path_a' | 'path_b'>('idle');
  const [phoenixInput, setPhoenixInput] = useState('');
  const [phoenixSubmitting, setPhoenixSubmitting] = useState(false);
  const [captureStep, setCaptureStep] = useState<'idle' | 'recording'>('idle');
  const [freeQuotaSnapshot, setFreeQuotaSnapshot] = useState<{ remaining: number; max: number } | null>(null);
  const [todayTodoCount, setTodayTodoCount] = useState(0);
  const [headerUnorganizedCount, setHeaderUnorganizedCount] = useState(0);

  const micRef = useRef<TalkCaptureMicButtonHandle | null>(null);
  const [pipelineModalVisible, setPipelineModalVisible] = useState(false);
  /** Titre « Terminé » pendant le sprint final vers 100 %. */
  const [pipelineDashTitleComplete, setPipelineDashTitleComplete] = useState(false);
  const [pipelineResilienceOrange, setPipelineResilienceOrange] = useState(false);
  const pipelineResilienceOrangeRef = useRef(false);
  const pipelineModalVisibleRef = useRef(false);
  const pendingPeekFirstSavePayloadRef = useRef<unknown>(null);
  const applyPeekFirstSavePayloadRef = useRef<(payload: unknown) => void>(() => {});
  const pipelineActiveTraceRef = useRef<string | null>(null);
  const pipelineOrangeNavScheduledRef = useRef(false);
  const pendingRevealAfter100TimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginDashboardHideRef = useRef<(detail: string) => void>(() => {});
  const closePipelineOverlayCoreRef = useRef<() => void>(() => {});
  const resetAiProgressRef = useRef<() => void>(() => {});
  /** Instant `performance.now()` à l’appel `stopRecording` (sonde [BALLET-PROFILER]). */
  const captureEndRef = useRef(0);
  const balletProfilerGatesRef = useRef({
    t1: false,
    t2: false,
    t3: false,
    t4: false,
    t5BoostStart: false,
    t5100Reached: false,
    t6HideStart: false,
  });

  const logBalletProfilerDelta = useCallback((tag: string, detail: string) => {
    const base = captureEndRef.current;
    if (base <= 0) return;
    const delta = perfNowMs() - base;
    console.log(`[BALLET-PROFILER] ${tag} ${detail} delta_ms=${delta.toFixed(3)}`);
  }, []);

  /** Barre à 100 % tout de suite (succès Gemini ou persistance). */
  const beginDashboardHide = useCallback(
    (detail: string) => {
      if (captureEndRef.current <= 0) return;
      if (balletProfilerGatesRef.current.t6HideStart) return;
      balletProfilerGatesRef.current.t6HideStart = true;
      logBalletProfilerDelta('T6_HIDE_START', detail);
    },
    [logBalletProfilerDelta],
  );

  const onAiFinalSprintHit100 = useCallback(() => {
    if (!balletProfilerGatesRef.current.t5100Reached) {
      balletProfilerGatesRef.current.t5100Reached = true;
      logBalletProfilerDelta('T5_100_REACHED', 'progress bar at 100% (200ms linear sprint complete)');
    }
  }, [logBalletProfilerDelta]);

  const onAiSprintCompleteAt100 = useCallback(() => {
    if (pendingRevealAfter100TimeoutRef.current) {
      clearTimeout(pendingRevealAfter100TimeoutRef.current);
    }
    pendingRevealAfter100TimeoutRef.current = setTimeout(() => {
      pendingRevealAfter100TimeoutRef.current = null;
      setSelectedIntentionIndexRef.current(0);
      beginDashboardHideRef.current(`reveal hold ${AI_PROGRESS_REVEAL_HOLD_MS}ms after 100%`);
      closePipelineOverlayCoreRef.current();
      queueMicrotask(() => micRef.current?.exitPipelineWaitToIdle());
    }, AI_PROGRESS_REVEAL_HOLD_MS);
  }, []);

  const {
    progress: pipelineDisplayedPct,
    reset: resetAiProgress,
    beginInertia: beginAiProgressInertia,
    bumpTarget: bumpAiProgressTarget,
    startFinalSprintTo100: startAiFinalSprint,
    finalSprintActiveRef,
    inertiaEpochRef,
  } = useAIProgressInertia({
    active: pipelineModalVisible,
    onFinalSprintHit100: onAiFinalSprintHit100,
    onLinearSprintComplete: onAiSprintCompleteAt100,
  });

  resetAiProgressRef.current = resetAiProgress;

  const closePipelineOverlayCore = useCallback(() => {
    pipelineModalVisibleRef.current = false;
    if (pendingRevealAfter100TimeoutRef.current) {
      clearTimeout(pendingRevealAfter100TimeoutRef.current);
      pendingRevealAfter100TimeoutRef.current = null;
    }
    pipelineActiveTraceRef.current = null;
    setPipelineDashTitleComplete(false);
    resetAiProgressRef.current();
    setPipelineModalVisible(false);
    const pending = pendingPeekFirstSavePayloadRef.current;
    pendingPeekFirstSavePayloadRef.current = null;
    if (pending) {
      queueMicrotask(() => applyPeekFirstSavePayloadRef.current(pending));
    }
  }, []);

  const onProfilerStopRecordingT0 = useCallback(() => {
    captureEndRef.current = perfNowMs();
    balletProfilerGatesRef.current = { t1: false, t2: false, t3: false, t4: false, t5BoostStart: false, t5100Reached: false, t6HideStart: false };
    console.log('[BALLET-PROFILER] T0 stopRecording invoked delta_ms=0.000');
  }, []);

  useEffect(() => {
    pipelineResilienceOrangeRef.current = pipelineResilienceOrange;
  }, [pipelineResilienceOrange]);

  useEffect(() => {
    pipelineModalVisibleRef.current = pipelineModalVisible;
  }, [pipelineModalVisible]);

  /** Rafraîchit compteurs en-tête (tâches du jour, piggy, quota free capture). */
  const refreshPilotHeader = useCallback(async () => {
    const ymd = formatYmdLocal(new Date());
    const [unorg, todayN, snap] = await Promise.all([
      getTrankilV2UnorganizedCount(),
      countTrankilV2RootTodoTasksDueOnLocalDate(ymd),
      spectrum.isProUser ? Promise.resolve(null) : getFreeCaptureQuotaSnapshot(),
    ]);
    setHeaderUnorganizedCount(unorg);
    setTodayTodoCount(todayN);
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

  /** Remet l’étape capture micro à l’état repos (annulation). */
  const hardResetToIdle = useCallback(() => {
    setCaptureStep('idle');
  }, []);

  const micLocked = !spectrum.isProUser && (freeQuotaSnapshot?.remaining ?? 1) <= 0;

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

  /** Gate micro : quota free épuisé → false (modal Pro si verrou). */
  const beforeStartCapture = useCallback(async (): Promise<boolean> => {
    if (micLocked) {
      setPassProVisible(true);
      return false;
    }
    return true;
  }, [micLocked]);

  /** Début d’enregistrement micro : ferme le dashboard résiduel (nouvelle capture). */
  const onMicStart = useCallback(() => {
    setCaptureStep('recording');
    setPipelineModalVisible(false);
    pipelineModalVisibleRef.current = false;
    setPipelineResilienceOrange(false);
    pipelineResilienceOrangeRef.current = false;
    pipelineOrangeNavScheduledRef.current = false;
    captureEndRef.current = 0;
    balletProfilerGatesRef.current = { t1: false, t2: false, t3: false, t4: false, t5BoostStart: false, t5100Reached: false, t6HideStart: false };
    pendingPeekFirstSavePayloadRef.current = null;
    if (pendingRevealAfter100TimeoutRef.current) {
      clearTimeout(pendingRevealAfter100TimeoutRef.current);
      pendingRevealAfter100TimeoutRef.current = null;
    }
    pipelineActiveTraceRef.current = null;
    resetAiProgressRef.current();
    setPipelineDashTitleComplete(false);
    setSelectedIntentionIndex(0);
  }, []);

  /** Overlay + inertie 0→60 % (2×1,2 s ease-in-out) au relâchement micro (`TalkCaptureMicButton`). */
  const onPipelineDashboardOpenImmediate = useCallback(
    ({ traceId }: { traceId: string }) => {
      pendingPeekFirstSavePayloadRef.current = null;
      if (pendingRevealAfter100TimeoutRef.current) {
        clearTimeout(pendingRevealAfter100TimeoutRef.current);
        pendingRevealAfter100TimeoutRef.current = null;
      }
      setPipelineDashTitleComplete(false);
      pipelineModalVisibleRef.current = true;
      pipelineActiveTraceRef.current = String(traceId || '').trim() || null;
      pipelineOrangeNavScheduledRef.current = false;
      resetAiProgress();
      beginAiProgressInertia();
      setPipelineResilienceOrange(false);
      pipelineResilienceOrangeRef.current = false;
      setPipelineModalVisible(true);
    },
    [beginAiProgressInertia, resetAiProgress],
  );

  const onPipelineDashboardCancelImmediate = useCallback(() => {
    pendingPeekFirstSavePayloadRef.current = null;
    if (pendingRevealAfter100TimeoutRef.current) {
      clearTimeout(pendingRevealAfter100TimeoutRef.current);
      pendingRevealAfter100TimeoutRef.current = null;
    }
    setPipelineDashTitleComplete(false);
    pipelineModalVisibleRef.current = false;
    pipelineActiveTraceRef.current = null;
    setPipelineModalVisible(false);
    resetAiProgress();
  }, [resetAiProgress]);

  /** Micro « échap » : ferme l’overlay sans annuler `submitCapturePayload`. */
  const onPipelineWaitMicPress = useCallback(() => {
    beginDashboardHide('dashboard dismissed; mic escape (no cancel submit)');
    closePipelineOverlayCore();
    queueMicrotask(() => micRef.current?.exitPipelineWaitToIdle());
  }, [beginDashboardHide, closePipelineOverlayCore]);

  useEffect(() => {
    if (!pipelineModalVisible || captureEndRef.current <= 0) return;
    if (balletProfilerGatesRef.current.t1) return;
    balletProfilerGatesRef.current.t1 = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        logBalletProfilerDelta('T1', 'dashboard overlay visible (post-commit paint)');
      });
    });
  }, [logBalletProfilerDelta, pipelineModalVisible]);

  useEffect(() => {
    if (!pipelineModalVisible || captureEndRef.current <= 0) return;
    if (balletProfilerGatesRef.current.t2) return;
    if (pipelineDisplayedPct <= 0) return;
    balletProfilerGatesRef.current.t2 = true;
    logBalletProfilerDelta('T2', 'first progress bar motion (inertia P1/P2 glide)');
  }, [logBalletProfilerDelta, pipelineDisplayedPct, pipelineModalVisible]);

  useEffect(() => {
    if (!pipelineModalVisible || captureEndRef.current <= 0) return;
    if (balletProfilerGatesRef.current.t4) return;
    const inertiaStart = inertiaEpochRef.current;
    if (inertiaStart <= 0) return;
    const elapsedBallet = perfNowMs() - inertiaStart;
    if (elapsedBallet < AI_PROGRESS_INERTIA_TOTAL_MS) return;
    if (pipelineDisplayedPct < 60) return;
    balletProfilerGatesRef.current.t4 = true;
    logBalletProfilerDelta(
      'T4',
      `phase 3 stepAnalysis (inertia_elapsed_ms>=${AI_PROGRESS_INERTIA_TOTAL_MS}, actual=${Math.round(elapsedBallet)}; displayedPct>=60)`,
    );
  }, [logBalletProfilerDelta, pipelineDisplayedPct, pipelineModalVisible]);

  useEffect(() => {
    beginDashboardHideRef.current = beginDashboardHide;
  }, [beginDashboardHide]);

  useEffect(() => {
    closePipelineOverlayCoreRef.current = closePipelineOverlayCore;
  }, [closePipelineOverlayCore]);

  useEffect(() => {
    setSelectedIntentionIndexRef.current = setSelectedIntentionIndex;
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CAPTURE_PIPELINE_PROGRESS_EVENT, (raw: CapturePipelineProgressPayload) => {
      const trace = String(raw.trace || '').trim();
      const active = String(pipelineActiveTraceRef.current || '').trim();
      if (!trace || !active || trace !== active) return;
      if (!balletProfilerGatesRef.current.t3) {
        balletProfilerGatesRef.current.t3 = true;
        logBalletProfilerDelta('T3', 'first CAPTURE_PIPELINE event');
      }
      const d = raw.detail;
      let setOrange = false;
      const bump = (v: number) => {
        bumpAiProgressTarget(v);
      };
      switch (raw.phase) {
        case 'mic_stop_audio_done':
          break;
        case 'mic_submit_invoke':
          bump(16);
          break;
        case 'submit_enter':
          bump(19);
          break;
        case 'submit_netinfo':
          bump(26);
          break;
        case 'netinfo_online_null_reachable':
          bump(29);
          break;
        case 'peek_snapshot_emit':
          bump(50);
          break;
        case 'peek_snapshot_offline_queue':
          setOrange = true;
          pipelineResilienceOrangeRef.current = true;
          bump(100);
          break;
        case 'bulk_start':
          bump(68);
          break;
        case 'gemini_one_tap_call_success': {
          const gIdx = Number(d?.idx ?? 1);
          const gTot = Number(d?.total ?? 1);
          bump(100);
          if (gIdx === gTot && !pipelineResilienceOrangeRef.current) {
            if (finalSprintActiveRef.current) break;
            if (!balletProfilerGatesRef.current.t5BoostStart) {
              balletProfilerGatesRef.current.t5BoostStart = true;
              logBalletProfilerDelta(
                'T5_BOOST_START',
                `gemini_one_tap_call_success → linear sprint to 100% (${AI_PROGRESS_FINAL_SPRINT_MS}ms)`,
              );
            }
            setPipelineDashTitleComplete(true);
            startAiFinalSprint();
          }
          break;
        }
        case 'chunk_ventilated_await':
          bump(73);
          break;
        case 'chunk_persist_ok':
          bump(82);
          break;
        case 'persist_callback': {
          bump(87);
          const cIdx = Number(d?.chunkIndex ?? 1);
          const cTot = Number(d?.chunkTotal ?? 1);
          if (
            cIdx === cTot &&
            !pipelineResilienceOrangeRef.current &&
            pipelineModalVisibleRef.current &&
            !finalSprintActiveRef.current
          ) {
            if (!balletProfilerGatesRef.current.t5BoostStart) {
              balletProfilerGatesRef.current.t5BoostStart = true;
              logBalletProfilerDelta(
                'T5_BOOST_START',
                `persist_callback fallback → linear sprint to 100% (${AI_PROGRESS_FINAL_SPRINT_MS}ms)`,
              );
            }
            setPipelineDashTitleComplete(true);
            startAiFinalSprint();
          }
          break;
        }
        case 'peek_first_save_emit':
          bump(93);
          break;
        case 'submit_return_after_bulk':
          bump(100);
          break;
        case 'bulk_network_resilience_enqueue':
          setOrange = true;
          pipelineResilienceOrangeRef.current = true;
          bump(100);
          break;
        case 'submit_offline_queued':
          if (d?.reason === 'netinfo_offline') {
            setOrange = true;
            pipelineResilienceOrangeRef.current = true;
          }
          bump(100);
          break;
        default:
          break;
      }
      if (setOrange) setPipelineResilienceOrange(true);
    });
    return () => sub.remove();
  }, [bumpAiProgressTarget, logBalletProfilerDelta, startAiFinalSprint]);

  useEffect(() => {
    if (pipelineModalVisible) return;
    if (captureEndRef.current <= 0) return;
    if (!balletProfilerGatesRef.current.t6HideStart) return;
    balletProfilerGatesRef.current.t6HideStart = false;
    logBalletProfilerDelta('T7_CLEANUP', 'dashboard Modal dismissed (native tree)');
  }, [logBalletProfilerDelta, pipelineModalVisible]);

  useEffect(() => {
    if (!pipelineModalVisible || !pipelineResilienceOrange) return;
    if (pipelineDisplayedPct < 98.5) return;
    if (pipelineOrangeNavScheduledRef.current) return;
    pipelineOrangeNavScheduledRef.current = true;
    const t = setTimeout(() => {
      pipelineOrangeNavScheduledRef.current = false;
      beginDashboardHide('resilience: dashboard close before Timeline navigation');
      navigation.navigate('Timeline', { initialTimeNav: 'TODAY', initialContext: 'ALL' });
      closePipelineOverlayCore();
      micRef.current?.exitPipelineWaitToIdle();
    }, 2000);
    return () => {
      clearTimeout(t);
      pipelineOrangeNavScheduledRef.current = false;
    };
  }, [beginDashboardHide, closePipelineOverlayCore, navigation, pipelineDisplayedPct, pipelineModalVisible, pipelineResilienceOrange]);

  const pipelineTitleText = useMemo(() => {
    if (pipelineResilienceOrange) return t('talkDebug.errorNetwork');
    if (pipelineDashTitleComplete) return t('talkDebug.stepComplete');
    if (pipelineDisplayedPct < 30) return t('talkDebug.stepTransport');
    if (pipelineDisplayedPct < 60) return t('talkDebug.stepTranscription');
    return t('talkDebug.stepAnalysis');
  }, [pipelineDashTitleComplete, pipelineDisplayedPct, pipelineResilienceOrange, t]);

  const pipelineBarColor = pipelineResilienceOrange ? '#fb923c' : '#38bdf8';

  /**
   * Fin dictée côté parent : T0 perf + bannière cycle. Le pipeline Gemini + `submitCapturePayload`
   * est enchaîné dans `TalkCaptureMicButton` à la validation.
   */
  const onMicEnd = useCallback((_payload: TalkCaptureEndPayload) => {}, []);

  /** Ferme la feuille détail (peek ou plein écran). */
  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setPeekDetailRows([]);
    setSelectedIntentionIndex(0);
    setDetailPosition('full');
    setDetailPeekHeightPx(capturePeekPathAHeightPx());
    setPeekCapturePhase('idle');
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

  applyPeekFirstSavePayloadRef.current = applyPeekFirstSavePayload;

  /** Évite une feuille capture résiduelle sur un onglet non focalisé (cf. SPEC routage peek). */
  useEffect(() => {
    if (isFocused) return;
    const inCapturePeekFlow =
      peekCapturePhase !== 'idle' || peekDetailRows.some((r) => r.id === 'peek_pending');
    if (!detailOpen || !inCapturePeekFlow) return;
    closeDetail();
  }, [closeDetail, detailOpen, isFocused, peekCapturePhase, peekDetailRows]);

  /** Écoute `INTENTION_PEEK_*` : Path A / Path B (sheet bloquée tant que le dashboard ballet est visible). */
  useEffect(() => {
    const dashboardBalletLocksPeekUi = () => pipelineModalVisible || pipelineModalVisibleRef.current;

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
      if (dashboardBalletLocksPeekUi()) {
        pendingPeekFirstSavePayloadRef.current = payload;
        return;
      }
      applyPeekFirstSavePayload(payload);
    });
    return () => {
      subSnap.remove();
      subFirstSave.remove();
    };
  }, [applyPeekFirstSavePayload, pipelineModalVisible]);

  /** Après validation UI côté `TalkCaptureMicButton` : repasse l’étape capture à idle. */
  const onMicValidated = useCallback(() => {
    setCaptureStep('idle');
  }, []);

  /** Annulation micro : reset étape capture. */
  const onMicCancel = useCallback(async () => {
    hardResetToIdle();
  }, [hardResetToIdle]);

  /** Saisie texte « Phoenix » : même pipeline OneTap que le micro (`submitCapturePayload`, Bulk(1)). */
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
    <View style={styles.root}>
      <PassProModal
        visible={passProVisible}
        onDismiss={() => setPassProVisible(false)}
      />
      <IntentionDetailSheet
        visible={detailOpen}
        row={detailRow}
        theme={theme}
        onClose={closeDetail}
        initialPosition={detailPosition}
        peekHeightPx={detailPeekHeightPx}
        validationMode
        peekCapturePhase={peekCapturePhase}
        captureSheetMaxHeightRatio={peekCapturePhase !== 'idle' ? CAPTURE_SHEET_FULL_MAX_RATIO : undefined}
        intentionMixAccentColor={intentionMixAccentColor}
        morphSheetContentOnIntentionChange={peekDetailRows.length > 1}
      />
      <AIUniversalProgressOverlay
        isVisible={pipelineModalVisible}
        progress={pipelineDisplayedPct}
        label={pipelineTitleText}
        barColor={pipelineBarColor}
      />
      <View style={[styles.headerSafe, { paddingTop: Math.max(insets.top, 6) }]}>
        <View style={styles.phoenixRow}>
          <TextInput
            value={phoenixInput}
            onChangeText={setPhoenixInput}
            placeholder="Tape ton intention ici..."
            placeholderTextColor="rgba(226,232,240,0.55)"
            style={styles.phoenixInput}
            editable={!phoenixSubmitting}
            returnKeyType="send"
            onSubmitEditing={() => void onSubmitPhoenix()}
          />
          <TouchableOpacity
            style={[styles.phoenixSendBtn, phoenixSubmitting ? styles.disabled : null]}
            onPress={() => void onSubmitPhoenix()}
            disabled={phoenixSubmitting}
            activeOpacity={0.8}
          >
            <Text style={styles.phoenixSendText}>Envoyer</Text>
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
      </View>

      <View style={styles.middleSpacer} />

      <IntentionSuggestionsBanner visible={captureStep === 'idle' && !pipelineModalVisible} bottomOffset={112} />

      <View
        style={[
          styles.captureDock,
          {
            paddingBottom: Math.max(insets.bottom, 10),
            justifyContent: captureStep === 'idle' ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <TalkCaptureMicButton
          ref={micRef}
          variant="talkDebug"
          disabled={phoenixSubmitting}
          locked={micLocked}
          lockedHintText={t('talkDebug.micQuotaUpsellHint')}
          waveformA11yLabel={t('talkDebug.voiceWaveformA11y')}
          onLockedPress={() => setPassProVisible(true)}
          beforeStart={beforeStartCapture}
          onCaptureStart={onMicStart}
          onCaptureEnd={onMicEnd}
          onCaptureCancel={onMicCancel}
          onValidated={onMicValidated}
          dashboardPipelineHost
          onPipelineDashboardOpenImmediate={onPipelineDashboardOpenImmediate}
          onPipelineDashboardCancelImmediate={onPipelineDashboardCancelImmediate}
          onPipelineWaitMicPress={onPipelineWaitMicPress}
          onProfilerStopRecordingT0={onProfilerStopRecordingT0}
        />
      </View>

      <DealerBoard
        selectedIntentionIndex={selectedIntentionIndex}
        onSelectIntentionIndex={setSelectedIntentionIndex}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  headerSafe: { paddingHorizontal: 16, paddingBottom: 8 },
  phoenixRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  phoenixInput: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.55)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(15,23,42,0.55)',
    fontWeight: '700',
  },
  phoenixSendBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#008080',
    borderWidth: 1,
    borderColor: 'rgba(236,254,255,0.35)',
  },
  phoenixSendText: { color: '#ecfeff', fontSize: 14, fontWeight: '900' },
  middleSpacer: { flex: 1, minHeight: 0 },
  captureDock: { paddingHorizontal: 20, paddingTop: 10, minHeight: 120 },
  disabled: { opacity: 0.5 },
});
