import * as chrono from 'chrono-node';
import * as FileSystem from 'expo-file-system/legacy';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import {
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTION_PEEK_SNAPSHOT_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import {
  inferOneTapSkeletonFromTranscript,
  refineOneTapWithGeminiCompressed,
  splitBulkTranscript,
  type OneTapUniversalResult,
} from '../services/oneTapUniversalCapture';
import { hydrateOneTapDraftWithFavoriteAlias } from '../services/traffic/locationFavorites';
import { persistOneTapDraftVentilated, type PersistOneTapSuccess } from '../services/oneTapPersist';
import { showAppToast } from '../services/appToast';
import { getTrankilV2IntentionById } from '../api/trankilV2Db';
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
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import { generateSmartTitle } from '../services/smartTitle';
import { parseProjectMilestonesPayloadFromMetadataJson } from '../services/projectMilestonesModel';
import { VERBOSE_DEBUG } from '../config/verboseDebug';
import type { CaptureStrategyDeps } from '../services/captureStrategies/types';
import { newUuidV4 } from '../utils/uuid';
import { logCaptureFlow } from '../utils/captureFlowLog';
import {
  isLikelyNetworkOrServerError,
  isNetInfoConsideredOnline,
  logOfflineStability,
} from '../utils/offlineStability';

/**
 * Orchestration capture OneTap : séquenceur bulk unique (`runGeminiBulkSequence`), file offline SQLite, replay.
 * SPEC « Micro as Bulk(1) » — voir `PROJECT_STATUS.md` §2 / §3.2 / §4.1.
 */

type CapturePayload = { transcript: string; audioUri: string | null; lang?: string; traceId?: string };

/** Données proxy DealerBoard (Talk) : une ligne par intention persistée dans un bulk ventilé. */
function buildDealerBulkPeekItems(
  outcomes: PersistOneTapSuccess[],
  skeleton: { categoryTag?: string; predictedType?: string },
): Array<{ intentionId: string; title: string; categoryTag: string; predictedType: string }> {
  const categoryTag = String(skeleton.categoryTag ?? 'OTHER').trim() || 'OTHER';
  const items: Array<{ intentionId: string; title: string; categoryTag: string; predictedType: string }> = [];
  for (const o of outcomes) {
    if (o.kind === 'persisted_temporal') {
      items.push({
        intentionId: o.intentionId,
        title: o.title,
        categoryTag,
        predictedType: o.mirrorType === 'HABIT' ? 'HABIT' : 'TASK',
      });
    } else if (o.kind === 'simple_note_or_audio' && o.intentionId) {
      items.push({
        intentionId: o.intentionId,
        title: 'Note',
        categoryTag,
        predictedType: 'NOTE',
      });
    } else if (o.kind === 'list_inventory_persisted') {
      items.push({
        intentionId: o.intentionId,
        title: 'Liste',
        categoryTag,
        predictedType: 'LIST',
      });
    } else if (o.kind === 'project_persisted') {
      items.push({
        intentionId: o.intentionId,
        title: 'Projet',
        categoryTag,
        predictedType: 'PROJECT',
      });
    }
  }
  return items;
}

type IntentionContextValue = {
  startCapture: () => void;
  cancelCapture: () => void;
  submitCapturePayload: (payload: CapturePayload) => Promise<boolean>;
  triggerJalonZoom: (params: {
    projectIntentionId: string;
    parentJalonUid: string;
  }) => Promise<{ ok: true; children: { id: string; title: string }[] } | { ok: false; error: unknown }>;
};

const IntentionContext = createContext<IntentionContextValue | null>(null);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]) as Promise<T | null>;
}

function newId(): string {
  return newUuidV4();
}

function previewForLog(value: string, maxLen: number): string {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
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

  const userEditedRef = useRef(false);
  const lastCaptureWasMicRef = useRef(false);
  const lastAudioUriRef = useRef<string | null>(null);
  const captureActiveRef = useRef(false);
  const geminiSeqRef = useRef(0);
  const geminiStartedRef = useRef(false);
  const bulkProcessingRef = useRef(false);
  const bulkProgressIndexRef = useRef(-1);

  /** Réinitialise les refs capture au début d’une dictée / saisie. */
  const startCapture = useCallback(() => {
    userEditedRef.current = false;
    lastCaptureWasMicRef.current = false;
    lastAudioUriRef.current = null;
    captureActiveRef.current = true;
  }, []);

  /** Annule la capture en cours (sans persister) et invalide la séquence Gemini en cours. */
  const cancelCapture = useCallback(() => {
    userEditedRef.current = false;
    lastCaptureWasMicRef.current = false;
    lastAudioUriRef.current = null;
    captureActiveRef.current = false;
    geminiSeqRef.current += 1;
  }, []);

  /** Propose l’enqueue offline (`offline_audio_queue`) après échec réseau / IA. */
  const proposeOfflineFallback = useCallback(
    (params: { transcript: string; audioUri: string | null; error: unknown; lang?: string }) => {
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
                  await queueOfflineAudioCapture({ transcript: params.transcript, audioUri: params.audioUri, title, lang: params.lang });
                } else {
                  await queueOfflineTextCapture({ transcript: params.transcript, title, lang: params.lang });
                }
                DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
              })();
            },
          },
        ],
      );
    },
    [],
  );

  /**
   * Traite les chunks séquentiellement (Path A + Gemini non-stream par chunk), persiste via
   * `persistOneTapDraftVentilated` ; **interruption stricte** (`break`) si un chunk échoue (`!vr.ok`) ou lève
   * (invariant : pas de chunk N+1 sans succès DB du chunk N). Point d’entrée **Micro as Bulk(1)**.
   * En erreur réseau / serveur : enqueue auto vers la file SQLite (pas d’Alert obligatoire).
   */
  const runGeminiBulkSequence = useCallback(
    async (params: {
      transcript: string;
      audioUri: string | null;
      lang?: string;
      allowAlert: boolean;
      traceId?: string;
      chunks?: string[];
      parentId?: string | null;
      parentJalonUid?: string | null;
      silent?: boolean;
      /** Si `false`, pas d’enqueue auto réseau (ex. prompt interne zoom jalon). Défaut : comportement actif. */
      allowAutoOfflineQueue?: boolean;
      onPersisted?: (outcomes: PersistOneTapSuccess[]) => void;
    }): Promise<{ safeToDrainOfflineReplaySource: boolean }> => {
      const traceEarly = String(params.traceId || '').trim() || undefined;
      if (bulkProcessingRef.current) {
        logCaptureFlow(traceEarly, 'bulk_skip', { reason: 'bulk_processing' });
        return { safeToDrainOfflineReplaySource: false };
      }
      if (geminiStartedRef.current) {
        logCaptureFlow(traceEarly, 'bulk_skip', { reason: 'gemini_started' });
        return { safeToDrainOfflineReplaySource: false };
      }
      bulkProcessingRef.current = true;
      geminiStartedRef.current = true;
      const base = String(params.transcript || '').trim();
      const trace = String(params.traceId || '').trim();
      const isMic = Boolean(params.audioUri);
      if (__DEV__ && VERBOSE_DEBUG && isMic && trace) {
        console.log(`[SEQUENCER] 🔎 TRACE: ${trace}`);
      }
      let safeToDrainOfflineReplaySource = false;
      try {
        const chunks = Array.isArray(params.chunks) && params.chunks.length ? params.chunks : splitBulkTranscript(base);
        logCaptureFlow(trace || undefined, 'bulk_start', {
          chunkCount: chunks.length,
          silent: Boolean(params.silent),
          isMic,
        });
        const uiLocale = params.lang || spectrum.locale || 'fr-FR';
        const seq = (geminiSeqRef.current += 1);
        let savedAny = false;
        let autoQueuedThisRun = false;
        let bulkStoppedEarly = false;
        const habitsDefaultTitle = i18n.t('timeline.habit', { defaultValue: 'Habitude' });
        const birthdayLabel = i18n.t('timeline.birthday', { defaultValue: 'Anniversaire' });
        const total = chunks.length;

        const tryAutoQueueNetworkFailure = async (opts: {
          chunkIndex: number;
          error: unknown;
          reason: 'chunk_exception' | 'chunk_persist_fail';
        }): Promise<boolean> => {
          if (params.allowAutoOfflineQueue === false) {
            logOfflineStability('auto_queue_skipped_by_flag', { trace: trace || null, reason: opts.reason });
            return false;
          }
          if (!isLikelyNetworkOrServerError(opts.error)) {
            logOfflineStability('auto_queue_skipped_not_network', {
              trace: trace || null,
              reason: opts.reason,
              chunkIdx: opts.chunkIndex,
            });
            return false;
          }
          if (seq !== geminiSeqRef.current) return false;
          const remainder = chunks.slice(opts.chunkIndex).join('\n\n').trim();
          const textToQueue = (remainder.length ? remainder : base).trim() || base.trim();
          if (!textToQueue.trim()) return false;
          const title = textToQueue.slice(0, 56) || 'Memo';
          try {
            const useAudio = Boolean(params.audioUri) && !savedAny;
            if (useAudio && params.audioUri) {
              logOfflineStability('auto_queue_audio', {
                trace: trace || null,
                reason: opts.reason,
                chunkIdx: opts.chunkIndex,
                transcriptLen: textToQueue.length,
              });
              await queueOfflineAudioCapture({
                transcript: textToQueue,
                audioUri: params.audioUri,
                title,
                lang: params.lang,
              });
            } else {
              logOfflineStability('auto_queue_text', {
                trace: trace || null,
                reason: opts.reason,
                chunkIdx: opts.chunkIndex,
                partialAfterPriorChunks: savedAny,
                transcriptLen: textToQueue.length,
              });
              await queueOfflineTextCapture({ transcript: textToQueue, title, lang: params.lang });
            }
            DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
            logOfflineStability('auto_queue_done', { trace: trace || null, mode: useAudio ? 'audio' : 'text' });
            logCaptureFlow(trace || undefined, 'bulk_network_resilience_enqueue', {
              mode: useAudio ? 'audio' : 'text',
              chunkIdx: opts.chunkIndex,
            });
            return true;
          } catch (qe) {
            logOfflineStability('auto_queue_failed', { trace: trace || null, err: String(qe) });
            return false;
          }
        };

        for (let i = 0; i < chunks.length; i++) {
          bulkProgressIndexRef.current = i;
          try {
            if (seq !== geminiSeqRef.current) {
              return { safeToDrainOfflineReplaySource: false };
            }
            const chunk = chunks[i];
            const now = new Date();
            console.log(`********** ${now.toLocaleString('fr-FR')} **********`);
            console.log(`********* [CHUNK ${i + 1}/${total}] *********`);
            console.log(`[SEQUENCER] 🚀 Traitement : "${chunk}"${trace ? ` | TRACE: ${trace}` : ''}`);
            const progressLabel = `Création de ${i + 1}/${chunks.length}...`;
            if (!params.silent) {
              showAppToast(progressLabel, 1200);
            }
            const skeleton = inferOneTapSkeletonFromTranscript(chunk, { uiLocale });
            const res = await refineOneTapWithGeminiCompressed(chunk, skeleton, {
              uiLocale,
              lang: params.lang,
              useStream: false,
              forceComplete: true,
            });
            if (seq !== geminiSeqRef.current) {
              return { safeToDrainOfflineReplaySource: false };
            }
            const clean = generateSmartTitle(chunk, uiLocale);
            const d = (res.parsed as OneTapUniversalResult).data as Record<string, unknown>;
            const dueIso = typeof d.dueDateTime === 'string' ? d.dueDateTime.trim() : '';
            const parsedDue = dueIso ? new Date(dueIso) : null;
            const dueDate = parsedDue && Number.isFinite(parsedDue.getTime()) ? parsedDue : null;
            const ymd = dueDate
              ? formatYmdLocal(dueDate)
              : typeof d.dueDateYmd === 'string'
                ? d.dueDateYmd.trim()
                : '';
            const hm = dueDate
              ? new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(dueDate)
              : typeof d.dueTimeHm === 'string'
                ? d.dueTimeHm.trim()
                : '';
            const today = formatYmdLocal(now);
            const tomorrow = addDaysYmd(now, 1);
            const weekday =
              dueDate && ymd ? new Intl.DateTimeFormat(uiLocale, { weekday: 'long' }).format(dueDate) : '';
            const relativeDate =
              ymd === today
                ? "Aujourd’hui"
                : ymd === tomorrow
                  ? 'Demain'
                  : weekday
                    ? `${weekday.charAt(0).toLocaleUpperCase(uiLocale)}${weekday.slice(1)}`
                    : ymd
                      ? ymd
                      : '—';
            const timeLabel = hm || '—';
            const categoryCode = String(res.parsed.categoryTag || '').trim() || 'PERSO';
            const geminiMsLabel = Number.isFinite(res.httpMeta.latencyMs) ? String(Math.round(res.httpMeta.latencyMs)) : '—';
            const tokensTotalLabel =
              typeof res.httpMeta.tokensTotal === 'number' ? String(Math.round(res.httpMeta.tokensTotal)) : '—';
            const costLabel = Number.isFinite(res.httpMeta.estimatedCostUsd) ? `$${res.httpMeta.estimatedCostUsd.toFixed(6)}` : '—';
            console.log(`[IA-CORE]    ✨ CLEAN : "${clean}"`);
            console.log(`[IA-CORE]    📅 META  : ${relativeDate} • ${timeLabel} | 🏷️ ${categoryCode}`);
            console.log(
              `[IA-USAGE]   ⏱️ LATENCY : ${geminiMsLabel}ms | 🪙 TOKENS : ${tokensTotalLabel} | 💰 COST : ${costLabel}`,
            );
            const hydrated = await hydrateOneTapDraftWithFavoriteAlias(res.parsed);
            if (seq !== geminiSeqRef.current) {
              return { safeToDrainOfflineReplaySource: false };
            }
            logCaptureFlow(trace || undefined, 'chunk_ventilated_await', { idx: i + 1, total });
            const vr = await persistOneTapDraftVentilated({
              deps,
              draft: hydrated,
              transcript: chunk,
              habitsDefaultTitle,
              birthdayLabel,
              allowNoteFallback: false,
              parentId: params.parentId,
              parentJalonUid: params.parentJalonUid,
            });
            if (vr.ok) {
              savedAny = true;
              logCaptureFlow(trace || undefined, 'chunk_persist_ok', {
                idx: i + 1,
                total,
                outcomes: vr.outcomes.length,
              });
              DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
              params.onPersisted?.(vr.outcomes);
              const ids = vr.outcomes
                .map((o) => {
                  if (o && typeof (o as { intentionId?: unknown }).intentionId === 'string') return (o as { intentionId: string }).intentionId;
                  return '';
                })
                .filter(Boolean);
              const intentionId = ids[0] || '—';
              console.log(`[DATABASE]   ✅ Persistance confirmée (talkndone.db) | ID: ${intentionId}`);
              console.log(`[SEQUENCER]  ✅ Succès total pour le chunk ${i + 1}`);
              console.log('***************************************');
            } else {
              logCaptureFlow(trace || undefined, 'chunk_persist_fail', { idx: i + 1, total });
              console.log('[BulkSequence] ❌ CHUNK_FAILED:', { idx: i + 1, total: chunks.length });
              bulkStoppedEarly = true;
              if (await tryAutoQueueNetworkFailure({ chunkIndex: i, error: vr.error, reason: 'chunk_persist_fail' })) {
                autoQueuedThisRun = true;
              }
              break;
            }
          } catch (e) {
            logCaptureFlow(trace || undefined, 'chunk_exception', { idx: i + 1, total, err: String(e) });
            console.log('[BulkSequence] ❌ CHUNK_EXCEPTION:', { idx: i + 1, total: chunks.length, err: e });
            bulkStoppedEarly = true;
            if (await tryAutoQueueNetworkFailure({ chunkIndex: i, error: e, reason: 'chunk_exception' })) {
              autoQueuedThisRun = true;
            }
            break;
          } finally {
            bulkProgressIndexRef.current = -1;
          }
        }
        logCaptureFlow(trace || undefined, 'bulk_loop_done', { savedAny, chunkCount: chunks.length });
        console.log('********* SÉQUENCE BULK TERMINÉE (succès partiel ou total) *********');
        const allChunksDone = !bulkStoppedEarly;
        safeToDrainOfflineReplaySource = autoQueuedThisRun || allChunksDone;
        if (!savedAny && !autoQueuedThisRun && params.allowAlert) {
          proposeOfflineFallback({
            transcript: base,
            audioUri: params.audioUri,
            error: new Error('Bulk: aucune intention persistée'),
            lang: params.lang,
          });
          safeToDrainOfflineReplaySource = false;
        }
        if (savedAny && lastCaptureWasMicRef.current) {
          await consumeMicroIfNeeded({ isProUser: spectrum.isProUser });
        }
        userEditedRef.current = false;
        lastCaptureWasMicRef.current = false;
        lastAudioUriRef.current = null;
      } finally {
        bulkProgressIndexRef.current = -1;
        bulkProcessingRef.current = false;
        geminiStartedRef.current = false;
      }
      return { safeToDrainOfflineReplaySource };
    },
    [proposeOfflineFallback, spectrum.isProUser, spectrum.locale],
  );

  /**
   * Soumission post-dictée : Path A (peek) **toujours** en premier, puis NetInfo → file offline ou bulk Gemini.
   * `traceId` propagé pour les logs micro.
   */
  const submitCapturePayload = useCallback(
    async ({ transcript: rawTranscript, audioUri, lang, traceId }: CapturePayload): Promise<boolean> => {
      const cleaned = rawTranscript.trim();
      if (!cleaned) return false;
      const isMic = Boolean(audioUri);
      const trace = String(traceId || '').trim() || (isMic ? newId() : '');
      logCaptureFlow(trace || undefined, 'submit_enter', {
        isMic,
        transcriptLen: cleaned.length,
        hasAudio: Boolean(audioUri),
      });
      if (__DEV__ && VERBOSE_DEBUG && isMic) {
        const now = new Date();
        console.log(`************************************************************`);
        console.log(`🎙️  MICRO CAPTURE → SUBMIT  | ${now.toLocaleString('fr-FR')} | TRACE: ${trace}`);
        console.log(`************************************************************`);
        console.log(`[MIC] 🧩 TRANSCRIPT (${cleaned.length}c): "${previewForLog(cleaned, 220)}"`);
        console.log(`[MIC] 🎧 AUDIO_URI: ${audioUri ? 'yes' : 'no'} | LANG: ${lang || '—'}`);
      }
      captureActiveRef.current = false;
      lastCaptureWasMicRef.current = Boolean(audioUri);
      lastAudioUriRef.current = audioUri;
      userEditedRef.current = false;

      const uiLocale = lang || spectrum.locale || 'fr-FR';
      const skeleton = inferOneTapSkeletonFromTranscript(cleaned, { uiLocale });
      DeviceEventEmitter.emit(INTENTION_PEEK_SNAPSHOT_EVENT_NAME, {
        categoryTag: skeleton.categoryTag,
        predictedType: skeleton.predictedType,
        title: skeleton.title,
        transcript: cleaned,
      });
      logCaptureFlow(trace || undefined, 'peek_snapshot_emit', {
        categoryTag: skeleton.categoryTag,
        predictedType: skeleton.predictedType,
      });

      const net = await NetInfo.fetch();
      const online = isNetInfoConsideredOnline(net);
      if (online && net.isInternetReachable == null) {
        logOfflineStability('netinfo_online_null_reachable', {
          trace: trace || null,
          context: 'submit_capture_payload',
        });
      }
      logCaptureFlow(trace || undefined, 'submit_netinfo', {
        online,
        isConnected: net.isConnected,
        isInternetReachable: net.isInternetReachable,
      });
      if (__DEV__ && VERBOSE_DEBUG && isMic) {
        console.log(
          `[MIC] 🛰️ NETINFO: isConnected=${String(net.isConnected)} | isInternetReachable=${String(net.isInternetReachable)} | online=${String(online)}`,
        );
      }
      if (!online) {
        logCaptureFlow(trace || undefined, 'peek_snapshot_offline_queue', {
          categoryTag: skeleton.categoryTag,
          predictedType: skeleton.predictedType,
        });
        const title = cleaned.slice(0, 56) || 'Memo audio';
        if (__DEV__ && VERBOSE_DEBUG && isMic) {
          console.log(`[MIC] 📦 OFFLINE BRANCH → queue (title="${previewForLog(title, 80)}")`);
        }
        if (audioUri) {
          const queued = await queueOfflineAudioCapture({ transcript: cleaned, audioUri, title, lang });
          logCaptureFlow(trace || undefined, 'submit_offline_queued', {
            mode: 'audio',
            queueId: queued.queueId,
            intentionId: queued.intentionId,
            reason: 'netinfo_offline',
          });
          if (__DEV__ && VERBOSE_DEBUG && isMic) {
            console.log(`[MIC] 🗃️ OFFLINE QUEUED: queueId=${queued.queueId} | intentionId=${queued.intentionId}`);
          }
        } else {
          const queued = await queueOfflineTextCapture({ transcript: cleaned, title, lang });
          logCaptureFlow(trace || undefined, 'submit_offline_queued', {
            mode: 'text',
            queueId: queued.queueId,
            intentionId: queued.intentionId,
            reason: 'netinfo_offline',
          });
          if (__DEV__ && VERBOSE_DEBUG && isMic) {
            console.log(`[MIC] 🗃️ OFFLINE QUEUED: queueId=${queued.queueId} | intentionId=${queued.intentionId}`);
          }
        }
        DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
        logOfflineStability('submit_branch_offline_queued', { trace: trace || null, hasAudio: Boolean(audioUri) });
        return true;
      }

      logCaptureFlow(trace || undefined, 'bulk_sequence_await', {});
      const bulkOutcome = await runGeminiBulkSequence({
        transcript: cleaned,
        chunks: [cleaned],
        audioUri,
        lang: uiLocale,
        allowAlert: true,
        traceId: trace,
        silent: true,
        onPersisted: (outcomes) => {
          const firstId =
            outcomes
              .map((o) => ('intentionId' in o ? String((o as { intentionId?: unknown }).intentionId ?? '') : ''))
              .find((x) => x && x.trim().length) ?? '';
          logCaptureFlow(trace || undefined, 'persist_callback', { outcomes: outcomes.length, firstId: firstId || null });
          if (!firstId) return;
          const anyTitle =
            outcomes.find((o) => 'title' in o && typeof (o as { title?: unknown }).title === 'string') as
              | { title?: string }
              | undefined;
          const dealerBulkItems = buildDealerBulkPeekItems(outcomes, skeleton);
          // Même routage focus côté écrans que pour SNAPSHOT. `dealerBulkItems` : proxies Talk (DealerBoard) cascade.
          DeviceEventEmitter.emit(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, {
            intentionId: firstId,
            categoryTag: skeleton.categoryTag,
            predictedType: skeleton.predictedType,
            title: String(anyTitle?.title ?? skeleton.title ?? cleaned.slice(0, 200)),
            transcript: cleaned,
            dealerBulkItems: dealerBulkItems.length > 0 ? dealerBulkItems : undefined,
          });
          logCaptureFlow(trace || undefined, 'peek_first_save_emit', { intentionId: firstId });
        },
      });
      logCaptureFlow(trace || undefined, 'submit_return_after_bulk', {});
      return bulkOutcome.safeToDrainOfflineReplaySource;
    },
    [runGeminiBulkSequence, spectrum.locale],
  );

  /** Zoom IA sur un jalon projet : prompt dédié puis `runGeminiBulkSequence` en mode enfant (`parentId` / jalon). */
  const triggerJalonZoom = useCallback(
    async (params: {
      projectIntentionId: string;
      parentJalonUid: string;
    }): Promise<{ ok: true; children: { id: string; title: string }[] } | { ok: false; error: unknown }> => {
      try {
        const uiLocale = spectrum.locale || 'fr-FR';
        const projectId = String(params.projectIntentionId || '').trim();
        const parentUid = String(params.parentJalonUid || '').trim();
        const projectRow = projectId ? await getTrankilV2IntentionById(projectId) : null;
        const projectTitle = String(projectRow?.title ?? '').trim();
        const original = String(projectRow?.content_raw ?? '').trim();
        const projectPayload = parseProjectMilestonesPayloadFromMetadataJson(projectRow?.metadata_json);
        const parentMilestone = projectPayload?.milestones.find((m) => m.uid === parentUid) ?? null;
        const parentTitle = String(parentMilestone?.title ?? '').trim();
        const parentDuration = parentMilestone ? `+${parentMilestone.estimated_duration}${parentMilestone.unit === 'hours' ? 'h' : parentMilestone.unit === 'weeks' ? 'sem' : 'j'}` : '';
        const persona = String(parentMilestone?.expert_persona ?? '').trim() || 'Assistant Personnel';
        const prompt =
          `Tu es un ${persona}. Ton objectif est de décomposer cette étape en sous-tâches chirurgicales et concrètes, en tenant compte du projet global : ${projectTitle || '—'} et de l'intention initiale : ${original || '—'}.\n\n` +
          `Étape à décomposer: ${parentTitle || '—'}\n` +
          `Durée de l’étape: ${parentDuration || '—'}\n\n` +
          `Consigne: Décompose uniquement cette étape en sous-tâches concrètes et actionnables.`;
        const children: { id: string; title: string }[] = [];
        await runGeminiBulkSequence({
          transcript: prompt,
          chunks: [prompt],
          audioUri: null,
          lang: uiLocale,
          allowAlert: true,
          allowAutoOfflineQueue: false,
          traceId: `zoom_${Date.now().toString(16)}`,
          parentId: projectId,
          parentJalonUid: parentUid,
          silent: true,
          onPersisted: (outcomes) => {
            for (const o of outcomes) {
              if (o.kind === 'persisted_temporal' && o.mirrorType === 'TASK') {
                children.push({ id: o.intentionId, title: o.title });
              }
            }
          },
        });
        console.log(`[SQL_TRACE] ✅ Persistance sous-jalons (${children.length}) pour Parent ID: ${projectId}`);
        return { ok: true, children };
      } catch (e) {
        return { ok: false, error: e };
      }
    },
    [runGeminiBulkSequence, spectrum.locale],
  );

  /** Rejoue une capture `pending` via `submitCapturePayload` ; ne marque la queue `done` qu’après succès confirmé. */
  const analyzeLatestOfflineAudio = useCallback(
    async (queueId?: string) => {
      const pending = queueId ? await getOfflineAudioById(queueId) : await getLatestPendingOfflineAudio();
      if (!pending) return;
      const t0 = String(pending.transcript || '').trim();
      if (!t0) return;
      try {
        const safeToDrain = await submitCapturePayload({
          transcript: t0,
          audioUri: pending.audio_path || null,
          lang: pending.speech_lang,
        });
        if (safeToDrain) {
          await markOfflineAudioAsDone(pending.id);
          logOfflineStability('replay_queue_marked_done', { queueId: pending.id });
        } else {
          logOfflineStability('replay_left_pending', { queueId: pending.id });
        }
      } catch (e) {
        logOfflineStability('replay_submit_threw', { queueId: pending.id, err: String(e) });
      }
    },
    [submitCapturePayload],
  );

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      if (isNetInfoConsideredOnline(s)) {
        if (s.isInternetReachable == null) {
          logOfflineStability('netinfo_online_null_reachable', { context: 'netinfo_listener_replay' });
        }
        void (async () => {
          await notifyOfflineAudioPendingAnalysis();
          await analyzeLatestOfflineAudio();
        })();
      }
    });
    return () => unsub();
  }, [analyzeLatestOfflineAudio]);

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
      triggerJalonZoom,
    }),
    [cancelCapture, startCapture, submitCapturePayload, triggerJalonZoom],
  );

  return (
    <IntentionContext.Provider value={value}>
      {children}
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
