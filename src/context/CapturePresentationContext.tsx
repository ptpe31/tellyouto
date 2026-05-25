import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type CaptureMicVariant = 'timeline' | 'talkDebug';

export type CapturePresentationConfig = {
  /** Masque le micro global sur l’écran actif. */
  micHidden?: boolean;
  variant?: CaptureMicVariant;
  compact?: boolean;
  /** TalkDebug : ouvre l’overlay pipeline au relâchement micro. */
  dashboardPipelineHost?: boolean;
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
};

const CapturePresentationContext = createContext<CapturePresentationContextValue | null>(null);

/** Provider : config de présentation micro + état overlay partagé avec les écrans hôtes. */
export function CapturePresentationProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<CapturePresentationConfig>(DEFAULT_PRESENTATION);
  const [isPipelineOverlayVisible, setPipelineOverlayVisibleState] = useState(false);
  const [captureRecordingActive, setCaptureRecordingActive] = useState(false);
  const pipelineOverlayVisibleRef = useRef(false);
  const lifecycleHandlersRef = useRef<CaptureOverlayLifecycleHandlers>({});

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
    }),
    [
      config,
      setPresentation,
      resetPresentation,
      isPipelineOverlayVisible,
      setPipelineOverlayVisible,
      captureRecordingActive,
      registerOverlayLifecycleHandlers,
      invokeLifecycle,
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
