import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../api/localDb';
import { IntentionReviewModal } from '../components/intention-modal/IntentionReviewModal';
import { geminiOneTapUniversalFromTranscript } from '../services/oneTapUniversalCapture';
import { buildIntentionDraftsFromGemini } from '../services/intention/intentionDraftBuilder';
import { persistIntentionDrafts } from '../services/intention/intentionCatalogPersistence';
import {
  getOfflineAudioById,
  getLatestPendingOfflineAudio,
  markOfflineAudioAsDone,
  markOfflineAudioAsKept,
  notifyOfflineAudioPendingAnalysis,
  OFFLINE_AUDIO_ACTION_ANALYZE,
  OFFLINE_AUDIO_ACTION_KEEP,
  queueOfflineAudioCapture,
} from '../services/intention/offlineAudioQueue';
import { getNotifications } from '../services/notifications';
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
    const net = await NetInfo.fetch();
    const online = net.isConnected === true && net.isInternetReachable === true;
    if (!online && audioUri) {
      const title = cleaned.slice(0, 56) || 'Memo audio';
      await queueOfflineAudioCapture({ transcript: cleaned, audioUri, title });
      dispatch({ type: 'CAPTURE_OFFLINE_QUEUED', transcript: cleaned, title });
      return;
    }
    dispatch({ type: 'CAPTURE_RECEIVED', transcript: cleaned, audioUri });
    try {
      const { parsed } = await geminiOneTapUniversalFromTranscript(cleaned, { uiLocale: 'fr' });
      const drafts = buildIntentionDraftsFromGemini(parsed, cleaned);
      dispatch({ type: 'PARSE_SUCCESS', drafts });
    } catch (e) {
      if (audioUri) {
        const title = cleaned.slice(0, 56) || 'Memo audio';
        await queueOfflineAudioCapture({ transcript: cleaned, audioUri, title });
        dispatch({ type: 'CAPTURE_OFFLINE_QUEUED', transcript: cleaned, title });
        return;
      }
      dispatch({ type: 'PARSE_ERROR', error: e instanceof Error ? e.message : String(e) });
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    }
  }, []);

  const analyzeLatestOfflineAudio = useCallback(async (queueId?: string) => {
    const pending = queueId ? await getOfflineAudioById(queueId) : await getLatestPendingOfflineAudio();
    if (!pending) return;
    dispatch({ type: 'CAPTURE_RECEIVED', transcript: pending.transcript, audioUri: pending.audio_path });
    try {
      const { parsed } = await geminiOneTapUniversalFromTranscript(pending.transcript, { uiLocale: 'fr' });
      const drafts = buildIntentionDraftsFromGemini(parsed, pending.transcript);
      dispatch({ type: 'PARSE_SUCCESS', drafts });
      await markOfflineAudioAsDone(pending.id);
    } catch (e) {
      dispatch({ type: 'PARSE_ERROR', error: e instanceof Error ? e.message : String(e) });
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

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected === true && state.isInternetReachable === true) {
        void notifyOfflineAudioPendingAnalysis();
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const n = getNotifications();
    if (!n) return;
    const sub = n.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.kind !== 'offline_audio_queue') return;
      if (response.actionIdentifier === OFFLINE_AUDIO_ACTION_KEEP) {
        if (typeof data.queueId === 'string') void markOfflineAudioAsKept(data.queueId);
        return;
      }
      if (
        response.actionIdentifier === OFFLINE_AUDIO_ACTION_ANALYZE ||
        response.actionIdentifier === n.DEFAULT_ACTION_IDENTIFIER
      ) {
        const queueId = typeof data.queueId === 'string' ? data.queueId : undefined;
        void analyzeLatestOfflineAudio(queueId);
      }
    });
    return () => sub.remove();
  }, [analyzeLatestOfflineAudio]);

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
