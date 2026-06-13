import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { DeviceEventEmitter } from 'react-native';

import { getFreeCaptureQuotaSnapshot } from '../api/trankilV2Db';
import type { TalkCaptureMicButtonHandle } from '../components/TalkCaptureMicButton';
import {
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import { useCapturePipelineOverlay } from '../hooks/useCapturePipelineOverlay';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import { useUserSpectrum } from './UserSpectrumContext';

export type CaptureMicVariant = 'timeline' | 'talkDebug';

export type CapturePresentationConfig = {
  /** Masque le micro global sur l’écran actif (ex. écran sans capture). */
  micHidden?: boolean;
  variant?: CaptureMicVariant;
  compact?: boolean;
  /** TalkDebug : ouvre l’overlay pipeline au relâchement micro. */
  dashboardPipelineHost?: boolean;
  /** TalkDebug : bas de la pastille pro (Y fenêtre) pour centrer l’overlay pipeline. */
  pipelineAnchorTopPx?: number | null;
  disabled?: boolean;
  lockedHintText?: string;
  waveformA11yLabel?: string;
};

export type CaptureOverlayLifecycleHandlers = {
  onPipelineSprintComplete?: () => void;
  onCaptureStart?: () => void;
  onCaptureValidated?: () => void;
  onCaptureCancel?: () => void;
};

const DEFAULT_PRESENTATION: CapturePresentationConfig = {
  micHidden: false,
  variant: 'timeline',
  compact: true,
  dashboardPipelineHost: false,
  disabled: false,
};

type CapturePresentationContextValue = {
  config: CapturePresentationConfig;
  setPresentation: (patch: Partial<CapturePresentationConfig>) => void;
  resetPresentation: () => void;
  isPipelineOverlayVisible: boolean;
  setPipelineOverlayVisible: (visible: boolean) => void;
  pipelineOverlayVisibleRef: React.MutableRefObject<boolean>;
  captureRecordingActive: boolean;
  setCaptureRecordingActive: (active: boolean) => void;
  registerOverlayLifecycleHandlers: (handlers: CaptureOverlayLifecycleHandlers) => () => void;
  invokeLifecycle: (key: keyof CaptureOverlayLifecycleHandlers) => void;
  micRef: RefObject<TalkCaptureMicButtonHandle | null>;
  micLocked: boolean;
  passProVisible: boolean;
  setPassProVisible: (visible: boolean) => void;
  openLockedMicUpsell: () => void;
  pipelineDisplayedPct: number;
  pipelineTitleText: string;
  pipelineBarColor: string;
  beforeStartCapture: () => Promise<boolean>;
  onCaptureStart: () => void;
  onCaptureValidated: () => void;
  onCaptureCancel: () => void;
  onPipelineDashboardOpenImmediate: (ctx: { traceId: string }) => void;
  onPipelineDashboardCancelImmediate: () => void;
  onPipelineWaitMicPress: () => void;
  onProfilerStopRecordingT0: () => void;
};

const CapturePresentationContext = createContext<CapturePresentationContextValue | null>(null);

/** Provider : config micro + pipeline overlay + ref partagée entre overlay global et TalkDebug in-flow. */
export function CapturePresentationProvider({ children }: { children: ReactNode }) {
  const { spectrum } = useUserSpectrum();
  const [config, setConfigState] = useState<CapturePresentationConfig>(DEFAULT_PRESENTATION);
  const [isPipelineOverlayVisible, setPipelineOverlayVisibleState] = useState(false);
  const [captureRecordingActive, setCaptureRecordingActive] = useState(false);
  const [passProVisible, setPassProVisible] = useState(false);
  const [freeQuotaSnapshot, setFreeQuotaSnapshot] = useState<{ remaining: number; max: number } | null>(null);
  const pipelineOverlayVisibleRef = useRef(false);
  const lifecycleHandlersRef = useRef<CaptureOverlayLifecycleHandlers>({});
  const micRef = useRef<TalkCaptureMicButtonHandle | null>(null);

  const setPresentation = useCallback((patch: Partial<CapturePresentationConfig>) => {
    setConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetPresentation = useCallback(() => {
    setConfigState(DEFAULT_PRESENTATION);
  }, []);

  const setPipelineOverlayVisible = useCallback((visible: boolean) => {
    pipelineOverlayVisibleRef.current = visible;
    setPipelineOverlayVisibleState(visible);
  }, []);

  const registerOverlayLifecycleHandlers = useCallback((handlers: CaptureOverlayLifecycleHandlers) => {
    lifecycleHandlersRef.current = { ...lifecycleHandlersRef.current, ...handlers };
    return () => {
      const next = { ...lifecycleHandlersRef.current };
      (Object.keys(handlers) as (keyof CaptureOverlayLifecycleHandlers)[]).forEach((key) => {
        if (lifecycleHandlersRef.current[key] === handlers[key]) {
          delete next[key];
        }
      });
      lifecycleHandlersRef.current = next;
    };
  }, []);

  const invokeLifecycle = useCallback((key: keyof CaptureOverlayLifecycleHandlers) => {
    lifecycleHandlersRef.current[key]?.();
  }, []);

  const refreshQuota = useCallback(async () => {
    if (spectrum.isProUser) {
      setFreeQuotaSnapshot(null);
      return;
    }
    const snap = await getFreeCaptureQuotaSnapshot();
    setFreeQuotaSnapshot({ remaining: snap.remaining, max: snap.max });
  }, [spectrum.isProUser]);

  useEffect(() => {
    void refreshQuota();
    const sub = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => void refreshQuota());
    return () => sub.remove();
  }, [refreshQuota]);

  const micLocked = !spectrum.isProUser && (freeQuotaSnapshot?.remaining ?? 1) <= 0;

  const pipeline = useCapturePipelineOverlay({
    micRef,
    pipelineModalVisible: isPipelineOverlayVisible,
    setPipelineOverlayVisible,
    pipelineOverlayVisibleRef,
    onPipelineSprintComplete: () => invokeLifecycle('onPipelineSprintComplete'),
  });

  const deferPeekRef = useRef(pipeline.deferPeekFirstSaveIfOverlayVisible);
  deferPeekRef.current = pipeline.deferPeekFirstSaveIfOverlayVisible;

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, (payload) => {
      if (!pipelineOverlayVisibleRef.current && !isPipelineOverlayVisible) return;
      deferPeekRef.current(payload);
    });
    return () => sub.remove();
  }, [isPipelineOverlayVisible]);

  const openLockedMicUpsell = useCallback(() => {
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.navigate('ProSubscription');
    } else {
      setPassProVisible(true);
    }
  }, []);

  const beforeStartCapture = useCallback(async (): Promise<boolean> => {
    if (micLocked) {
      setPassProVisible(true);
      return false;
    }
    return true;
  }, [micLocked]);

  const onCaptureStart = useCallback(() => {
    setCaptureRecordingActive(true);
    pipeline.onMicStartPipelineReset();
    invokeLifecycle('onCaptureStart');
  }, [invokeLifecycle, pipeline]);

  const onCaptureValidated = useCallback(() => {
    setCaptureRecordingActive(false);
    invokeLifecycle('onCaptureValidated');
  }, [invokeLifecycle]);

  const onCaptureCancel = useCallback(() => {
    setCaptureRecordingActive(false);
    invokeLifecycle('onCaptureCancel');
  }, [invokeLifecycle]);

  const value = useMemo(
    (): CapturePresentationContextValue => ({
      config,
      setPresentation,
      resetPresentation,
      isPipelineOverlayVisible,
      setPipelineOverlayVisible,
      pipelineOverlayVisibleRef,
      captureRecordingActive,
      setCaptureRecordingActive,
      registerOverlayLifecycleHandlers,
      invokeLifecycle,
      micRef,
      micLocked,
      passProVisible,
      setPassProVisible,
      openLockedMicUpsell,
      pipelineDisplayedPct: pipeline.pipelineDisplayedPct,
      pipelineTitleText: pipeline.pipelineTitleText,
      pipelineBarColor: pipeline.pipelineBarColor,
      beforeStartCapture,
      onCaptureStart,
      onCaptureValidated,
      onCaptureCancel,
      onPipelineDashboardOpenImmediate: pipeline.onPipelineDashboardOpenImmediate,
      onPipelineDashboardCancelImmediate: pipeline.onPipelineDashboardCancelImmediate,
      onPipelineWaitMicPress: pipeline.onPipelineWaitMicPress,
      onProfilerStopRecordingT0: pipeline.onProfilerStopRecordingT0,
    }),
    [
      beforeStartCapture,
      config,
      captureRecordingActive,
      invokeLifecycle,
      isPipelineOverlayVisible,
      micLocked,
      onCaptureCancel,
      onCaptureStart,
      onCaptureValidated,
      openLockedMicUpsell,
      passProVisible,
      pipeline,
      registerOverlayLifecycleHandlers,
      resetPresentation,
      setPresentation,
      setPipelineOverlayVisible,
    ],
  );

  return <CapturePresentationContext.Provider value={value}>{children}</CapturePresentationContext.Provider>;
}

export function useCapturePresentation(): CapturePresentationContextValue {
  const ctx = useContext(CapturePresentationContext);
  if (!ctx) {
    throw new Error('useCapturePresentation must be used within CapturePresentationProvider');
  }
  return ctx;
}

export function useOptionalCapturePresentation(): CapturePresentationContextValue | null {
  return useContext(CapturePresentationContext);
}
