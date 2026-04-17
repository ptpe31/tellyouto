import { randomUUID } from 'expo-crypto';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as chrono from 'chrono-node';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Bell, Check, Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import {
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../api/localDb';
import {
  consumeTrankilV2IntentCredit,
  consumeIaCredits,
  getTrankilV2UserStats,
  insertTrankilV2Intention,
} from '../api/trankilV2Db';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { runManualIaRechargeVideo } from '../services/AdManager';
import {
  atomizeProject,
  extractAnniversaryDetails,
  extractHabitRecurrence,
  type GeminiAnniversaryDetails,
  type GeminiExpertIntention,
  type GeminiHabitRecurrence,
} from '../services/GeminiExpert';
import { runIntentOrchestration } from '../services/IntentOrchestrator';
import { createLocalTemporalIntention } from '../services/localTemporalIntention';
import {
  buildProjectPlanPreview,
  exportProjectPlanToIcs,
  formatDueDateShort,
  persistGeminiExpertRows,
} from '../services/ProjectPlanFlowService';
import { cleanTranscriptText, generateSmartTitle, shouldLockSmartTitle } from '../services/smartTitle';
import {
  computeNextYearlyDueDateFromNativeDate,
  computePreparationDueDateFromText,
  formatYmdLocal,
  hasAnniversaryKeyword,
  isAnniversaryPreparationText,
} from '../services/TimeSorter';

function newId(): string {
  try {
    return randomUUID();
  } catch {
    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function TalkDebugScreen() {
  const { t } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const [captureStep, setCaptureStep] = useState<'idle' | 'recording' | 'deciding'>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rawTranscript, setRawTranscript] = useState('');
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [lockedTitle, setLockedTitle] = useState('');
  const [isTitleLocked, setIsTitleLocked] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [hasManualTitleEdit, setHasManualTitleEdit] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [deadlineModalVisible, setDeadlineModalVisible] = useState(false);
  const [deadlineText, setDeadlineText] = useState('');
  const [deadlineError, setDeadlineError] = useState('');
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [projectPlanPreview, setProjectPlanPreview] = useState<null | {
    projectTitle: string;
    rawInput: string;
    rows: GeminiExpertIntention[];
    selectedTaskIndexes: number[];
    taskAlarmIndexes: number[];
  }>(null);
  const [waveTick, setWaveTick] = useState(0);
  const recRef = useRef<Audio.Recording | null>(null);
  const waveformTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveScrollRef = useRef<ScrollView | null>(null);

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, ms: number): Promise<T | null> => {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    });
    return (await Promise.race([promise, timeout])) as T | null;
  }, []);

  const parseDueDateFromText = useCallback(
    (text: string): string | null => {
      const raw = String(text || '').trim();
      if (!raw) return null;
      const locale = (spectrum.locale || 'fr').toLowerCase();
      const ref = new Date();
      const parsed =
        locale.startsWith('fr')
          ? chrono.fr.parseDate(raw, ref)
          : locale.startsWith('en')
            ? chrono.en.parseDate(raw, ref)
            : chrono.parseDate(raw, ref);
      if (!parsed) return null;
      return formatYmdLocal(parsed);
    },
    [spectrum.locale],
  );

  useSpeechRecognitionEvent('result', (event) => {
      const text = event.results?.[0]?.transcript ?? '';
    if (text.trim().length > 0) {
      setRawTranscript(text);
      if (!isTitleLocked && shouldLockSmartTitle(text)) {
        const smart = generateSmartTitle(cleanTranscriptText(text), spectrum.locale);
        if (smart) {
          setLockedTitle(smart);
          setIsTitleLocked(true);
          if (!hasManualTitleEdit) setTitleDraft(smart);
        }
      }
    }
  });

  const waveHeights = useMemo(() => {
    return Array.from({ length: 9 }).map((_, i) => {
      const base = 8 + ((waveTick + i * 7) % 20);
      return isRecording ? base : 8;
    });
  }, [isRecording, waveTick]);

  const hardResetToIdle = useCallback(() => {
    if (waveformTimer.current) clearInterval(waveformTimer.current);
    waveformTimer.current = null;
    recRef.current = null;
    setIsPaused(false);
    setIsRecording(false);
    setCaptureStep('idle');
    setRawTranscript('');
    setTranscriptDraft('');
    setLockedTitle('');
    setIsTitleLocked(false);
    setTitleDraft('');
    setHasManualTitleEdit(false);
    setAudioUri(null);
    setDeadlineModalVisible(false);
    setDeadlineText('');
    setDeadlineError('');
    setIsGeneratingPlan(false);
    setProjectPlanPreview(null);
  }, []);

  const pushSuccessFeedback = useCallback((message: string) => {
    setSuccessMessage(message);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setSuccessMessage(''), 1800);
  }, []);

  const persistAudioMemoFile = useCallback(async (uri: string): Promise<string> => {
    const source = String(uri || '').trim();
    if (!source) throw new Error(t('talkDebug.errorAudioSourceEmpty'));
    const root = FileSystem.documentDirectory;
    if (!root) throw new Error(t('talkDebug.errorLocalStorageUnavailable'));
    const folder = `${root}audio-memos`;
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
    const target = `${folder}/memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.m4a`;
    await FileSystem.copyAsync({ from: source, to: target });
    return target;
  }, []);

  const startCapture = useCallback(async () => {
    if (isRecording || busy) return;
    setRawTranscript('');
    setLockedTitle('');
    setIsTitleLocked(false);
    setTitleDraft('');
    setHasManualTitleEdit(false);
    setAudioUri(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('talkHome.microphonePermissionTitle'), t('talkHome.microphonePermissionDeniedBody'));
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recRef.current = recording;
      await ExpoSpeechRecognitionModule.start({
        lang: spectrum.locale?.trim() || 'fr-FR',
        interimResults: true,
        continuous: true,
      });
      setIsRecording(true);
      setIsPaused(false);
      setCaptureStep('recording');
      waveformTimer.current = setInterval(() => setWaveTick((v) => v + 1), 180);
    } catch (e) {
      Alert.alert(t('talkDebug.captureTitle'), e instanceof Error ? e.message : String(e));
    }
  }, [busy, isRecording, spectrum.locale]);

  const stopCapture = useCallback(async () => {
    if (captureStep !== 'recording' || !isRecording) return;
    try {
      ExpoSpeechRecognitionModule.stop();
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        await rec.stopAndUnloadAsync();
        setAudioUri(rec.getURI() ?? null);
      }
    } catch (e) {
      Alert.alert(t('talkDebug.captureTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      if (waveformTimer.current) clearInterval(waveformTimer.current);
      waveformTimer.current = null;
      setIsRecording(false);
      setIsPaused(false);
      setTranscriptDraft(rawTranscript);
      const cleanedTranscript = cleanTranscriptText(rawTranscript);
      const fallbackTitle =
        (isTitleLocked ? lockedTitle : '') ||
        generateSmartTitle(cleanedTranscript, spectrum.locale) ||
        cleanedTranscript.trim();
      setTitleDraft(fallbackTitle);
      setHasManualTitleEdit(false);
      setCaptureStep('deciding');
    }
  }, [captureStep, isRecording, isTitleLocked, lockedTitle, rawTranscript, spectrum.locale]);

  const cancelCapture = useCallback(async () => {
    try {
      ExpoSpeechRecognitionModule.stop();
      const rec = recRef.current;
      if (rec) {
        await rec.stopAndUnloadAsync();
      }
    } catch {
      // Best effort cancel.
    } finally {
      hardResetToIdle();
    }
  }, [hardResetToIdle]);

  const togglePauseCapture = useCallback(async () => {
    if (captureStep !== 'recording') return;
    const rec = recRef.current;
    if (!rec || !isRecording) return;
    try {
      if (isPaused) {
        await rec.startAsync();
        await ExpoSpeechRecognitionModule.start({
          lang: spectrum.locale?.trim() || 'fr-FR',
          interimResults: true,
          continuous: true,
        });
        setIsPaused(false);
      } else {
        ExpoSpeechRecognitionModule.stop();
        await rec.pauseAsync();
        setIsPaused(true);
      }
    } catch (e) {
      Alert.alert(t('talkDebug.captureTitle'), e instanceof Error ? e.message : String(e));
    }
  }, [captureStep, isPaused, isRecording, spectrum.locale]);

  const saveQuickNoteToTimeline = useCallback(
    async (title: string, transcript: string) => {
      await insertTrankilV2Intention({
        id: newId(),
        type: 'NOTE',
        title: title.trim() || 'Note',
        due_date: null,
        content_raw: transcript,
        metadata_json: JSON.stringify(
          {
            source: 'talk_debug_quick_note',
            local_stt_transcript: transcript,
          },
          null,
          2,
        ),
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: 'sans_pression',
        parent_id: null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 0,
        created_at: Date.now(),
      });
    },
    [],
  );

  const onChooseAction = useCallback(
    async (action: 'note' | 'task' | 'habit' | 'project' | 'audio' | 'cancel') => {
      if (action === 'cancel') {
        hardResetToIdle();
        return;
      }
      setBusy(true);
      try {
        const finalTranscript = cleanTranscriptText(transcriptDraft.trim() || rawTranscript.trim());
        const buildHabitMeta = async (): Promise<{ recurrence_rule?: GeminiHabitRecurrence }> => {
          const recurrence = await withTimeout(extractHabitRecurrence(finalTranscript), 2500);
          if (!recurrence) return {};
          await consumeIaCredits(0.1);
          return { recurrence_rule: recurrence };
        };
        const buildAnniversaryMeta = async (): Promise<{
          details: GeminiAnniversaryDetails | null;
          dueDateYmd: string | null;
        }> => {
          const details = await withTimeout(extractAnniversaryDetails(finalTranscript), 2500);
          if (!details) return { details: null, dueDateYmd: null };
          await consumeIaCredits(0.1);
          const dueDateYmd = computeNextYearlyDueDateFromNativeDate(details.native_date);
          return { details, dueDateYmd };
        };
        const smartTitle = (
          titleDraft.trim() ||
          (isTitleLocked ? lockedTitle : '') ||
          generateSmartTitle(finalTranscript, spectrum.locale) ||
          finalTranscript
        ).trim();
        if (action === 'note') {
          await saveQuickNoteToTimeline(smartTitle || t('timeline.note'), finalTranscript);
          DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
          pushSuccessFeedback(t('talkDebug.noteSaved'));
          hardResetToIdle();
          return;
        } else if (action === 'task') {
          const orchestration = await runIntentOrchestration({
            fallbackText: finalTranscript,
            locale: spectrum.locale,
          });
          const hasAnniversary = hasAnniversaryKeyword(finalTranscript);
          const isPreparation = hasAnniversary && isAnniversaryPreparationText(finalTranscript);
          const dueDateYmd =
            computePreparationDueDateFromText(finalTranscript) ??
            (orchestration.schedule ? formatYmdLocal(orchestration.schedule) : null) ??
            parseDueDateFromText(finalTranscript);
          const intentType = hasAnniversary && !isPreparation
            ? 'HABIT'
            : orchestration.localType === 'HABIT'
              ? 'HABIT'
              : 'TASK';
          let metadataExtra: Record<string, unknown> = {};
          let finalDueDateYmd = dueDateYmd;
          let finalTitle = smartTitle || (intentType === 'HABIT' ? t('common.habits') : t('talkDebug.quickTask'));
          if (hasAnniversary && !isPreparation) {
            const ann = await buildAnniversaryMeta();
            if (ann.details) {
              finalDueDateYmd = ann.dueDateYmd ?? finalDueDateYmd;
              finalTitle = `🎂 ${t('talkDebug.birthdayLabel')} ${ann.details.personName}`.trim();
              metadataExtra = {
                ...metadataExtra,
                type: 'ANNIVERSARY',
                recurrence: 'yearly',
                native_date: ann.details.native_date,
                person_name: ann.details.personName,
              };
            }
          }
          if (hasAnniversary && isPreparation) {
            metadataExtra = {
              ...metadataExtra,
              related_to_habit: 'ANNIVERSARY',
            };
          }
          const habitMeta = intentType === 'HABIT' ? await buildHabitMeta() : {};
          await createLocalTemporalIntention({
            id: newId(),
            title: finalTitle,
            rawTranscript: finalTranscript,
            localType: intentType,
            dueDateYmd: finalDueDateYmd,
            suggestedTags:
              intentType === 'HABIT'
                ? Array.from(new Set([...(orchestration.suggestedTags ?? []), 'regulier']))
                : orchestration.suggestedTags,
            source: 'talk_debug_local_orchestrator',
            metadataExtra: {
              ...habitMeta,
              ...metadataExtra,
            },
          });
        } else if (action === 'habit') {
          const hasAnniversary = hasAnniversaryKeyword(finalTranscript);
          const ann = hasAnniversary ? await buildAnniversaryMeta() : { details: null, dueDateYmd: null };
          const habitMeta = await buildHabitMeta();
          await createLocalTemporalIntention({
            id: newId(),
            title: ann.details ? `🎂 ${t('talkDebug.birthdayLabel')} ${ann.details.personName}` : smartTitle || t('common.habits'),
            rawTranscript: finalTranscript,
            localType: 'HABIT',
            dueDateYmd: ann.dueDateYmd,
            suggestedTags: ['regulier'],
            source: 'talk_debug_habit_local',
            metadataExtra: {
              ...habitMeta,
              ...(ann.details
                ? {
                    type: 'ANNIVERSARY',
                    recurrence: 'yearly',
                    native_date: ann.details.native_date,
                    person_name: ann.details.personName,
                  }
                : {}),
            },
          });
        } else if (action === 'project') {
          // Projet: le titre doit venir du Goal Gemini, pas du smart title local.
          setTitleDraft('');
          setLockedTitle('');
          setIsTitleLocked(false);
          const stats = await getTrankilV2UserStats();
          if (stats.ia_credits <= 0) {
            Alert.alert(
              t('economy.recharge.modalTitle'),
              t('economy.recharge.modalBody'),
              [
                { text: t('common.later'), style: 'cancel' },
                {
                  text: t('economy.recharge.watchVideoCta'),
                  onPress: () => {
                    void (async () => {
                      const recharge = await runManualIaRechargeVideo();
                      if (!recharge.ok) {
                        const msg =
                          recharge.reason === 'daily_limit_reached'
                            ? t('economy.recharge.dailyCapReached')
                            : recharge.reason === 'recharge_cooldown'
                              ? t('economy.recharge.cooldown')
                              : t('economy.recharge.unavailableTitle');
                        Alert.alert(t('economy.recharge.modalTitle'), msg);
                      } else {
                        Alert.alert(t('economy.recharge.modalTitle'), t('economy.recharge.rewardToast'));
                      }
                    })();
                  },
                },
              ],
            );
            return;
          }
          setDeadlineText('');
          setDeadlineError('');
          setDeadlineModalVisible(true);
          return;
        } else if (action === 'audio') {
          if (!audioUri) {
            Alert.alert(t('talkDebug.audioTitle'), t('talkDebug.audioMissing'));
            return;
          }
          const storedUri = await persistAudioMemoFile(audioUri);
          await insertTrankilV2Intention({
            id: newId(),
            type: 'AUDIO',
            title: smartTitle || t('timeline.memoAudio'),
            due_date: null,
            content_raw: finalTranscript,
            metadata_json: JSON.stringify(
              {
                source: 'talk_debug_audio_memo',
                local_stt_transcript: finalTranscript,
                audio_uri: storedUri,
              },
              null,
              2,
            ),
            suggested_tags: JSON.stringify(['sans_pression']),
            category_id: 'sans_pression',
            parent_id: null,
            status: 'TODO',
            is_organized: 0,
            is_local_processed: 1,
            complexity_level: 0,
            created_at: Date.now(),
          });
          DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
          pushSuccessFeedback(t('talkDebug.audioSaved'));
          hardResetToIdle();
          return;
        }
        DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
        pushSuccessFeedback(t('talkDebug.actionSuccess'));
        hardResetToIdle();
      } catch (e) {
        Alert.alert(t('tabs.debug'), e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      audioUri,
      hardResetToIdle,
      hasManualTitleEdit,
      isTitleLocked,
      lockedTitle,
      parseDueDateFromText,
      persistAudioMemoFile,
      pushSuccessFeedback,
      rawTranscript,
      saveQuickNoteToTimeline,
      spectrum,
      t,
      titleDraft,
      transcriptDraft,
      withTimeout,
    ],
  );

  const submitProjectGenerationWithDeadline = useCallback(async () => {
    const finalTranscript = transcriptDraft.trim() || rawTranscript.trim();
    const cleanedDeadline = deadlineText.trim();
    if (!finalTranscript || !cleanedDeadline) return;
    const stats = await getTrankilV2UserStats();
    if (stats.ia_credits <= 0) {
      Alert.alert(t('economy.labels.aiCredits'), t('talkDebug.notEnoughCreditsGenerate'));
      return;
    }
    setIsGeneratingPlan(true);
    setDeadlineError('');
    try {
      const consolidatedPrompt = `Voici mon projet : ${cleanTranscriptText(finalTranscript)}. Je veux le terminer ${cleanedDeadline}. Genere un plan de taches structure en JSON.`;
      const expertRows = await atomizeProject(consolidatedPrompt);
      const deadlineYmd = parseDueDateFromText(cleanedDeadline);
      const normalizedRows = expertRows.map((row) => {
        if (row.type !== 'TASK') return row;
        return {
          ...row,
          metadata: {
            ...(row.metadata ?? {}),
            due_date: (() => {
              const fallback = String((row.metadata as { due_date?: unknown })?.due_date || '').trim();
              return deadlineYmd ?? (fallback || null);
            })(),
          },
        };
      });
      setDeadlineModalVisible(false);
      setProjectPlanPreview(buildProjectPlanPreview(finalTranscript, cleanedDeadline, normalizedRows));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('PLAN_JSON_PARSE_ERROR')) {
        setDeadlineError(t('talkDebug.planParseError'));
      } else {
        Alert.alert(t('common.projects'), msg || t('talkDebug.projectGenerationError'));
      }
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [deadlineText, parseDueDateFromText, rawTranscript, transcriptDraft]);

  const togglePlanTaskAlarm = useCallback((taskIndex: number) => {
    setProjectPlanPreview((prev) => {
      if (!prev) return prev;
      const has = prev.taskAlarmIndexes.includes(taskIndex);
      return {
        ...prev,
        taskAlarmIndexes: has ? prev.taskAlarmIndexes.filter((idx) => idx !== taskIndex) : [...prev.taskAlarmIndexes, taskIndex],
      };
    });
  }, []);

  const togglePlanTaskSelected = useCallback((taskIndex: number) => {
    setProjectPlanPreview((prev) => {
      if (!prev) return prev;
      const has = prev.selectedTaskIndexes.includes(taskIndex);
      return {
        ...prev,
        selectedTaskIndexes: has ? prev.selectedTaskIndexes.filter((idx) => idx !== taskIndex) : [...prev.selectedTaskIndexes, taskIndex],
      };
    });
  }, []);

  const onExportProjectPlanIcs = useCallback(async () => {
    if (!projectPlanPreview) return;
    try {
      await exportProjectPlanToIcs(projectPlanPreview);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('talkDebug.exportAgendaTitle'), msg || t('talkDebug.exportAgendaError'));
    }
  }, [projectPlanPreview]);

  const onValidateProjectPlan = useCallback(async () => {
    if (!projectPlanPreview) return;
    const stats = await getTrankilV2UserStats();
    if (stats.ia_credits <= 0) {
      Alert.alert(t('economy.labels.aiCredits'), t('talkDebug.notEnoughCreditsValidate'));
      return;
    }
    setBusy(true);
    try {
      await persistGeminiExpertRows(projectPlanPreview.rawInput, projectPlanPreview.rows, {
        taskAlarmIndexes: projectPlanPreview.taskAlarmIndexes,
        selectedTaskIndexes: projectPlanPreview.selectedTaskIndexes,
        audioUri,
      });
      const afterConsume = await consumeTrankilV2IntentCredit();
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      setProjectPlanPreview(null);
      Alert.alert(t('common.projects'), t('talkDebug.projectAnchored', { credits: afterConsume.ia_credits }));
      hardResetToIdle();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('common.projects'), msg || t('talkDebug.projectValidationError'));
    } finally {
      setBusy(false);
    }
  }, [audioUri, hardResetToIdle, projectPlanPreview]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('talkDebug.screenTitle')}</Text>
      {captureStep === 'idle' ? (
        <View style={styles.stepIdleWrap}>
          <Pressable
            onPress={() => void startCapture()}
            disabled={busy}
            style={[styles.micBtn, busy ? styles.disabled : null]}
          >
            <Mic size={24} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {captureStep === 'recording' ? (
        <View style={styles.stepRecordingWrap}>
          {isTitleLocked && lockedTitle.trim() ? (
            <View style={styles.liveTitleWrap}>
              <Text style={styles.liveTitleLabel}>{t('talkDebug.smartTitleDetected')}</Text>
              <Text style={styles.liveTitleValue}>{lockedTitle}</Text>
            </View>
          ) : null}
          <View style={styles.waveRow}>
            {waveHeights.map((h, idx) => (
              <View key={`bar-${idx}`} style={[styles.waveBar, { height: isPaused ? 8 : h }]} />
            ))}
          </View>
          <View style={styles.liveTranscriptWrap}>
            <ScrollView
              ref={(ref) => {
                liveScrollRef.current = ref;
              }}
              style={styles.liveTranscriptScroll}
              contentContainerStyle={styles.liveTranscriptContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => {
                if (captureStep === 'recording') {
                  liveScrollRef.current?.scrollToEnd({ animated: true });
                }
              }}
            >
              <Text style={styles.liveTranscript}>
                {rawTranscript.trim() ? rawTranscript : t('talkHome.listeningNow')}
              </Text>
            </ScrollView>
            <LinearGradient
              pointerEvents="none"
              colors={['#111827', 'rgba(17,24,39,0)']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.transcriptFadeTop}
            />
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(17,24,39,0)', '#111827']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.transcriptFadeBottom}
            />
          </View>
          <View style={styles.pilotRow}>
            <Pressable style={styles.ctrlBtn} onPress={() => void cancelCapture()} disabled={busy}>
              <Trash2 size={18} color="#fff" />
            </Pressable>
            <Pressable style={styles.ctrlBtn} onPress={() => void togglePauseCapture()} disabled={busy}>
              {isPaused ? <Play size={18} color="#fff" /> : <Pause size={18} color="#fff" />}
            </Pressable>
            <Pressable style={styles.ctrlBtn} onPress={() => void stopCapture()} disabled={busy}>
              <SendHorizontal size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {captureStep === 'deciding' ? (
        <View style={styles.stepDecisionWrap}>
          <View style={styles.titleDraftWrap}>
            <Text style={styles.titleDraftLabel}>{t('talkDebug.crystallizedTitleEditable')}</Text>
            <TextInput
              value={titleDraft}
              onChangeText={(value) => {
                setTitleDraft(value);
                setHasManualTitleEdit(true);
              }}
              placeholder={t('radar.fieldTitle')}
              placeholderTextColor="#94a3b8"
              style={styles.titleDraftInput}
            />
          </View>
          <TextInput
            value={transcriptDraft}
            onChangeText={setTranscriptDraft}
            multiline
            placeholder={t('talkDebug.emptyTranscription')}
            placeholderTextColor="#94a3b8"
            style={styles.decisionInput}
          />
          <Pressable
            style={[styles.quickNoteBtn, busy ? styles.disabled : null]}
            onPress={() => void onChooseAction('note')}
            disabled={busy}
          >
            <Text style={styles.quickNoteBtnText}>{t('talkDebug.validateNoteFree')}</Text>
          </Pressable>
          <Pressable
            style={[styles.quickAudioBtn, busy ? styles.disabled : null]}
            onPress={() => void onChooseAction('audio')}
            disabled={busy}
          >
            <Text style={styles.quickAudioBtnText}>{t('talkDebug.validateAudioFree')}</Text>
          </Pressable>
          <View style={styles.fanMenu}>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('project')} disabled={busy}>
              <Text style={styles.fanBtnText}>{t('talkDebug.actionProject')}</Text>
            </Pressable>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('task')} disabled={busy}>
              <Text style={styles.fanBtnText}>{t('talkDebug.actionTask')}</Text>
            </Pressable>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('note')} disabled={busy}>
              <Text style={styles.fanBtnText}>{t('talkDebug.actionNote')}</Text>
            </Pressable>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('habit')} disabled={busy}>
              <Text style={styles.fanBtnText}>{t('talkDebug.actionHabit')}</Text>
            </Pressable>
            <Pressable style={[styles.fanBtn, styles.cancelBtn]} onPress={() => void onChooseAction('cancel')} disabled={busy}>
              <Text style={styles.fanBtnText}>{t('common.later')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {deadlineModalVisible ? (
        <View style={styles.overlayBackdrop}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>{t('talkDebug.deadlineTitle')}</Text>
            <Text style={styles.overlaySub}>{t('talkDebug.deadlineSubtitle')}</Text>
            {deadlineError ? <Text style={styles.overlayError}>{deadlineError}</Text> : null}
            <View style={styles.quickDeadlineRow}>
              {[t('horizons.tomorrow'), t('talkDebug.oneWeek'), t('talkDebug.oneMonth')].map((choice) => (
                <Pressable key={choice} style={styles.quickDeadlineBtn} onPress={() => setDeadlineText(choice)} disabled={isGeneratingPlan}>
                  <Text style={styles.quickDeadlineText}>{choice}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={deadlineText}
              onChangeText={setDeadlineText}
              placeholder={t('talkDebug.deadlinePlaceholder')}
              placeholderTextColor="#94a3b8"
              style={styles.deadlineInput}
            />
            <View style={styles.overlayActions}>
              <Pressable style={[styles.overlayActionBtn, styles.cancelBtn]} onPress={() => setDeadlineModalVisible(false)} disabled={isGeneratingPlan}>
                <Text style={styles.fanBtnText}>{t('common.later')}</Text>
              </Pressable>
              <Pressable style={styles.overlayActionBtn} onPress={() => void submitProjectGenerationWithDeadline()} disabled={isGeneratingPlan || !deadlineText.trim()}>
                <Text style={styles.fanBtnText}>{isGeneratingPlan ? t('talkDebug.analyzingGemini') : t('talkDebug.generatePlan')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {projectPlanPreview ? (
        <View style={styles.overlayBackdrop}>
          <View style={styles.planCard}>
            <Text style={styles.overlayTitle}>{t('talkDebug.previewPlanTitle')}</Text>
            <Text style={styles.overlaySub}>{t('talkDebug.previewPlanSubtitle')}</Text>
            <Text style={styles.planProjectTitle}>{projectPlanPreview.projectTitle || t('common.projects')}</Text>
            <ScrollView style={styles.planScroll} contentContainerStyle={styles.planScrollContent}>
              {(() => {
                let taskIdx = -1;
                return projectPlanPreview.rows
                  .filter((row) => row.type === 'TASK')
                  .map((row) => {
                    taskIdx += 1;
                    const selected = projectPlanPreview.selectedTaskIndexes.includes(taskIdx);
                    const enabled = projectPlanPreview.taskAlarmIndexes.includes(taskIdx);
                    const dueDate = String((row.metadata as { due_date?: unknown })?.due_date || '').trim();
                    return (
                      <View key={`${row.title}-${taskIdx}`} style={styles.planTaskRow}>
                        <Pressable style={styles.planCheckBtn} onPress={() => togglePlanTaskSelected(taskIdx)}>
                          <Check size={16} color={selected ? '#008080' : 'rgba(44,62,80,0.35)'} />
                        </Pressable>
                        <Pressable style={styles.planBellBtn} onPress={() => togglePlanTaskAlarm(taskIdx)}>
                          <Bell size={20} color={enabled ? '#FF8C00' : 'rgba(44,62,80,0.35)'} />
                        </Pressable>
                        <View style={styles.planTaskMain}>
                          <Text style={[styles.planTaskText, !selected ? styles.planTaskTextMuted : null]}>{row.title}</Text>
                          <Text style={styles.planTaskDate}>{formatDueDateShort(dueDate)}</Text>
                        </View>
                      </View>
                    );
                  });
              })()}
            </ScrollView>
            <View style={styles.overlayActions}>
              <Pressable style={[styles.overlayActionBtn, styles.cancelBtn]} onPress={() => setProjectPlanPreview(null)} disabled={busy}>
                <Text style={styles.fanBtnText}>{t('common.later')}</Text>
              </Pressable>
              <Pressable style={styles.overlayActionBtn} onPress={() => void onExportProjectPlanIcs()} disabled={busy}>
                <Text style={styles.fanBtnText}>{t('talkDebug.exportToAgenda')}</Text>
              </Pressable>
              <Pressable style={styles.overlayActionBtn} onPress={() => void onValidateProjectPlan()} disabled={busy}>
                <Text style={styles.fanBtnText}>{t('talkDebug.anchorProject')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {successMessage ? (
        <View style={styles.successToast}>
          <Text style={styles.successToastText}>{successMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827', padding: 20, justifyContent: 'space-between' },
  title: { color: '#e5e7eb', fontSize: 18, fontWeight: '700', marginTop: 12 },
  stepIdleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepRecordingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 },
  stepDecisionWrap: { flex: 1, justifyContent: 'space-between', paddingVertical: 12 },
  titleDraftWrap: { marginBottom: 10 },
  titleDraftLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  titleDraftInput: {
    color: '#e2e8f0',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(15,23,42,0.45)',
    fontWeight: '700',
  },
  liveTitleWrap: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.5)',
    backgroundColor: 'rgba(15,118,110,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  liveTitleLabel: {
    color: '#99f6e4',
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  liveTitleValue: {
    color: '#e6fffb',
    fontSize: 15,
    fontWeight: '700',
  },
  waveRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 20 },
  waveBar: { width: 8, backgroundColor: '#22d3ee', borderRadius: 999 },
  transcript: { color: '#cbd5e1', fontSize: 16, textAlign: 'center', paddingHorizontal: 8 },
  decisionInput: {
    color: '#e2e8f0',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 110,
    maxHeight: 220,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  quickNoteBtn: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#0f766e',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  quickNoteBtnText: {
    color: '#ecfeff',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
  },
  quickAudioBtn: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#0b5b8f',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  quickAudioBtnText: {
    color: '#e0f2fe',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
  },
  liveTranscriptWrap: {
    width: '100%',
    maxHeight: 120,
    minHeight: 56,
    position: 'relative',
    justifyContent: 'center',
  },
  liveTranscriptScroll: {
    width: '100%',
  },
  liveTranscriptContent: {
    paddingVertical: 14,
  },
  liveTranscript: {
    color: '#BDC3C7',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 10,
    lineHeight: 22,
  },
  transcriptFadeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  transcriptFadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  micBtn: {
    alignSelf: 'center',
    marginBottom: 30,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: '#008080',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pilotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f766e',
  },
  disabled: { opacity: 0.5 },
  fanMenu: {
    gap: 10,
    paddingTop: 14,
    paddingBottom: 10,
  },
  fanBtn: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  fanBtnText: {
    color: '#0f172a',
    fontWeight: '700',
    textAlign: 'center',
  },
  cancelBtn: { backgroundColor: '#fee2e2' },
  overlayBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  overlayCard: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.4)',
    padding: 14,
    gap: 10,
  },
  planCard: {
    width: '100%',
    maxHeight: '90%',
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.4)',
    padding: 14,
    gap: 10,
  },
  overlayTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  overlaySub: { fontSize: 12, color: '#334155' },
  overlayError: { fontSize: 12, color: '#b91c1c', fontWeight: '700' },
  quickDeadlineRow: { flexDirection: 'row', gap: 8 },
  quickDeadlineBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,118,110,0.4)',
    backgroundColor: '#ecfeff',
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  quickDeadlineText: { color: '#0f766e', fontWeight: '700', fontSize: 12 },
  deadlineInput: {
    color: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.5)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  overlayActions: { gap: 8 },
  overlayActionBtn: {
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  planProjectTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  planScroll: { maxHeight: 320 },
  planScrollContent: { paddingBottom: 4, gap: 8 },
  planTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  planCheckBtn: { width: 28, alignItems: 'center', justifyContent: 'center' },
  planBellBtn: { width: 34, alignItems: 'center', justifyContent: 'center' },
  planTaskMain: { flex: 1 },
  planTaskText: { color: '#0f172a', fontSize: 13, fontWeight: '700' },
  planTaskTextMuted: { color: '#94a3b8' },
  planTaskDate: { color: '#475569', fontSize: 12, marginTop: 2 },
  successToast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(15,118,110,0.94)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  successToastText: {
    color: '#ecfeff',
    fontSize: 13,
    fontWeight: '700',
  },
});
