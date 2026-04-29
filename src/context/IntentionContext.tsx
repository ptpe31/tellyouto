import * as chrono from 'chrono-node';
import * as FileSystem from 'expo-file-system/legacy';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { OneTapConfirmModal } from '../components/OneTapConfirmModal';
import {
  inferOneTapSkeletonFromTranscript,
  refineOneTapWithGeminiCompressed,
  type OneTapUniversalResult,
} from '../services/oneTapUniversalCapture';
import { hydrateOneTapDraftWithFavoriteAlias } from '../services/traffic/locationFavorites';
import {
  finalizeOneTapOptimisticDraft,
  preSaveOneTapOptimisticDraft,
  replacePendingOneTapDraft,
} from '../services/oneTapPersist';
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

function readDraftIntents(draft: OneTapUniversalResult): Record<string, unknown>[] {
  const data = (draft.data ?? {}) as Record<string, unknown>;
  const raw = (data as { intents?: unknown }).intents;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
}

function isCompleteIntent(it: Record<string, unknown>): boolean {
  const type = String(it.type ?? '').trim().toUpperCase();
  if (!type) return false;
  if (type === 'LIST') {
    const items = Array.isArray(it.items) ? it.items : [];
    return items.length > 0;
  }
  if (type === 'TRIP') {
    const destination = String(it.destination ?? it.content ?? it.title ?? '').trim();
    return destination.length > 0;
  }
  const title = String(it.title ?? it.content ?? '').trim();
  return title.length > 0;
}

function buildListDraftBlock(params: {
  title: string;
  items: { name: string; baseQuantity?: number; unit?: string; scalable?: boolean; includeInSave?: boolean }[];
  baseCount: number;
  unitLabel?: string;
}): Record<string, unknown> {
  const baseCount = Math.max(1, Math.round(Number(params.baseCount ?? 1)));
  const unitLabel = String(params.unitLabel ?? 'personne').trim() || 'personne';
  return {
    title: params.title,
    baseCount,
    unitLabel,
    categories: [
      {
        name: '—',
        items: params.items.map((it) => ({
          name: String(it.name ?? '').trim().slice(0, 120),
          baseQuantity:
            it.baseQuantity !== undefined && Number.isFinite(Number(it.baseQuantity)) && Number(it.baseQuantity) > 0
              ? Number(it.baseQuantity)
              : 1 / baseCount,
          unit: String(it.unit ?? 'piece').trim() || 'piece',
          scalable: it.scalable !== false,
          includeInSave: it.includeInSave !== false,
        })),
      },
    ],
  };
}

function buildOneTapDraftFromIntent(params: {
  baseDraft: OneTapUniversalResult;
  intent: Record<string, unknown>;
}): OneTapUniversalResult | null {
  const { baseDraft, intent } = params;
  const type = String(intent.type ?? '').trim().toUpperCase();
  const categoryTag =
    (typeof intent.category === 'string' ? intent.category.trim().slice(0, 80) : '') || baseDraft.categoryTag;
  if (type === 'LIST') {
    const title = String(intent.title ?? '').trim() || baseDraft.title;
    const itemsRaw = Array.isArray(intent.items) ? intent.items : [];
    const baseCount = Number(intent.baseCount ?? 1);
    const unitLabel = typeof intent.unitLabel === 'string' ? intent.unitLabel : undefined;
    const items = itemsRaw
      .map((x) => {
        if (!x) return null;
        if (typeof x === 'string') return { name: x.trim(), baseQuantity: 1 / Math.max(1, Math.round(baseCount)) };
        if (typeof x !== 'object' || Array.isArray(x)) return null;
        const r = x as Record<string, unknown>;
        const name = String(r.name ?? '').trim();
        if (!name) return null;
        const baseQuantity =
          r.baseQuantity !== undefined
            ? Number(r.baseQuantity)
            : r.qty !== undefined
              ? Number(r.qty) / Math.max(1, Math.round(baseCount))
              : 1 / Math.max(1, Math.round(baseCount));
        return {
          name,
          baseQuantity: Number.isFinite(baseQuantity) && baseQuantity > 0 ? baseQuantity : 1 / Math.max(1, Math.round(baseCount)),
          unit: typeof r.unit === 'string' ? r.unit : undefined,
          scalable: r.scalable !== false,
          includeInSave: r.includeInSave !== false,
        };
      })
      .filter(Boolean) as { name: string; baseQuantity?: number; unit?: string; scalable?: boolean; includeInSave?: boolean }[];
    if (!items.length) return null;
    const listBlock = buildListDraftBlock({ title, items, baseCount, unitLabel });
    return {
      ...baseDraft,
      categoryTag,
      title: title.trim().slice(0, 200) || baseDraft.title,
      predictedType: 'LIST',
      data: { list: listBlock },
    };
  }
  if (type === 'TASK') {
    const content = String(intent.content ?? '').trim() || baseDraft.title;
    const notes = typeof intent.notes === 'string' ? intent.notes.trim() : '';
    const dueIso = typeof intent.due === 'string' ? intent.due.trim() : '';
    return {
      ...baseDraft,
      categoryTag,
      title: content.slice(0, 200) || baseDraft.title,
      predictedType: 'TASK',
      data: {
        ...(dueIso ? { dueDateTime: dueIso } : {}),
        ...(notes ? { notes: notes.slice(0, 2000) } : {}),
      },
    };
  }
  if (type === 'TRIP') {
    const destination = String(intent.destination ?? intent.content ?? intent.title ?? '').trim() || String((baseDraft.data as Record<string, unknown>)?.destination_name ?? baseDraft.title);
    if (!destination) return null;
    const dueIso =
      typeof intent.arrivalDue === 'string' ? intent.arrivalDue.trim() : typeof intent.due === 'string' ? intent.due.trim() : '';
    const addr = String((baseDraft.data as Record<string, unknown>)?.location_address ?? '').trim();
    return {
      ...baseDraft,
      categoryTag,
      title: destination.slice(0, 200) || baseDraft.title,
      predictedType: 'TRIP',
      data: {
        logisticsPotential: true,
        destination_name: destination.slice(0, 400),
        ...(dueIso ? { dueDateTime: dueIso } : {}),
        location_address: addr,
        location_place_id: (baseDraft.data as Record<string, unknown>).location_place_id ?? null,
        location_lat: (baseDraft.data as Record<string, unknown>).location_lat ?? null,
        location_lng: (baseDraft.data as Record<string, unknown>).location_lng ?? null,
        remind_to_leave: Boolean((baseDraft.data as Record<string, unknown>).remind_to_leave),
      },
    };
  }
  if (type === 'HABIT') {
    const content = String(intent.content ?? '').trim() || baseDraft.title;
    const rec = typeof intent.recurrence === 'string' ? intent.recurrence.trim() : '';
    const pref = typeof intent.preferredTime === 'string' ? intent.preferredTime.trim() : '';
    return {
      ...baseDraft,
      categoryTag,
      title: content.slice(0, 200) || baseDraft.title,
      predictedType: 'HABIT',
      data: {
        ...(rec ? { cadenceDescription: rec.slice(0, 500), recurrence: { summary: rec.slice(0, 500) } } : {}),
        ...(pref ? { preferredTimeHm: pref } : {}),
      },
    };
  }
  if (type === 'NOTE') {
    const content = String(intent.content ?? '').trim() || String((baseDraft.data as Record<string, unknown>)?.memo ?? '');
    if (!content) return null;
    return {
      ...baseDraft,
      categoryTag,
      title: baseDraft.title,
      predictedType: 'NOTE',
      data: { memo: content.slice(0, 4000) },
    };
  }
  return null;
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
  const lastAudioUriRef = useRef<string | null>(null);
  const captureActiveRef = useRef(false);
  const draftRef = useRef<OneTapUniversalResult>(draft);
  const transcriptRef = useRef(transcript);
  const streamSeqRef = useRef(0);
  const geminiSeqRef = useRef(0);
  const streamTimerRef = useRef<number | null>(null);
  const intentIdByIndexRef = useRef<Record<string, string>>({});
  const intentReplaceTimersRef = useRef<Record<string, number>>({});

  const startCapture = useCallback(() => {
    userEditedRef.current = false;
    lastCaptureWasMicRef.current = false;
    lastAudioUriRef.current = null;
    captureActiveRef.current = true;
    streamSeqRef.current = 0;
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    for (const k of Object.keys(intentReplaceTimersRef.current)) {
      clearTimeout(intentReplaceTimersRef.current[k]);
    }
    intentReplaceTimersRef.current = {};
    intentIdByIndexRef.current = {};
    setTranscript('');
    setDraft(inferOneTapSkeletonFromTranscript('', { uiLocale: spectrum.locale || 'fr' }));
    setVisible(false);
    setRefining(true);
    setBusy(false);
  }, [spectrum.locale]);

  const cancelCapture = useCallback(() => {
    userEditedRef.current = false;
    lastCaptureWasMicRef.current = false;
    lastAudioUriRef.current = null;
    captureActiveRef.current = false;
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    for (const k of Object.keys(intentReplaceTimersRef.current)) {
      clearTimeout(intentReplaceTimersRef.current[k]);
    }
    intentReplaceTimersRef.current = {};
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

  const runGeminiStreamRefine = useCallback(
    async (params: { transcript: string; openModal: boolean; allowAlert: boolean; audioUri: string | null }) => {
      const cleaned = params.transcript.trim();
      if (!cleaned) return;
      const uiLocale = spectrum.locale || 'fr';
      const seq = (geminiSeqRef.current += 1);
      if (params.openModal) {
        setVisible(true);
      }
      setRefining(true);
      const hasExistingIntents = readDraftIntents(draftRef.current).length > 0;
      const skeleton = hasExistingIntents
        ? draftRef.current
        : inferOneTapSkeletonFromTranscript(cleaned, { uiLocale });
      if (!hasExistingIntents) {
        setDraft(skeleton);
      }
      try {
        const res = await refineOneTapWithGeminiCompressed(cleaned, skeleton, {
          uiLocale,
          useStream: true,
          onPartial: (partial) => {
            if (seq !== geminiSeqRef.current) return;
            if (userEditedRef.current) return;
            setDraft(partial);
          },
        });
        if (seq !== geminiSeqRef.current) return;
        if (!userEditedRef.current) {
          const hydrated = await hydrateOneTapDraftWithFavoriteAlias(res.parsed);
          if (seq !== geminiSeqRef.current) return;
          setDraft(hydrated);
        }
      } catch (e) {
        if (params.allowAlert) {
          proposeOfflineFallback({ transcript: cleaned, audioUri: params.audioUri, error: e });
        }
      } finally {
        if (seq === geminiSeqRef.current) {
          setRefining(false);
        }
      }
    },
    [proposeOfflineFallback, spectrum.locale],
  );

  const submitCapturePayload = useCallback(
    async ({ transcript: rawTranscript, audioUri }: CapturePayload) => {
      const cleaned = rawTranscript.trim();
      if (!cleaned) return;
      captureActiveRef.current = false;
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      lastCaptureWasMicRef.current = Boolean(audioUri);
      lastAudioUriRef.current = audioUri;
      userEditedRef.current = false;
      setTranscript(cleaned);
      setVisible(true);

      const net = await NetInfo.fetch();
      const online = net.isConnected === true && net.isInternetReachable === true;
      if (!online && audioUri) {
        const title = cleaned.slice(0, 56) || 'Memo audio';
        await queueOfflineAudioCapture({ transcript: cleaned, audioUri, title });
        setVisible(false);
        setRefining(false);
        DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
        return;
      }

      if (online) {
        void runGeminiStreamRefine({ transcript: cleaned, openModal: false, allowAlert: true, audioUri });
      }
    },
    [runGeminiStreamRefine],
  );

  const confirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const habitsDefaultTitle = i18n.t('timeline.habit', { defaultValue: 'Habitude' });
      const birthdayLabel = i18n.t('timeline.birthday', { defaultValue: 'Anniversaire' });
      const intents = readDraftIntents(draft).filter(isCompleteIntent);
      if (!intents.length) {
        const title = transcript.trim().slice(0, 56) || 'Memo';
        const audioUri = lastAudioUriRef.current;
        if (audioUri) {
          await queueOfflineAudioCapture({ transcript: transcript.trim(), audioUri, title });
        } else {
          await queueOfflineTextCapture({ transcript: transcript.trim(), title });
        }
        setVisible(false);
        setRefining(false);
        userEditedRef.current = false;
        lastCaptureWasMicRef.current = false;
        lastAudioUriRef.current = null;
        DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        return;
      }

      const successes: boolean[] = [];
      for (let i = 0; i < intents.length; i++) {
        const built = buildOneTapDraftFromIntent({ baseDraft: draft, intent: intents[i] });
        if (!built) continue;
        const idxKey = String(readDraftIntents(draft).indexOf(intents[i]));
        let intentionId = intentIdByIndexRef.current[idxKey];
        if (!intentionId) {
          const pre = await preSaveOneTapOptimisticDraft({
            deps,
            draft: built,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
          });
          if (!pre.ok) continue;
          intentionId = pre.intentionId;
          intentIdByIndexRef.current[idxKey] = intentionId;
        }
        const fin = await finalizeOneTapOptimisticDraft({
          deps,
          intentionId,
          draft: built,
          transcript,
          habitsDefaultTitle,
          birthdayLabel,
        });
        successes.push(fin.ok);
      }
      if (!successes.some(Boolean)) {
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
      lastAudioUriRef.current = null;
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      showAppToast(i18n.t('talkDebug.oneTapRefineFailedToast', { defaultValue: 'Sauvegarde impossible.' }), 4200);
    } finally {
      setBusy(false);
    }
  }, [busy, deps, draft, transcript]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!captureActiveRef.current) return;
    const text = event.results?.[0]?.transcript ?? '';
    if (!text.trim()) return;
    setTranscript(text);
    const seq = (streamSeqRef.current += 1);
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = setTimeout(() => {
      void (async () => {
        if (!captureActiveRef.current) return;
        const snap = text.trim();
        if (snap.length < 16) return;
        const net = await NetInfo.fetch();
        const online = net.isConnected === true && net.isInternetReachable === true;
        if (!online) return;
        if (seq !== streamSeqRef.current) return;
        void runGeminiStreamRefine({ transcript: snap, openModal: false, allowAlert: false, audioUri: null });
      })();
    }, 850) as unknown as number;
  });

  useEffect(() => {
    if (!captureActiveRef.current) return;
    const habitsDefaultTitle = i18n.t('timeline.habit', { defaultValue: 'Habitude' });
    const birthdayLabel = i18n.t('timeline.birthday', { defaultValue: 'Anniversaire' });
    const intents = readDraftIntents(draft);
    void (async () => {
      for (let idx = 0; idx < intents.length; idx++) {
        const it = intents[idx];
        if (!isCompleteIntent(it)) continue;
        const idxKey = String(idx);
        const built = buildOneTapDraftFromIntent({ baseDraft: draftRef.current, intent: it });
        if (!built) continue;
        const existingId = intentIdByIndexRef.current[idxKey];
        if (!existingId) {
          const pre = await preSaveOneTapOptimisticDraft({
            deps,
            draft: built,
            transcript: transcriptRef.current,
            habitsDefaultTitle,
            birthdayLabel,
          });
          if (pre.ok) {
            intentIdByIndexRef.current[idxKey] = pre.intentionId;
          }
          continue;
        }
        if (intentReplaceTimersRef.current[existingId]) continue;
        intentReplaceTimersRef.current[existingId] = setTimeout(() => {
          delete intentReplaceTimersRef.current[existingId];
          void replacePendingOneTapDraft({
            deps,
            intentionId: existingId,
            draft: built,
            transcript: transcriptRef.current,
            habitsDefaultTitle,
            birthdayLabel,
          });
        }, 240) as unknown as number;
      }
    })();
  }, [deps, draft]);

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
      <OneTapConfirmModal
        visible={visible}
        draft={draft}
        transcript={transcript}
        refinePhase={refining ? 'streaming' : 'done'}
        busy={busy}
        onUserEdited={() => {
          userEditedRef.current = true;
        }}
        onChangeDraft={(next) => {
          setDraft(next);
        }}
        onChangeTranscript={(next) => {
          setTranscript(next);
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
