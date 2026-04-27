import * as chrono from 'chrono-node';
import * as FileSystem from 'expo-file-system/legacy';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { SasModal } from '../../src_v2/components/SasModal/SasModal';
import {
  geminiOneTapUniversalFromTranscript,
  inferOneTapSkeletonFromTranscript,
  type OneTapUniversalResult,
} from '../services/oneTapUniversalCapture';
import { hydrateOneTapDraftWithFavoriteAlias } from '../services/traffic/locationFavorites';
import { persistOneTapDraftVentilated } from '../services/oneTapPersist';
import { showAppToast } from '../services/appToast';
import {
  getOfflineAudioById,
  getLatestPendingOfflineAudio,
  markOfflineAudioAsDone,
  markOfflineAudioAsKept,
  notifyOfflineAudioPendingAnalysis,
  OFFLINE_AUDIO_ACTION_ANALYZE,
  OFFLINE_AUDIO_ACTION_KEEP,
  queueOfflineAudioCapture,
  queueOfflineTextCapture,
} from '../services/intention/offlineAudioQueue';
import { consumeMicroIfNeeded } from '../../src_v2/services/permissions/PermissionService';
import { getNotifications } from '../services/notifications';
import { useUserSpectrum } from './UserSpectrumContext';
import i18n from '../locales/i18n';
import { formatYmdLocal } from '../services/TimeSorter';
import type { CaptureStrategyDeps } from '../services/captureStrategies/types';

type CapturePayload = { transcript: string; audioUri: string | null };

type IntentionContextValue = {
  startCapture: () => void;
  cancelCapture: () => void;
  submitCapturePayload: (payload: CapturePayload) => Promise<void>;
};

const IntentionContext = createContext<IntentionContextValue | null>(null);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]) as Promise<T | null>;
}

function newId(): string {
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseDueDateFromText(text: string, locale: string): string | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const loc = (locale || 'fr').toLowerCase();
  const ref = new Date();
  const parseWith = (mod: { parseDate?: (t: string, r: Date) => Date | null }) =>
    typeof mod?.parseDate === 'function' ? mod.parseDate(raw, ref) : null;
  let parsed: Date | null = null;
  if (loc.startsWith('fr')) parsed = parseWith(chrono.fr);
  else if (loc.startsWith('en')) parsed = parseWith(chrono.en);
  else if (loc.startsWith('de')) parsed = parseWith(chrono.de);
  else if (loc.startsWith('it')) parsed = parseWith(chrono.it);
  else if (loc.startsWith('es')) parsed = parseWith(chrono.es);
  else if (loc.startsWith('ja')) parsed = parseWith(chrono.ja);
  else if (loc.startsWith('zh')) parsed = parseWith(chrono.zh);
  else if (loc.startsWith('nl')) parsed = parseWith(chrono.nl);
  else if (loc.startsWith('sv')) parsed = parseWith(chrono.sv);
  else if (typeof (chrono as { parseDate?: (t: string, r: Date) => Date | null }).parseDate === 'function') {
    parsed = (chrono as { parseDate: (t: string, r: Date) => Date | null }).parseDate(raw, ref);
  } else {
    parsed = parseWith(chrono.en);
  }
  if (!parsed) return null;
  return formatYmdLocal(parsed);
}

async function persistAudioMemoFile(uri: string): Promise<string> {
  const source = String(uri || '').trim();
  if (!source) throw new Error('AUDIO_SOURCE_EMPTY');
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('LOCAL_STORAGE_UNAVAILABLE');
  const folder = `${root}audio-memos`;
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  const target = `${folder}/memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.m4a`;
  await FileSystem.copyAsync({ from: source, to: target });
  return target;
}

export function IntentionProvider({ children }: { children: React.ReactNode }) {
  const { spectrum } = useUserSpectrum();
  const deps = useMemo<CaptureStrategyDeps>(
    () => ({
      newId,
      spectrum: { locale: spectrum.locale, isProUser: spectrum.isProUser },
      withTimeout,
      parseDueDateFromText: (text) => parseDueDateFromText(text, spectrum.locale),
      emitTalkDebug: () => undefined,
      persistAudioMemoFile,
      translate: (key, options) => i18n.t(key, options),
    }),
    [spectrum.isProUser, spectrum.locale],
  );

  const [visible, setVisible] = useState(false);
  const [refining, setRefining] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState<OneTapUniversalResult>(() =>
    inferOneTapSkeletonFromTranscript('', { uiLocale: spectrum.locale || 'fr' }),
  );
  const [busy, setBusy] = useState(false);
  const userEditedRef = useRef(false);
  const lastCaptureWasMicRef = useRef(false);

  const startCapture = useCallback(() => {
    userEditedRef.current = false;
    lastCaptureWasMicRef.current = false;
    setVisible(false);
    setRefining(false);
    setBusy(false);
  }, []);

  const cancelCapture = useCallback(() => {
    userEditedRef.current = false;
    lastCaptureWasMicRef.current = false;
    setVisible(false);
    setRefining(false);
    setBusy(false);
  }, []);

  const proposeOfflineFallback = useCallback(
    (params: { transcript: string; audioUri: string | null; error: unknown }) => {
      const message = params.error instanceof Error ? params.error.message : String(params.error);
      Alert.alert(
        i18n.t('capture.errorTitle', { defaultValue: 'Capture' }),
        i18n.t('capture.offlineFallbackBody', {
          defaultValue: `Erreur IA (${message}). Sauvegarder hors-ligne ?`,
        }),
        [
          { text: i18n.t('channelSwitch.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
          {
            text: i18n.t('capture.offlineSaveAction', { defaultValue: 'Sauvegarder' }),
            onPress: () => {
              void (async () => {
                const title = params.transcript.slice(0, 56) || 'Memo';
                if (params.audioUri) {
                  await queueOfflineAudioCapture({ transcript: params.transcript, audioUri: params.audioUri, title });
                } else {
                  await queueOfflineTextCapture({ transcript: params.transcript, title });
                }
                setRefining(false);
                setVisible(false);
                DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
              })();
            },
          },
        ],
      );
    },
    [],
  );

  const submitCapturePayload = useCallback(
    async ({ transcript: rawTranscript, audioUri }: CapturePayload) => {
      const cleaned = rawTranscript.trim();
      if (!cleaned) return;
      lastCaptureWasMicRef.current = Boolean(audioUri);
      userEditedRef.current = false;
      setTranscript(cleaned);
      const skeleton = inferOneTapSkeletonFromTranscript(cleaned, { uiLocale: spectrum.locale || 'fr' });
      setDraft(skeleton);
      void (async () => {
        const hydrated = await hydrateOneTapDraftWithFavoriteAlias(skeleton);
        setDraft(hydrated);
      })();
      setVisible(true);
      setRefining(true);

      const net = await NetInfo.fetch();
      const online = net.isConnected === true && net.isInternetReachable === true;
      if (!online && audioUri) {
        const title = cleaned.slice(0, 56) || 'Memo audio';
        await queueOfflineAudioCapture({ transcript: cleaned, audioUri, title });
        setRefining(false);
        setVisible(false);
        DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
        return;
      }

      try {
        const out = await geminiOneTapUniversalFromTranscript(cleaned, { uiLocale: spectrum.locale || 'fr' });
        if (!userEditedRef.current) {
          const hydrated = await hydrateOneTapDraftWithFavoriteAlias(out.parsed);
          setDraft(hydrated);
        }
        setRefining(false);
      } catch (e) {
        setRefining(false);
        proposeOfflineFallback({ transcript: cleaned, audioUri, error: e });
      }
    },
    [proposeOfflineFallback, spectrum.locale],
  );

  const confirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const habitsDefaultTitle = i18n.t('timeline.habit', { defaultValue: 'Habitude' });
      const birthdayLabel = i18n.t('timeline.birthday', { defaultValue: 'Anniversaire' });
      const res = await persistOneTapDraftVentilated({
        deps,
        draft,
        transcript,
        habitsDefaultTitle,
        birthdayLabel,
      });
      if (!res.ok) {
        showAppToast(i18n.t('talkDebug.oneTapRefineFailedToast', { defaultValue: 'Sauvegarde impossible.' }), 4200);
        return;
      }
      if (lastCaptureWasMicRef.current) {
        await consumeMicroIfNeeded({ isProUser: spectrum.isProUser });
      }
      setVisible(false);
      setRefining(false);
      userEditedRef.current = false;
      lastCaptureWasMicRef.current = false;
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
    } catch (e) {
      showAppToast(i18n.t('talkDebug.oneTapRefineFailedToast', { defaultValue: 'Sauvegarde impossible.' }), 4200);
    } finally {
      setBusy(false);
    }
  }, [busy, deps, draft, transcript]);

  const analyzeLatestOfflineAudio = useCallback(
    async (queueId?: string) => {
      const pending = queueId ? await getOfflineAudioById(queueId) : await getLatestPendingOfflineAudio();
      if (!pending) return;
      const t0 = String(pending.transcript || '').trim();
      if (!t0) return;
      await markOfflineAudioAsDone(pending.id);
      await submitCapturePayload({ transcript: t0, audioUri: pending.audio_path || null });
    },
    [submitCapturePayload],
  );

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      if (s.isConnected === true && s.isInternetReachable === true) {
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
      if (response.actionIdentifier === OFFLINE_AUDIO_ACTION_ANALYZE || response.actionIdentifier === n.DEFAULT_ACTION_IDENTIFIER) {
        const queueId = typeof data.queueId === 'string' ? data.queueId : undefined;
        void analyzeLatestOfflineAudio(queueId);
      }
    });
    return () => sub.remove();
  }, [analyzeLatestOfflineAudio]);

  const value = useMemo<IntentionContextValue>(
    () => ({
      startCapture,
      cancelCapture,
      submitCapturePayload,
    }),
    [cancelCapture, startCapture, submitCapturePayload],
  );

  return (
    <IntentionContext.Provider value={value}>
      {children}
      <SasModal
        visible={visible}
        refining={refining}
        result={draft}
        transcript={transcript}
        busy={busy}
        onChangeResult={(next) => {
          userEditedRef.current = true;
          setDraft(next);
        }}
        onUserEdited={() => {
          userEditedRef.current = true;
        }}
        onConfirm={() => void confirm()}
        onDismiss={cancelCapture}
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
