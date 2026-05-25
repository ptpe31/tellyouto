import { CommonActions } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH_EVENT_NAME,
} from '../constants/intentionEvents';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import { CAPTURE_PIPELINE_PROGRESS_EVENT, type CapturePipelineProgressPayload } from '../utils/captureFlowLog';
import type { TalkCaptureMicButtonHandle } from '../components/TalkCaptureMicButton';
import {
  AI_PROGRESS_FINAL_SPRINT_MS,
  AI_PROGRESS_INERTIA_TOTAL_MS,
  AI_PROGRESS_REVEAL_HOLD_MS,
  useAIProgressInertia,
} from './useAIProgressInertia';

function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

type UseCapturePipelineOverlayOptions = {
  micRef: RefObject<TalkCaptureMicButtonHandle | null>;
  pipelineModalVisible: boolean;
  setPipelineOverlayVisible: (visible: boolean) => void;
  pipelineOverlayVisibleRef: React.MutableRefObject<boolean>;
  onPipelineSprintComplete?: () => void;
};

/** Orchestration overlay pipeline IA (extrait de TalkDebugScreen) pour le micro global. */
export function useCapturePipelineOverlay({
  micRef,
  pipelineModalVisible,
  setPipelineOverlayVisible,
  pipelineOverlayVisibleRef,
  onPipelineSprintComplete,
}: UseCapturePipelineOverlayOptions) {
  const { t } = useTranslation();
  const [pipelineDashTitleComplete, setPipelineDashTitleComplete] = useState(false);
  const [pipelineResilienceOrange, setPipelineResilienceOrange] = useState(false);

  const pipelineResilienceOrangeRef = useRef(false);
  const pendingPeekFirstSavePayloadRef = useRef<unknown>(null);
  const pipelineActiveTraceRef = useRef<string | null>(null);
  const pipelineOrangeNavScheduledRef = useRef(false);
  const pendingRevealAfter100TimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginDashboardHideRef = useRef<(detail: string) => void>(() => {});
  const closePipelineOverlayCoreRef = useRef<() => void>(() => {});
  const resetAiProgressRef = useRef<() => void>(() => {});
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
  const onPipelineSprintCompleteRef = useRef(onPipelineSprintComplete);
  onPipelineSprintCompleteRef.current = onPipelineSprintComplete;

  const logBalletProfilerDelta = useCallback((tag: string, detail: string) => {
    const base = captureEndRef.current;
    if (base <= 0) return;
    const delta = perfNowMs() - base;
    console.log(`[BALLET-PROFILER] ${tag} ${detail} delta_ms=${delta.toFixed(3)}`);
  }, []);

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
      onPipelineSprintCompleteRef.current?.();
      beginDashboardHideRef.current(`reveal hold ${AI_PROGRESS_REVEAL_HOLD_MS}ms after 100%`);
      closePipelineOverlayCoreRef.current();
      queueMicrotask(() => micRef.current?.exitPipelineWaitToIdle());
    }, AI_PROGRESS_REVEAL_HOLD_MS);
  }, [micRef]);

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
    pipelineOverlayVisibleRef.current = false;
    if (pendingRevealAfter100TimeoutRef.current) {
      clearTimeout(pendingRevealAfter100TimeoutRef.current);
      pendingRevealAfter100TimeoutRef.current = null;
    }
    pipelineActiveTraceRef.current = null;
    setPipelineDashTitleComplete(false);
    resetAiProgressRef.current();
    setPipelineOverlayVisible(false);
    const pending = pendingPeekFirstSavePayloadRef.current;
    pendingPeekFirstSavePayloadRef.current = null;
    if (pending) {
      queueMicrotask(() =>
        DeviceEventEmitter.emit(CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH_EVENT_NAME, pending),
      );
    }
  }, [pipelineOverlayVisibleRef, setPipelineOverlayVisible]);

  const onProfilerStopRecordingT0 = useCallback(() => {
    captureEndRef.current = perfNowMs();
    balletProfilerGatesRef.current = {
      t1: false,
      t2: false,
      t3: false,
      t4: false,
      t5BoostStart: false,
      t5100Reached: false,
      t6HideStart: false,
    };
    console.log('[BALLET-PROFILER] T0 stopRecording invoked delta_ms=0.000');
  }, []);

  useEffect(() => {
    pipelineResilienceOrangeRef.current = pipelineResilienceOrange;
  }, [pipelineResilienceOrange]);

  const onMicStartPipelineReset = useCallback(() => {
    setPipelineOverlayVisible(false);
    setPipelineResilienceOrange(false);
    pipelineResilienceOrangeRef.current = false;
    pipelineOrangeNavScheduledRef.current = false;
    captureEndRef.current = 0;
    balletProfilerGatesRef.current = {
      t1: false,
      t2: false,
      t3: false,
      t4: false,
      t5BoostStart: false,
      t5100Reached: false,
      t6HideStart: false,
    };
    pendingPeekFirstSavePayloadRef.current = null;
    if (pendingRevealAfter100TimeoutRef.current) {
      clearTimeout(pendingRevealAfter100TimeoutRef.current);
      pendingRevealAfter100TimeoutRef.current = null;
    }
    pipelineActiveTraceRef.current = null;
    resetAiProgressRef.current();
    setPipelineDashTitleComplete(false);
  }, [setPipelineOverlayVisible]);

  const onPipelineDashboardOpenImmediate = useCallback(
    ({ traceId }: { traceId: string }) => {
      pendingPeekFirstSavePayloadRef.current = null;
      if (pendingRevealAfter100TimeoutRef.current) {
        clearTimeout(pendingRevealAfter100TimeoutRef.current);
        pendingRevealAfter100TimeoutRef.current = null;
      }
      setPipelineDashTitleComplete(false);
      pipelineOverlayVisibleRef.current = true;
      pipelineActiveTraceRef.current = String(traceId || '').trim() || null;
      pipelineOrangeNavScheduledRef.current = false;
      resetAiProgress();
      beginAiProgressInertia();
      setPipelineResilienceOrange(false);
      pipelineResilienceOrangeRef.current = false;
      setPipelineOverlayVisible(true);
    },
    [beginAiProgressInertia, pipelineOverlayVisibleRef, resetAiProgress, setPipelineOverlayVisible],
  );

  const onPipelineDashboardCancelImmediate = useCallback(() => {
    pendingPeekFirstSavePayloadRef.current = null;
    if (pendingRevealAfter100TimeoutRef.current) {
      clearTimeout(pendingRevealAfter100TimeoutRef.current);
      pendingRevealAfter100TimeoutRef.current = null;
    }
    setPipelineDashTitleComplete(false);
    pipelineOverlayVisibleRef.current = false;
    pipelineActiveTraceRef.current = null;
    setPipelineOverlayVisible(false);
    resetAiProgress();
  }, [pipelineOverlayVisibleRef, resetAiProgress, setPipelineOverlayVisible]);

  const onPipelineWaitMicPress = useCallback(() => {
    beginDashboardHide('dashboard dismissed; mic escape (no cancel submit)');
    closePipelineOverlayCore();
    queueMicrotask(() => micRef.current?.exitPipelineWaitToIdle());
  }, [beginDashboardHide, closePipelineOverlayCore, micRef]);

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
  }, [logBalletProfilerDelta, pipelineDisplayedPct, pipelineModalVisible, inertiaEpochRef]);

  useEffect(() => {
    beginDashboardHideRef.current = beginDashboardHide;
  }, [beginDashboardHide]);

  useEffect(() => {
    closePipelineOverlayCoreRef.current = closePipelineOverlayCore;
  }, [closePipelineOverlayCore]);

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
            pipelineOverlayVisibleRef.current &&
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
  }, [bumpAiProgressTarget, logBalletProfilerDelta, pipelineOverlayVisibleRef, startAiFinalSprint]);

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
    const timer = setTimeout(() => {
      pipelineOrangeNavScheduledRef.current = false;
      beginDashboardHide('resilience: dashboard close before Timeline navigation');
      if (rootNavigationRef.isReady()) {
        rootNavigationRef.dispatch(
          CommonActions.navigate({
            name: 'App',
            params: {
              screen: 'Tabs',
              params: {
                screen: 'Timeline',
                params: { initialTimeNav: 'TODAY', initialContext: 'ALL' },
              },
            },
          }),
        );
      }
      closePipelineOverlayCore();
      micRef.current?.exitPipelineWaitToIdle();
    }, 2000);
    return () => {
      clearTimeout(timer);
      pipelineOrangeNavScheduledRef.current = false;
    };
  }, [
    beginDashboardHide,
    closePipelineOverlayCore,
    micRef,
    pipelineDisplayedPct,
    pipelineModalVisible,
    pipelineResilienceOrange,
  ]);

  const pipelineTitleText = useMemo(() => {
    if (pipelineResilienceOrange) return t('talkDebug.errorNetwork');
    if (pipelineDashTitleComplete) return t('talkDebug.stepComplete');
    if (pipelineDisplayedPct < 30) return t('talkDebug.stepTransport');
    if (pipelineDisplayedPct < 60) return t('talkDebug.stepTranscription');
    return t('talkDebug.stepAnalysis');
  }, [pipelineDashTitleComplete, pipelineDisplayedPct, pipelineResilienceOrange, t]);

  const pipelineBarColor = pipelineResilienceOrange ? '#fb923c' : '#38bdf8';

  const deferPeekFirstSaveIfOverlayVisible = useCallback(
    (payload: unknown): boolean => {
      if (pipelineOverlayVisibleRef.current || pipelineModalVisible) {
        pendingPeekFirstSavePayloadRef.current = payload;
        return true;
      }
      return false;
    },
    [pipelineModalVisible, pipelineOverlayVisibleRef],
  );

  return {
    pipelineDisplayedPct,
    pipelineTitleText,
    pipelineBarColor,
    onMicStartPipelineReset,
    onPipelineDashboardOpenImmediate,
    onPipelineDashboardCancelImmediate,
    onPipelineWaitMicPress,
    onProfilerStopRecordingT0,
    deferPeekFirstSaveIfOverlayVisible,
  };
}
