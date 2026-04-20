import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../api/localDb';
import { IntentionReviewModal } from '../components/intention-modal/IntentionReviewModal';
import { geminiOneTapUniversalFromTranscript } from '../services/oneTapUniversalCapture';
import { buildIntentionDraftsFromGemini } from '../services/intention/intentionDraftBuilder';
import { persistIntentionDrafts } from '../services/intention/intentionCatalogPersistence';
import {
  INITIAL_INTENTION_MACHINE_STATE,
  intentionStateMachineReducer,
  type IntentionDraft,
  type IntentionMachineState,
} from '../services/intention/IntentionStateMachine';

type CapturePayload = { transcript: string; audioUri: string | null };

type IntentionContextValue = {
  state: IntentionMachineState;
  startCapture: () => void;
  cancelCapture: () => void;
  submitCapturePayload: (payload: CapturePayload) => Promise<void>;
  updateDraft: (index: number, next: IntentionDraft) => void;
  confirmReview: () => Promise<void>;
  dismissReview: () => void;
};

const IntentionContext = createContext<IntentionContextValue | null>(null);

export function IntentionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(intentionStateMachineReducer, INITIAL_INTENTION_MACHINE_STATE);

  const startCapture = useCallback(() => {
    dispatch({ type: 'CAPTURE_START' });
  }, []);

  const cancelCapture = useCallback(() => {
    dispatch({ type: 'CAPTURE_CANCEL' });
  }, []);

  const submitCapturePayload = useCallback(async ({ transcript, audioUri }: CapturePayload) => {
    const cleaned = transcript.trim();
    if (!cleaned) {
      dispatch({ type: 'PARSE_ERROR', error: 'TRANSCRIPT_EMPTY' });
      return;
    }
    dispatch({ type: 'CAPTURE_RECEIVED', transcript: cleaned, audioUri });
    try {
      const { parsed } = await geminiOneTapUniversalFromTranscript(cleaned, { uiLocale: 'fr' });
      const drafts = buildIntentionDraftsFromGemini(parsed, cleaned);
      dispatch({ type: 'PARSE_SUCCESS', drafts });
    } catch (e) {
      dispatch({ type: 'PARSE_ERROR', error: e instanceof Error ? e.message : String(e) });
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    }
  }, []);

  const updateDraft = useCallback((index: number, next: IntentionDraft) => {
    dispatch({ type: 'UPDATE_DRAFT', index, draft: next });
  }, []);

  const confirmReview = useCallback(async () => {
    dispatch({ type: 'SAVE_START' });
    try {
      await persistIntentionDrafts(state.drafts);
      dispatch({ type: 'SAVE_SUCCESS' });
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      dispatch({ type: 'RESET' });
    } catch (e) {
      dispatch({ type: 'SAVE_ERROR', error: e instanceof Error ? e.message : String(e) });
      Alert.alert('Sauvegarde', e instanceof Error ? e.message : String(e));
    }
  }, [state.drafts]);

  const dismissReview = useCallback(() => {
    dispatch({ type: 'DISMISS_REVIEW' });
  }, []);

  const value = useMemo<IntentionContextValue>(
    () => ({
      state,
      startCapture,
      cancelCapture,
      submitCapturePayload,
      updateDraft,
      confirmReview,
      dismissReview,
    }),
    [cancelCapture, confirmReview, dismissReview, startCapture, state, submitCapturePayload, updateDraft],
  );

  return (
    <IntentionContext.Provider value={value}>
      {children}
      <IntentionReviewModal
        visible={state.status === 'REVIEWING' || state.status === 'SAVING'}
        busy={state.status === 'SAVING'}
        drafts={state.drafts}
        onChangeDraft={updateDraft}
        onConfirm={() => void confirmReview()}
        onDismiss={dismissReview}
      />
    </IntentionContext.Provider>
  );
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
