import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import * as Localization from 'expo-localization';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { LinearGradient } from 'expo-linear-gradient';
import { Mic, Pencil, UserCircle2, Waves } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IntentionOrbital,
  type IntentionOrbitalRef,
  type OrbitalSlot,
} from '../components/IntentionOrbital';
import {
  Alert,
  Animated,
  DeviceEventEmitter,
  Easing,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import {
  ensureRoutineIntentionInstancesForHorizon,
  insertIntention,
  insertRoutine,
  INTENTIONS_CHANGED_EVENT_NAME,
  listIntentionsDescending,
  type IntentionRow,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import type { TalkCaptureDebugPayload } from '../constants/talkCaptureDebug';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import type { AppLanguage } from '../context/LanguageContext';
import { useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  analyzeNewIntentionSemantics,
  computeRailAnchorAndFixedStartForNewIntention,
  estimateDurationMinutes,
  extractClockMinutesFromText,
  inferStructuralRoutinePlan,
  previewManualIntentionOverlapsHardRoutine,
  type BusyInterval,
} from '../services/agentLogic';
import {
  geminiDeepIntentionFromTranscript,
  geminiTranscribeAudioBase64,
  getGeminiApiKey,
  type GeminiAnalysisPromptLanguage,
} from '../services/geminiSemanticLab';
import {
  finalizeIntentWithCloudSemanticGraph,
  inferLocalFrequencyLabel,
  reformulateStructuredIntent,
  type VoiceIntentKind,
} from '../services/TranscriptionService';
import {
  alertNativeModuleMissing,
  isLikelyMissingNativeModuleError,
} from '../utils/nativeModuleErrorAlert';
import { resolveSpeechLangForSession } from '../utils/speechLocale';

type VoiceConfirmState = {
  rawTranscript: string;
  kind: VoiceIntentKind;
  editedTitle: string;
  editedTime: string;
  isEditing: boolean;
};

function mapInteractionToGeminiPrompt(lang: AppLanguage): GeminiAnalysisPromptLanguage {
  return lang === 'fr' ? 'fr' : 'en';
}

function newTalkEntityId(): string {
  try {
    return randomUUID();
  } catch {
    return `tlk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

function alertSpeechRecognitionError(
  t: TFunction,
  ev: ExpoSpeechRecognitionErrorEvent,
): void {
  if (ev.error === 'aborted') {
    return;
  }
  const title = t('talkHome.recordingErrorTitle');
  let body: string;
  switch (ev.error) {
    case 'not-allowed':
      body = t('talkHome.speechErrorNotAllowed');
      Alert.alert(title, body, [
        { text: t('channelSwitch.cancel'), style: 'cancel' },
        {
          text: t('ally.openSettings'),
          onPress: () => {
            void Linking.openSettings();
          },
        },
      ]);
      return;
    case 'service-not-allowed':
      body = t('talkHome.speechErrorService');
      break;
    case 'network':
      body = t('talkHome.speechErrorNetwork');
      break;
    case 'no-speech':
    case 'speech-timeout':
      body = t('talkHome.speechErrorNoSpeech');
      break;
    case 'client':
      body = t('talkHome.speechErrorClient');
      break;
    case 'interrupted':
      body = t('talkHome.speechErrorInterrupted');
      break;
    default:
      body = t('talkHome.speechErrorGeneric', {
        message: ev.message?.trim() || ev.error,
      });
  }
  Alert.alert(title, body);
}

/** Android 13+ : mode continu adapté au maintien du bouton ; iOS : continu. */
function speechContinuousForHold(): boolean {
  if (Platform.OS === 'ios') {
    return true;
  }
  if (Platform.OS === 'android' && typeof Platform.Version === 'number') {
    return Platform.Version >= 33;
  }
  return false;
}

export function TalkHomeScreen() {
  const { t, i18n } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  useTheme();
  const { spectrum } = useUserSpectrum();
  const { interactionLanguage } = useLanguage();
  const { connectEnabled, busyIntervals } = useCalendarIntegration();

  const [orbitalSlot, setOrbitalSlot] = useState<OrbitalSlot>('neutral');
  const orbitalRef = useRef<IntentionOrbitalRef>(null);
  const onOrbitalSlotChange = useCallback((slot: OrbitalSlot) => {
    setOrbitalSlot(slot);
  }, []);

  const [captureMode, setCaptureMode] = useState<'idle' | 'quick' | 'deep'>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isPostCaptureAnalyzing, setIsPostCaptureAnalyzing] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState<VoiceConfirmState | null>(null);
  const [livePartial, setLivePartial] = useState('');
  const voiceActiveRef = useRef(false);
  const startedAtRef = useRef<number>(0);
  const partialTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const speechErrorRef = useRef(false);
  const avRecordingRef = useRef<Audio.Recording | null>(null);
  const ringPulse = useRef(new Animated.Value(0)).current;
  const wavePulse = useRef(new Animated.Value(0)).current;

  const unloadAvRecording = useCallback(async () => {
    const rec = avRecordingRef.current;
    avRecordingRef.current = null;
    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        /* already stopped */
      }
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch {
      /* ignore */
    }
  }, []);

  const resetVoiceConfirm = useCallback(() => {
    setVoiceConfirm(null);
  }, []);

  useEffect(() => {
    if (!isRecording) {
      ringPulse.stopAnimation();
      ringPulse.setValue(0);
      wavePulse.stopAnimation();
      wavePulse.setValue(0);
      return;
    }
    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(ringPulse, {
          toValue: 0,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    const waveLoop = Animated.loop(
      Animated.timing(wavePulse, {
        toValue: 1,
        duration: 1300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      { resetBeforeIteration: true },
    );
    ringLoop.start();
    waveLoop.start();
    return () => {
      ringLoop.stop();
      waveLoop.stop();
    };
  }, [isRecording, ringPulse, wavePulse]);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    partialTranscriptRef.current = text;
    setLivePartial(text);
    if (event.isFinal && text.trim()) {
      finalTranscriptRef.current = text.trim();
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (event.error === 'aborted') {
      return;
    }
    speechErrorRef.current = true;
    const silent =
      event.error === 'no-speech' || event.error === 'speech-timeout';
    if (silent) {
      return;
    }
    alertSpeechRecognitionError(tRef.current, event);
    if (voiceActiveRef.current) {
      voiceActiveRef.current = false;
      setIsRecording(false);
      setCaptureMode('idle');
      partialTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      setLivePartial('');
    }
  });

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    void ExpoSpeechRecognitionModule.requestPermissionsAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /* ignore */
      }
      void unloadAvRecording();
    };
  }, [unloadAvRecording]);

  const emitTalkDebug = useCallback((payload: TalkCaptureDebugPayload) => {
    DeviceEventEmitter.emit(TALK_CAPTURE_DEBUG_EVENT, payload);
  }, []);

  const startQuickCapture = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') {
      Alert.alert(
        t('talkHome.voiceWebUnsupportedTitle'),
        t('talkHome.voiceWebUnsupportedBody'),
      );
      return;
    }
    if (isBusy || voiceConfirm || voiceActiveRef.current || avRecordingRef.current) return;
    speechErrorRef.current = false;
    partialTranscriptRef.current = '';
    finalTranscriptRef.current = '';
    setLivePartial('');
    startedAtRef.current = Date.now();
    setIsBusy(true);
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert(
          t('talkHome.speechRecognitionUnavailableTitle'),
          t('talkHome.speechRecognitionUnavailableBody'),
        );
        return;
      }

      let perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!perm.granted) {
        perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      }
      if (!perm.granted) {
        Alert.alert(
          t('talkHome.microphonePermissionDeniedTitle'),
          t('talkHome.microphonePermissionDeniedBody'),
          [
            { text: t('channelSwitch.cancel'), style: 'cancel' },
            {
              text: t('ally.openSettings'),
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        return;
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const asrTag = resolveSpeechLangForSession(i18n.language);
      ExpoSpeechRecognitionModule.start({
        lang: asrTag,
        interimResults: true,
        continuous: speechContinuousForHold(),
        maxAlternatives: 1,
        iosTaskHint: 'dictation',
        iosVoiceProcessingEnabled: true,
      });
      voiceActiveRef.current = true;
      setCaptureMode('quick');
      setIsRecording(true);
    } catch (e: unknown) {
      voiceActiveRef.current = false;
      setIsRecording(false);
      setCaptureMode('idle');
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomeSpeech', e);
      } else if (__DEV__) {
        const detail =
          e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        Alert.alert(
          t('talkHome.speechDebugTitle'),
          t('talkHome.speechDebugBody', { detail }),
        );
      } else {
        Alert.alert(t('talkHome.recordingErrorTitle'), t('talkHome.recordingErrorStart'));
      }
    } finally {
      setIsBusy(false);
    }
  }, [i18n.language, isBusy, t, voiceConfirm]);

  const startDeepCapture = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') {
      Alert.alert(
        t('talkHome.voiceWebUnsupportedTitle'),
        t('talkHome.voiceWebUnsupportedBody'),
      );
      return;
    }
    if (isBusy || voiceConfirm || voiceActiveRef.current || avRecordingRef.current) {
      return;
    }
    setIsBusy(true);
    try {
      await unloadAvRecording();
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('talkHome.microphonePermissionDeniedTitle'),
          t('talkHome.microphonePermissionDeniedBody'),
          [
            { text: t('channelSwitch.cancel'), style: 'cancel' },
            {
              text: t('ally.openSettings'),
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      avRecordingRef.current = recording;
      setCaptureMode('deep');
      setIsRecording(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: unknown) {
      setCaptureMode('idle');
      setIsRecording(false);
      await unloadAvRecording();
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomeSpeech', e);
      } else if (__DEV__) {
        const detail =
          e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        Alert.alert(
          t('talkHome.speechDebugTitle'),
          t('talkHome.speechDebugBody', { detail }),
        );
      } else {
        Alert.alert(t('talkHome.recordingErrorTitle'), t('talkHome.recordingErrorStart'));
      }
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, t, unloadAvRecording, voiceConfirm]);

  const stopQuickCapture = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') return;
    if (!voiceActiveRef.current) return;
    voiceActiveRef.current = false;
    setIsPostCaptureAnalyzing(true);
    setIsBusy(true);
    try {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          /* ignore */
        }
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await new Promise<void>((r) => setTimeout(r, 480));
      const text = (
        finalTranscriptRef.current ||
        partialTranscriptRef.current ||
        ''
      ).trim();
      partialTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      setIsRecording(false);
      setCaptureMode('idle');
      setLivePartial('');
      if (!text) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          t('talkHome.transcriptionUnclearTitle'),
          t('talkHome.transcriptionUnclearBody'),
        );
        return;
      }
      const draft = reformulateStructuredIntent(text);
      const title = draft.title.trim() || text;
      const freq = inferLocalFrequencyLabel(text, draft);
      emitTalkDebug({
        mode: 'quick',
        at: Date.now(),
        rawTranscript: text,
        localStructuredJson: JSON.stringify(
          {
            kind: draft.kind,
            title: draft.title,
            timeMarker: draft.timeMarker,
            localFrequencyLabel: freq,
          },
          null,
          2,
        ),
      });
      setVoiceConfirm({
        rawTranscript: text,
        kind: draft.kind,
        editedTitle: title,
        editedTime: draft.timeMarker,
        isEditing: false,
      });
    } catch {
      setIsRecording(false);
      setCaptureMode('idle');
      setLivePartial('');
      Alert.alert(t('talkHome.recordingErrorTitle'), t('talkHome.recordingErrorStop'));
    } finally {
      speechErrorRef.current = false;
      setIsBusy(false);
      setIsPostCaptureAnalyzing(false);
      orbitalRef.current?.resetToNeutral();
    }
  }, [emitTalkDebug, t]);

  const stopDeepCapture = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') return;
    const rec = avRecordingRef.current;
    if (!rec) return;

    setIsPostCaptureAnalyzing(true);
    setIsBusy(true);
    let audioUri: string | null = null;
    try {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        /* ignore */
      }
      avRecordingRef.current = null;
      audioUri = rec.getURI() ?? null;
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      setIsRecording(false);
      setCaptureMode('idle');

      if (!getGeminiApiKey()) {
        Alert.alert(t('talkHome.deepNoApiKeyTitle'), t('talkHome.deepNoApiKeyBody'));
        return;
      }

      if (!audioUri) {
        Alert.alert(
          t('talkHome.recordingErrorTitle'),
          t('talkHome.recordingErrorMissingFile'),
        );
        return;
      }

      const b64 = await FileSystem.readAsStringAsync(audioUri, { encoding: 'base64' });
      const transcript = await geminiTranscribeAudioBase64(b64, 'audio/mp4');
      const { parsed, rawResponseText } = await geminiDeepIntentionFromTranscript(transcript, {
        promptLanguage: mapInteractionToGeminiPrompt(interactionLanguage),
      });
      const title = parsed.title.trim() || transcript.trim();
      const timing = parsed.timing.trim();

      emitTalkDebug({
        mode: 'deep',
        at: Date.now(),
        rawTranscript: transcript,
        geminiFullJson: JSON.stringify(
          { parsed, rawModelText: rawResponseText },
          null,
          2,
        ),
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVoiceConfirm({
        rawTranscript: transcript,
        kind: parsed.type,
        editedTitle: title,
        editedTime: timing,
        isEditing: false,
      });
    } catch (e: unknown) {
      setIsRecording(false);
      setCaptureMode('idle');
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomeSpeech', e);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(t('talkHome.recordingErrorTitle'), msg);
      }
    } finally {
      try {
        await unloadAvRecording();
      } catch {
        /* ignore */
      }
      if (audioUri) {
        try {
          await FileSystem.deleteAsync(audioUri, { idempotent: true });
        } catch {
          /* ignore */
        }
      }
      setIsBusy(false);
      setIsPostCaptureAnalyzing(false);
      orbitalRef.current?.resetToNeutral();
    }
  }, [emitTalkDebug, interactionLanguage, t, unloadAvRecording]);

  const onMicPressIn = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || isBusy || isPostCaptureAnalyzing) return;
    if (voiceActiveRef.current || avRecordingRef.current) return;
    if (orbitalSlot === 'neutral') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(t('talkHome.orbital.pickTitle'), t('talkHome.orbital.pickBody'));
      return;
    }
    if (orbitalSlot === 'quick') {
      void startQuickCapture();
      return;
    }
    void startDeepCapture();
  }, [
    isBusy,
    isPostCaptureAnalyzing,
    orbitalSlot,
    startDeepCapture,
    startQuickCapture,
    t,
    voiceConfirm,
  ]);

  const onMicPressOut = useCallback(() => {
    if (voiceActiveRef.current) {
      void stopQuickCapture();
      return;
    }
    if (avRecordingRef.current) {
      void stopDeepCapture();
      return;
    }
    orbitalRef.current?.resetToNeutral();
  }, [stopDeepCapture, stopQuickCapture]);

  const onCancelVoice = useCallback(() => {
    if (!voiceConfirm) return;
    resetVoiceConfirm();
  }, [voiceConfirm, resetVoiceConfirm]);

  const onProcessVoice = useCallback(async () => {
    if (!voiceConfirm) return;
    const trimmedTitle = voiceConfirm.editedTitle.trim();
    if (!trimmedTitle) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    const desc = voiceConfirm.editedTime.trim();
    const rawTranscript = voiceConfirm.rawTranscript;
    const kind = voiceConfirm.kind;
    setIsBusy(true);
    try {
      const graph = await finalizeIntentWithCloudSemanticGraph({
        kind,
        title: trimmedTitle,
        timeMarker: desc,
        rawTranscript,
      });

      const now = new Date();
      const systemLocale =
        Localization.getLocales()[0]?.languageTag ??
        Intl.DateTimeFormat().resolvedOptions().locale;
      const timeExtractOpts = {
        systemLocale,
        aiLanguage: spectrum.locale?.trim() || interactionLanguage,
        now,
      };
      const uid = spectrum.platform_user_id?.trim() || '';
      const pending = (await listIntentionsDescending()).filter((r) => r.status !== 'done');
      const busyForAgent: BusyInterval[] = connectEnabled ? busyIntervals : [];

      const overlap = previewManualIntentionOverlapsHardRoutine(
        pending,
        trimmedTitle,
        desc,
        spectrum,
        now,
        busyForAgent,
        uid,
        timeExtractOpts,
      );
      if (overlap.overlaps) {
        Alert.alert(
          t('radar.hardRoutineConflictTitle'),
          t('radar.hardRoutineConflictBody', {
            name: overlap.blockingTitle ?? t('talkHome.confirmEmptyTitle'),
          }),
        );
        throw new Error('HARD_ROUTINE_OVERLAP');
      }

      const {
        priority,
        isLateNight: is_late_night,
        isHardConstraint,
      } = analyzeNewIntentionSemantics(trimmedTitle, desc, spectrum, now, {
        systemLocale,
        aiLanguage: interactionLanguage,
      });
      const estimated_duration = estimateDurationMinutes(trimmedTitle, desc, spectrum);

      const persistToLocalDb = async () => {
        const id = newTalkEntityId();
        const weights = {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        };
        const titlePinnedMinutes = extractClockMinutesFromText(
          `${trimmedTitle}\n${desc}`,
          timeExtractOpts,
        );
        const isTitleTimePinned = titlePinnedMinutes != null;
        const candidate: IntentionRow = {
          id,
          title: trimmedTitle,
          description: desc,
          status: 'pending',
          priority,
          weights,
          platform_type: 'none',
          platform_user_id: uid,
          created_at: Date.now(),
          synced: 0,
          estimated_duration,
          actual_duration: null,
          completed_at: null,
          user_forced_urgent: false,
          is_late_night,
          alarm_enabled: false,
          is_flexible: isTitleTimePinned ? false : true,
          is_micro_habit: kind === 'habit',
          is_hard_constraint: isHardConstraint,
          routine_id: null,
          anchor_date_ymd: null,
          fixed_start_minutes: titlePinnedMinutes,
          raw_transcript: rawTranscript,
          energy_score: null,
          local_notification_id: null,
          recurrence_rrule: null,
          type: kind,
          parent_id: null,
          semantic_cluster_id: graph.semantic_cluster_id,
          semantic_tags: graph.semantic_tags,
          sentiment_score: graph.sentiment_score,
          ping_history: [],
        };
        const { anchor_date_ymd, fixed_start_minutes } =
          computeRailAnchorAndFixedStartForNewIntention({
            pendingOthers: pending,
            candidate,
            spectrum: weights,
            now,
            busyIntervals: busyForAgent,
            systemLocale,
            aiLanguage: interactionLanguage,
          });

        const insertRadarPendingIntention = async () => {
          await insertIntention({
            id,
            title: trimmedTitle,
            description: desc,
            status: 'pending',
            priority,
            weights,
            platform_type: 'none',
            platform_user_id: uid,
            created_at: Date.now(),
            estimated_duration,
            user_forced_urgent: false,
            is_late_night,
            alarm_enabled: false,
            is_flexible: isTitleTimePinned ? false : true,
            is_micro_habit: kind === 'habit',
            is_hard_constraint: isHardConstraint,
            anchor_date_ymd,
            fixed_start_minutes,
            raw_transcript: rawTranscript,
            type: kind,
            semantic_cluster_id: graph.semantic_cluster_id,
            semantic_tags: graph.semantic_tags,
            sentiment_score: graph.sentiment_score,
          });
        };

        if (isHardConstraint) {
          const plan = inferStructuralRoutinePlan(
            trimmedTitle,
            desc,
            spectrum,
            now,
            timeExtractOpts,
          );
          if (plan) {
            const routineId = newTalkEntityId();
            await insertRoutine({
              id: routineId,
              title: trimmedTitle,
              description: desc,
              weekday: plan.weekday,
              start_minutes: plan.startMinutes,
              duration_min: plan.durationMin,
              weights,
              priority,
              platform_type: 'none',
              platform_user_id: uid,
              created_at: Date.now(),
            });
            await ensureRoutineIntentionInstancesForHorizon(routineId, uid);
          } else {
            await insertRadarPendingIntention();
          }
        } else {
          await insertRadarPendingIntention();
        }
      };

      await persistToLocalDb();
      resetVoiceConfirm();
      void syncPendingIntentions();
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'HARD_ROUTINE_OVERLAP') {
        if (isLikelyMissingNativeModuleError(e)) {
          alertNativeModuleMissing('nativeModule.contextTalkHomePersist', e);
        } else {
          Alert.alert(t('talkHome.voicePersistErrorTitle'), t('talkHome.voicePersistErrorBody'));
        }
      }
    } finally {
      setIsBusy(false);
    }
  }, [
    voiceConfirm,
    spectrum,
    interactionLanguage,
    connectEnabled,
    busyIntervals,
    t,
    resetVoiceConfirm,
  ]);

  const intentTypeLabel = (k: VoiceIntentKind) =>
    t(`talkHome.intentType.${k}` as const);

  const renderPingCard = () => (
    <>
      <Text style={styles.priorityBadge}>{t('talkHome.priorityHigh')}</Text>
      <Text style={styles.question}>{t('talkHome.questionHydration')}</Text>
      <View style={styles.answerRow}>
        <Pressable style={[styles.answerBtn, styles.yesBtn]}>
          <Text style={styles.yesText}>{t('talkHome.yes')}</Text>
        </Pressable>
        <Pressable style={[styles.answerBtn, styles.noBtn]}>
          <Text style={styles.noText}>{t('talkHome.no')}</Text>
        </Pressable>
      </View>
      <Text style={styles.privacyHint}>{t('talkHome.localPrivacyHint')}</Text>
    </>
  );

  /** Quick : texte ASR partiel/final. Deep : consigne mains libres (pas de preview .m4a). */
  const renderLiveSpeechCard = () => {
    if (captureMode === 'deep') {
      return (
        <View style={styles.titleHeroWrap}>
          <Text style={styles.liveStatusLead}>{t('talkHome.status.listening')}</Text>
          <Text style={styles.titleHero}>{t('talkHome.label.deepIntent')}</Text>
        </View>
      );
    }
    const line = livePartial.trim()
      ? livePartial.trim()
      : t('talkHome.voiceLivePlaceholder');
    return (
      <View style={styles.titleHeroWrap}>
        <Text style={styles.liveStatusLead}>{t('talkHome.status.listening')}</Text>
        <Text style={styles.titleHero}>{line}</Text>
      </View>
    );
  };

  const renderAnalyzingCard = () => (
    <View style={styles.titleHeroWrap}>
      <Text style={styles.titleHero}>{t('talkHome.status.analyzing')}</Text>
    </View>
  );

  const micGradientColors = useMemo((): readonly [string, string] => {
    if (isRecording) {
      return captureMode === 'deep'
        ? (['#ca8a04', '#a16207'] as const)
        : (['#2563eb', '#1d4ed8'] as const);
    }
    if (orbitalSlot === 'quick') return ['#60a5fa', '#2563eb'] as const;
    if (orbitalSlot === 'deep') return ['#facc15', '#ca8a04'] as const;
    return ['#64748b', '#475569'] as const;
  }, [captureMode, isRecording, orbitalSlot]);

  const micA11yLabel = useMemo(() => {
    if (isRecording) return t('talkHome.orbital.holdRelease');
    if (orbitalSlot === 'quick') return t('talkHome.a11yMicQuick');
    if (orbitalSlot === 'deep') return t('talkHome.a11yMicDeep');
    return t('talkHome.a11yMicNeutral');
  }, [isRecording, orbitalSlot, t]);

  const renderConfirmCard = () => {
    if (!voiceConfirm) return null;
    const { editedTitle, editedTime, isEditing, kind } = voiceConfirm;
    const timeDisplay = editedTime.trim() ? editedTime.trim() : t('talkHome.timeUnspecified');

    return (
      <>
        <View style={styles.confirmHeaderRow}>
          <Text style={styles.confirmIntro}>{t('talkHome.confirmIntro')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('talkHome.editIntentA11y')}
            style={styles.editIconBtn}
            onPress={() => {
              setVoiceConfirm((prev) =>
                prev ? { ...prev, isEditing: !prev.isEditing } : prev,
              );
            }}
          >
            <Pencil size={20} color="#2d6f70" />
          </Pressable>
        </View>

        <View style={styles.typeRow}>
          <Text style={styles.confirmMetaLabel}>{t('talkHome.confirmTypePrefix')}</Text>
          <Text style={styles.typeValue}>{intentTypeLabel(kind)}</Text>
        </View>

        <Text style={styles.confirmBlockLabel}>{t('talkHome.confirmActionLabel')}</Text>
        {isEditing ? (
          <TextInput
            value={editedTitle}
            onChangeText={(v) => {
              setVoiceConfirm((prev) => (prev ? { ...prev, editedTitle: v } : prev));
            }}
            style={styles.editTitleInput}
            multiline
            placeholderTextColor="#8a9390"
          />
        ) : (
          <View style={styles.titleHeroWrap}>
            <Text style={styles.titleHero}>
              {editedTitle.trim() || t('talkHome.confirmEmptyTitle')}
            </Text>
          </View>
        )}

        <View style={styles.timeSection}>
          <Text style={styles.confirmBlockLabel}>{t('talkHome.confirmMomentLabel')}</Text>
          {isEditing ? (
            <TextInput
              value={editedTime}
              onChangeText={(v) => {
                setVoiceConfirm((prev) => (prev ? { ...prev, editedTime: v } : prev));
              }}
              style={styles.editTimeInput}
              placeholder={t('talkHome.timeUnspecified')}
              placeholderTextColor="#8a9390"
            />
          ) : (
            <View style={styles.timeValueWrap}>
              <Text style={styles.timeValue}>{timeDisplay}</Text>
            </View>
          )}
        </View>

        <View style={styles.voiceActionRow}>
          <Pressable
            style={[styles.voiceActionBtn, styles.voiceCancelBtn]}
            onPress={() => {
              void onCancelVoice();
            }}
            disabled={isBusy}
          >
            <Text style={styles.voiceCancelText}>{t('talkHome.voiceCancel')}</Text>
          </Pressable>
          <Pressable
            style={[styles.voiceActionBtn, styles.voiceProcessBtn]}
            onPress={() => {
              void onProcessVoice();
            }}
            disabled={isBusy}
          >
            <Text style={styles.voiceProcessText}>{t('talkHome.voiceProcess')}</Text>
          </Pressable>
        </View>
      </>
    );
  };

  return (
    <LinearGradient
      colors={['#d7e6dc', '#f7f4eb']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.root}
    >
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoWrap}>
            <Waves size={18} color="#2d6f70" />
          </View>
          <Text style={styles.brandName}>
            {t('talkHome.brandName')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('talkHome.profileButton')}
          style={styles.profileBtn}
        >
          <UserCircle2 size={26} color="#9fa7a3" />
        </Pressable>
      </View>

      <View style={styles.contentFlow}>
        <View style={styles.pingCard}>
          {voiceConfirm
            ? renderConfirmCard()
            : isPostCaptureAnalyzing
              ? renderAnalyzingCard()
              : isRecording
                ? renderLiveSpeechCard()
                : renderPingCard()}
        </View>

        <View style={styles.progressCard}>
          <Text style={styles.progressLabel}>{t('talkHome.progressCurrent')}</Text>
          <Text style={styles.progressLabel}>{t('talkHome.progressNextAnchor')}</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.talkWrap}>
          <View style={styles.orbitalStack}>
            <IntentionOrbital
              ref={orbitalRef}
              radius={115}
              disabled={
                isBusy ||
                voiceConfirm !== null ||
                isPostCaptureAnalyzing ||
                isRecording ||
                Platform.OS === 'web'
              }
              onSlotChange={onOrbitalSlotChange}
              labelQuick={t('talkHome.intentType.task')}
              labelDeep={t('talkHome.intentType.project')}
            />
            <Animated.View
              style={[
                styles.micOuterPulse,
                {
                  opacity: ringPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.88, 1],
                  }),
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={micA11yLabel}
                onPressIn={onMicPressIn}
                onPressOut={onMicPressOut}
                disabled={
                  isBusy ||
                  voiceConfirm !== null ||
                  Platform.OS === 'web' ||
                  isPostCaptureAnalyzing
                }
                style={styles.micPressable}
              >
                <LinearGradient
                  colors={[micGradientColors[0], micGradientColors[1]]}
                  start={{ x: 0.15, y: 0.05 }}
                  end={{ x: 0.95, y: 0.95 }}
                  style={[styles.talkButton, isRecording ? styles.talkButtonRecording : null]}
                >
                  {isRecording ? (
                    <>
                      <Text style={styles.modeHint}>
                        {captureMode === 'deep'
                          ? t('talkHome.label.deepIntent')
                          : t('talkHome.label.quickIntent')}
                      </Text>
                      <Text style={styles.holdLabel}>{t('talkHome.orbital.holdRelease')}</Text>
                    </>
                  ) : (
                    <Text style={styles.holdLabel}>{t('talkHome.holdToTalk')}</Text>
                  )}
                  <View style={styles.micCore}>
                    <Mic size={30} color="#ffffff" />
                  </View>
                  {isRecording ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.waveHalo,
                        {
                          transform: [
                            {
                              scale: wavePulse.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.95, 1.34],
                              }),
                            },
                          ],
                          opacity: wavePulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.35, 0],
                          }),
                        },
                      ]}
                    />
                  ) : null}
                </LinearGradient>
              </Pressable>
            </Animated.View>
          </View>
          {!isRecording && !voiceConfirm ? (
            <View style={styles.tapHints}>
              <Text style={styles.tapHintLine}>{t('talkHome.orbital.hintSlide')}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 62,
    paddingBottom: 22,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  brandName: { fontSize: 34, fontWeight: '700', color: '#2e5f68' },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  contentFlow: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-around',
    paddingTop: 14,
    paddingBottom: 16,
  },
  pingCard: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#fbf8f3',
    shadowColor: '#707b75',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 7,
  },
  priorityBadge: {
    textAlign: 'center',
    color: '#c17357',
    fontWeight: '700',
    marginBottom: 8,
    fontSize: 17,
  },
  question: { textAlign: 'center', fontSize: 34, fontWeight: '600', color: '#2f4f5a' },
  answerRow: { marginTop: 16, flexDirection: 'row', gap: 12 },
  answerBtn: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesBtn: { backgroundColor: '#6fad7e' },
  noBtn: { backgroundColor: '#d9d8d5' },
  yesText: { color: '#f7fff7', fontWeight: '700', fontSize: 24 },
  noText: { color: '#6e7174', fontWeight: '700', fontSize: 24 },
  privacyHint: {
    marginTop: 12,
    textAlign: 'center',
    color: '#77807a',
    fontSize: 13,
    fontWeight: '500',
  },
  liveSpeechLead: {
    textAlign: 'center',
    color: '#3b6b60',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  confirmHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  confirmIntro: {
    flex: 1,
    color: '#3d524d',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  editIconBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  confirmMetaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6e7a75',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  typeValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f766e',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    overflow: 'hidden',
  },
  confirmBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7a8680',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  titleHeroWrap: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.12)',
  },
  titleHero: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1e3d42',
    lineHeight: 28,
  },
  liveStatusLead: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f766e',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  editTitleInput: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#1e3d42',
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.2)',
    minHeight: 56,
    textAlignVertical: 'top',
  },
  timeSection: {
    marginBottom: 14,
  },
  timeValueWrap: {
    backgroundColor: 'rgba(245, 248, 246, 0.95)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#008080',
  },
  timeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2a4a52',
  },
  editTimeInput: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#2a4a52',
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.25)',
  },
  voiceActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  voiceActionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceCancelBtn: {
    backgroundColor: '#e8e7e4',
  },
  voiceCancelText: {
    color: '#5c5f62',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  voiceProcessBtn: {
    backgroundColor: '#008080',
  },
  voiceProcessText: {
    color: '#f5fffe',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  progressCard: {
    marginTop: 8,
    alignSelf: 'center',
    width: '80%',
    borderRadius: 14,
    backgroundColor: '#f8f8f6',
    paddingHorizontal: 12,
    paddingVertical: 9,
    shadowColor: '#8f8f8f',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 7,
    elevation: 3,
  },
  progressLabel: { textAlign: 'center', color: '#707572', fontSize: 9, marginBottom: 2 },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#e5e4df',
    overflow: 'hidden',
  },
  progressFill: { width: '38%', height: '100%', backgroundColor: '#78ad92' },
  talkWrap: {
    marginTop: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitalStack: {
    width: 302,
    height: 302,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOuterPulse: {
    position: 'absolute',
    left: 51,
    top: 51,
    width: 200,
    height: 200,
    borderRadius: 100,
    zIndex: 4,
  },
  micPressable: {
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
  },
  talkButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  talkButtonRecording: {
    opacity: 0.96,
  },
  holdLabel: {
    color: '#eff8f8',
    fontSize: 19,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  modeHint: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 6,
    textAlign: 'center',
  },
  tapHints: {
    marginTop: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tapHintLine: {
    fontSize: 12,
    color: '#5a6d68',
    textAlign: 'center',
    lineHeight: 18,
  },
  micCore: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 255, 251, 0.22)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  waveHalo: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 4,
    borderColor: 'rgba(219, 255, 246, 0.8)',
  },
});
