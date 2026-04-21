import type { OneTapCapturePerf, OneTapUniversalResult, UiLocale } from '../../types/oneTap';
import { inferOneTapPathA } from './pathA';
import { geminiRefineOneTapJson } from './geminiClient';

type OneTapCaptureOptions = {
  uiLocale: UiLocale;
  titleHint?: string;
  gemini?: { apiKey: string; modelId: string; refNowIso?: string };
};

export type OneTapCaptureHandle = {
  skeleton: OneTapUniversalResult;
  refine: Promise<OneTapUniversalResult | null>;
  cancel: () => void;
  perf: OneTapCapturePerf;
};

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export function startOneTapCapture(transcript: string, options: OneTapCaptureOptions): OneTapCaptureHandle {
  const pathAStartMs = nowMs();
  const a = inferOneTapPathA(transcript, { uiLocale: options.uiLocale, titleHint: options.titleHint });
  const pathAEndMs = nowMs();
  const ctrl = new AbortController();
  const hasGemini = options.gemini?.apiKey && options.gemini?.modelId;
  const perf: OneTapCapturePerf = {
    pathAStartMs,
    pathAEndMs,
    pathBStartMs: hasGemini ? nowMs() : null,
    pathBEndMs: null,
  };
  const refine = hasGemini
    ? geminiRefineOneTapJson({
        apiKey: options.gemini!.apiKey,
        modelId: options.gemini!.modelId,
        uiLocale: options.uiLocale,
        transcript,
        seed: a.result,
        refNowIso: options.gemini!.refNowIso,
        signal: ctrl.signal,
      }).finally(() => {
        perf.pathBEndMs = nowMs();
      })
    : Promise.resolve(null);
  return { skeleton: a.result, refine, cancel: () => ctrl.abort(), perf };
}
