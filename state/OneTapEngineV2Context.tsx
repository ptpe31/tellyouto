import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { OneTapUniversalResult, UiLocale } from '../types/oneTap';
import { startOneTapCapture } from '../services/oneTap/pipeline';

export type OneTapEngineStatus = 'idle' | 'reviewing' | 'refining';

export type OneTapEngineState = {
  status: OneTapEngineStatus;
  transcript: string;
  audioUri: string | null;
  result: OneTapUniversalResult | null;
  userEdited: boolean;
};

type GeminiConfig = { apiKey: string; modelId: string };

type StartParams = {
  transcript: string;
  audioUri: string | null;
  uiLocale: UiLocale;
  titleHint?: string;
  gemini?: GeminiConfig;
};

type OneTapEngineContextValue = {
  state: OneTapEngineState;
  start: (p: StartParams) => void;
  startWithHandle: (p: { transcript: string; audioUri: string | null; handle: ReturnType<typeof startOneTapCapture> }) => void;
  reset: () => void;
  markUserEdited: () => void;
  applyUserEdit: (next: OneTapUniversalResult) => void;
};

const Ctx = createContext<OneTapEngineContextValue | null>(null);

export function OneTapEngineV2Provider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OneTapEngineState>({
    status: 'idle',
    transcript: '',
    audioUri: null,
    result: null,
    userEdited: false,
  });

  const nonceRef = useRef(0);
  const handleRef = useRef<ReturnType<typeof startOneTapCapture> | null>(null);

  const reset = useCallback(() => {
    nonceRef.current += 1;
    handleRef.current?.cancel();
    handleRef.current = null;
    setState({ status: 'idle', transcript: '', audioUri: null, result: null, userEdited: false });
  }, []);

  const markUserEdited = useCallback(() => {
    setState((prev) => (prev.userEdited ? prev : { ...prev, userEdited: true }));
  }, []);

  const applyUserEdit = useCallback((next: OneTapUniversalResult) => {
    setState((prev) => ({ ...prev, result: next, userEdited: true }));
  }, []);

  const startWithHandle = useCallback(
    (p: { transcript: string; audioUri: string | null; handle: ReturnType<typeof startOneTapCapture> }) => {
      nonceRef.current += 1;
      const nonce = nonceRef.current;
      handleRef.current?.cancel();
      handleRef.current = p.handle;
      setState({
        status: 'refining',
        transcript: p.transcript,
        audioUri: p.audioUri,
        result: p.handle.skeleton,
        userEdited: false,
      });
      void p.handle.refine.then((refined) => {
        if (nonceRef.current !== nonce) return;
        setState((prev) => {
          if (prev.userEdited) return { ...prev, status: 'reviewing' };
          if (!refined) return { ...prev, status: 'reviewing' };
          return { ...prev, status: 'reviewing', result: refined };
        });
      });
    },
    [],
  );

  const start = useCallback((p: StartParams) => {
    const handle = startOneTapCapture(p.transcript, {
      uiLocale: p.uiLocale,
      titleHint: p.titleHint,
      gemini: p.gemini,
    });
    startWithHandle({ transcript: p.transcript, audioUri: p.audioUri, handle });
  }, [startWithHandle]);

  const value = useMemo<OneTapEngineContextValue>(
    () => ({ state, start, startWithHandle, reset, markUserEdited, applyUserEdit }),
    [applyUserEdit, markUserEdited, reset, start, startWithHandle, state],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOneTapEngineV2(): OneTapEngineContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOneTapEngineV2 must be used within OneTapEngineV2Provider');
  return v;
}
