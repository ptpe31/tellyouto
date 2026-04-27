import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { DeviceEventEmitter } from 'react-native';

import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { orchestrateNewIntention } from '../services/intentionsPipeline';

type CapturePayload = { transcript: string; audioUri: string | null };

type IntentionContextValue = {
  startCapture: () => void;
  cancelCapture: () => void;
  submitCapturePayload: (payload: CapturePayload) => Promise<void>;
};

const IntentionContext = createContext<IntentionContextValue | null>(null);

export function IntentionProvider({ children }: { children: React.ReactNode }) {
  const startCapture = useCallback(() => undefined, []);
  const cancelCapture = useCallback(() => undefined, []);
  const submitCapturePayload = useCallback(async ({ transcript, audioUri }: CapturePayload) => {
    const cleaned = String(transcript || '').trim();
    if (!cleaned) return;
    await orchestrateNewIntention({
      source: audioUri ? 'VOICE' : 'TEXT',
      content: cleaned,
    });
    DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
  }, []);

  const value = useMemo<IntentionContextValue>(
    () => ({ startCapture, cancelCapture, submitCapturePayload }),
    [cancelCapture, startCapture, submitCapturePayload]
  );

  return <IntentionContext.Provider value={value}>{children}</IntentionContext.Provider>;
}

export function useIntentionContext(): IntentionContextValue {
  const value = useContext(IntentionContext);
  if (!value) {
    throw new Error('useIntentionContext must be used inside IntentionProvider');
  }
  return value;
}

export function useOptionalIntentionContext(): IntentionContextValue | null {
  return useContext(IntentionContext);
}
