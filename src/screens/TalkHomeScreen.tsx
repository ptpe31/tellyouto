import { Audio } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import * as Localization from 'expo-localization';
import { BlurView } from 'expo-blur';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { Pencil, UserCircle2, Waves } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RewardToast } from '../components/RewardToast';
import {
  ActivityIndicator,
  Alert,
  Animated,
  DeviceEventEmitter,
  Easing,
  Linking,
  ImageBackground,
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
import {
  applyGrowthDecayIfNeeded,
  consumeTrankilV2IntentCredit,
  getTrankilV2UserStats,
  growthPointsForType,
  insertTrankilV2Intention,
  getLocalEcoScore,
  updateGrowth,
} from '../api/trankilV2Db';
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
import { askGeminiExpert, type GeminiExpertIntention } from '../services/GeminiExpert';
import { transcribeWithWhisperLocal } from '../services/WhisperAdapter';
import { onLocalAiValidated, resetLocalStreakOnExpert } from '../services/BonusEngine';
import { runIntentOrchestration, type OrchestratorDecision } from '../services/IntentOrchestrator';
import { STRINGS } from '../constants/Strings';
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
  suggestedTags: string[];
  routeDecision: OrchestratorDecision;
  localType: 'TASK' | 'HABIT' | 'NOTE';
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

function mapVoiceKindToIntentType(kind: VoiceIntentKind): 'TASK' | 'HABIT' | 'PROJECT' {
  if (kind === 'habit') return 'HABIT';
  if (kind === 'project') return 'PROJECT';
  return 'TASK';
}

function localTypeToVoiceKind(localType: 'TASK' | 'HABIT' | 'NOTE'): VoiceIntentKind {
  if (localType === 'HABIT') return 'habit';
  if (localType === 'TASK') return 'task';
  return 'task';
}

function growthPointsFromExpertRows(rows: GeminiExpertIntention[]): number {
  if (rows.some((r) => r.type === 'PROJECT')) return growthPointsForType('PROJECT');
  if (rows.some((r) => r.type === 'HABIT')) return growthPointsForType('HABIT');
  if (rows.some((r) => r.type === 'TASK')) return growthPointsForType('TASK');
  return 0;
}

async function persistGeminiExpertRows(
  rawInput: string,
  rows: GeminiExpertIntention[],
): Promise<void> {
  let currentParentId: string | null = null;
  for (const row of rows) {
    const id = newTalkEntityId();
    if (row.type === 'PROJECT') {
      currentParentId = id;
    }
    await insertTrankilV2Intention({
      id,
      type: row.type,
      title: row.title,
      content_raw: rawInput,
      metadata_json: JSON.stringify(row.metadata ?? {}, null, 2),
      suggested_tags: JSON.stringify(
        row.suggested_category ? [row.suggested_category.trim()] : [STRINGS.TAG_KEYS.A_TRIER],
      ),
      category_id: row.suggested_category || null,
      parent_id: row.type === 'PROJECT' ? null : currentParentId,
      status: 'TODO',
      is_organized: 0,
      complexity_level: 2,
      created_at: Date.now(),
    });
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

  const [captureMode, setCaptureMode] = useState<'idle' | 'quick' | 'deep'>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isPostCaptureAnalyzing, setIsPostCaptureAnalyzing] = useState(false);
  const [isExpertLoading, setIsExpertLoading] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState<VoiceConfirmState | null>(null);
  const [livePartial, setLivePartial] = useState('');
  const [remainingIntents, setRemainingIntents] = useState(10);
  const [microToast, setMicroToast] = useState('');
  const [rewardToast, setRewardToast] = useState('');
  const [growthScore, setGrowthScore] = useState(0);
  const [flowerPulseKey, setFlowerPulseKey] = useState(0);
  const [flowerNeedsAttention, setFlowerNeedsAttention] = useState(false);
  const [localEcoScore, setLocalEcoScore] = useState(0);
  const voiceActiveRef = useRef(false);
  const stopAfterStartRef = useRef(false);
  const stopQuickCaptureRef = useRef<null | (() => Promise<void>)>(null);
  const startedAtRef = useRef<number>(0);
  const partialTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const speechErrorRef = useRef(false);
  const avRecordingRef = useRef<Audio.Recording | null>(null);
  const micScale = useRef(new Animated.Value(1)).current;

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

  const refreshRemainingIntents = useCallback(async () => {
    try {
      const before = await getTrankilV2UserStats();
      const stale =
        before.last_nudge_at != null &&
        Date.now() - before.last_nudge_at > 24 * 60 * 60 * 1000;
      setFlowerNeedsAttention(stale);
      await applyGrowthDecayIfNeeded();
      const stats = await getTrankilV2UserStats();
      setRemainingIntents(stats.remaining_intents);
      setGrowthScore(stats.growth_score);
      setLocalEcoScore(await getLocalEcoScore());
    } catch {
      setRemainingIntents(10);
      setGrowthScore(0);
      setFlowerNeedsAttention(false);
      setLocalEcoScore(0);
    }
  }, []);

  useEffect(() => {
    void refreshRemainingIntents();
  }, [refreshRemainingIntents]);

  useFocusEffect(
    useCallback(() => {
      void refreshRemainingIntents();
    }, [refreshRemainingIntents]),
  );

  useEffect(() => {
    Animated.timing(micScale, {
      toValue: isRecording ? 1.05 : 1,
      duration: isRecording ? 180 : 160,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [isRecording, micScale]);

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
      if (stopAfterStartRef.current) {
        stopAfterStartRef.current = false;
        void stopQuickCaptureRef.current?.();
      }
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
    if (!voiceActiveRef.current) {
      return;
    }
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
      // UI must exit recording state immediately after release,
      // even if post-processing fails later.
      setIsRecording(false);
      setCaptureMode('idle');
      setLivePartial('');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await new Promise<void>((r) => setTimeout(r, 480));
      const text = (
        finalTranscriptRef.current ||
        partialTranscriptRef.current ||
        ''
      ).trim();
      partialTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      if (!text) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          t('talkHome.transcriptionUnclearTitle'),
          t('talkHome.transcriptionUnclearBody'),
        );
        return;
      }
      const orchestration = await runIntentOrchestration({
        fallbackText: text,
        locale: i18n.language,
      });
      if (!orchestration.rawText.trim()) {
        Alert.alert(STRINGS.CAPTURE.NOISE_WARNING);
        return;
      }
      const draft = reformulateStructuredIntent(orchestration.rawText);
      const title = draft.title.trim() || orchestration.rawText;
      const freq = inferLocalFrequencyLabel(orchestration.rawText, draft);
      emitTalkDebug({
        mode: 'quick',
        at: Date.now(),
        rawTranscript: orchestration.rawText,
        localStructuredJson: JSON.stringify(
          {
            kind: draft.kind,
            title: draft.title,
            timeMarker: draft.timeMarker,
            localFrequencyLabel: freq,
            decision: orchestration.decision,
            localType: orchestration.localType,
            confidence: orchestration.confidence,
            suggestedTags: orchestration.suggestedTags,
            reason: orchestration.reason,
          },
          null,
          2,
        ),
      });
      setVoiceConfirm({
        rawTranscript: orchestration.rawText,
        kind: localTypeToVoiceKind(
          orchestration.localType === 'NOTE' ? 'TASK' : orchestration.localType,
        ),
        editedTitle: title,
        editedTime: draft.timeMarker,
        suggestedTags: orchestration.suggestedTags.length
          ? orchestration.suggestedTags
          : [STRINGS.TAG_KEYS.A_TRIER],
        routeDecision: orchestration.decision,
        localType: orchestration.localType,
        isEditing: false,
      });
      setMicroToast(
        orchestration.decision === 'LOCAL'
          ? STRINGS.CAPTURE.LOCAL_MAX
          : "Scénario B prêt : clique sur 'Appeler l'Expert' si besoin.",
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      Alert.alert(t('talkHome.recordingErrorTitle'), message);
    } finally {
      stopAfterStartRef.current = false;
      setIsExpertLoading(false);
      speechErrorRef.current = false;
      setIsBusy(false);
      setIsPostCaptureAnalyzing(false);
    }
  }, [emitTalkDebug, i18n.language, t]);

  useEffect(() => {
    stopQuickCaptureRef.current = stopQuickCapture;
    return () => {
      stopQuickCaptureRef.current = null;
    };
  }, [stopQuickCapture]);

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

      const whisperTranscript = await transcribeWithWhisperLocal(audioUri);
      const transcript =
        whisperTranscript ??
        (await (async () => {
          const b64 = await FileSystem.readAsStringAsync(audioUri, { encoding: 'base64' });
          return geminiTranscribeAudioBase64(b64, 'audio/mp4');
        })());
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
        suggestedTags: [STRINGS.TAG_KEYS.A_TRIER],
        routeDecision: 'COMPLEX',
        localType: 'NOTE',
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
    }
  }, [emitTalkDebug, interactionLanguage, t, unloadAvRecording]);

  const onMicPressIn = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || isBusy || isPostCaptureAnalyzing) return;
    if (voiceActiveRef.current || avRecordingRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    stopAfterStartRef.current = false;
    void startQuickCapture();
  }, [
    isBusy,
    isPostCaptureAnalyzing,
    startQuickCapture,
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
    stopAfterStartRef.current = true;
  }, [stopDeepCapture, stopQuickCapture]);

  const onProjectPress = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || isBusy || isPostCaptureAnalyzing) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (avRecordingRef.current) {
      void stopDeepCapture();
      return;
    }
    if (voiceActiveRef.current) {
      void stopQuickCapture();
      return;
    }
    void startDeepCapture();
  }, [isBusy, isPostCaptureAnalyzing, startDeepCapture, stopDeepCapture, stopQuickCapture, voiceConfirm]);

  const onQuickNotePress = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || isBusy || isPostCaptureAnalyzing) return;
    if (voiceActiveRef.current || avRecordingRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    stopAfterStartRef.current = false;
    void startQuickCapture();
    setTimeout(() => {
      if (voiceActiveRef.current) {
        void stopQuickCapture();
      }
    }, 1150);
  }, [isBusy, isPostCaptureAnalyzing, startQuickCapture, stopQuickCapture, voiceConfirm]);

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
    const rawTranscript = voiceConfirm.rawTranscript.trim();
    const kind = voiceConfirm.kind;
    const routeDecision = voiceConfirm.routeDecision;
    setIsBusy(true);
    try {
      if (routeDecision === 'COMPLEX') {
        await resetLocalStreakOnExpert();
        setIsExpertLoading(true);
        const expertRows = await askGeminiExpert(rawTranscript);
        if (expertRows.length > 0) {
          await persistGeminiExpertRows(rawTranscript, expertRows);
          const expertPoints = growthPointsFromExpertRows(expertRows);
          if (expertPoints > 0) {
            const next = await updateGrowth(expertPoints);
            setGrowthScore(next.growth_score);
            setFlowerPulseKey((k) => k + 1);
            setFlowerNeedsAttention(false);
          }
        }
        const afterConsume = await consumeTrankilV2IntentCredit();
        setRemainingIntents(afterConsume.remaining_intents);
      } else {
        await insertTrankilV2Intention({
          id: newTalkEntityId(),
          type:
            voiceConfirm.localType === 'NOTE'
              ? 'NOTE'
              : mapVoiceKindToIntentType(localTypeToVoiceKind(voiceConfirm.localType)),
          title: trimmedTitle,
          content_raw: rawTranscript,
          metadata_json: JSON.stringify(
            {
              timeMarker: desc,
              source: 'orchestrator_local',
            },
            null,
            2,
          ),
          suggested_tags: JSON.stringify(
            voiceConfirm.suggestedTags.length
              ? voiceConfirm.suggestedTags
              : [STRINGS.TAG_KEYS.A_TRIER],
          ),
          category_id: (voiceConfirm.suggestedTags[0] ?? STRINGS.TAG_KEYS.A_TRIER).toLowerCase(),
          parent_id: null,
          status: 'TODO',
          is_organized: 0,
          is_local_processed: 1,
          complexity_level: 1,
          created_at: Date.now(),
        });
        const localPoints =
          voiceConfirm.localType === 'HABIT'
            ? growthPointsForType('HABIT')
            : voiceConfirm.localType === 'TASK'
              ? growthPointsForType('TASK')
              : 0;
        if (localPoints > 0) {
          const next = await updateGrowth(localPoints);
          setGrowthScore(next.growth_score);
          setFlowerPulseKey((k) => k + 1);
          setFlowerNeedsAttention(false);
        }
        const localBonus = await onLocalAiValidated();
        if (localBonus.superBonusGranted && localBonus.message) {
          setRewardToast(localBonus.message);
          setTimeout(() => setRewardToast(''), 2300);
        }
      }
      resetVoiceConfirm();
      setMicroToast('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomePersist', e);
      } else {
        Alert.alert(t('talkHome.voicePersistErrorTitle'), msg || t('talkHome.voicePersistErrorBody'));
      }
    } finally {
      setIsExpertLoading(false);
      setIsBusy(false);
    }
  }, [
    voiceConfirm,
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

  const micA11yLabel = useMemo(() => {
    if (isRecording) return t('talkHome.orbital.holdRelease');
    return t('talkHome.a11yMicQuick');
  }, [isRecording, t]);

  const renderConfirmCard = () => {
    if (!voiceConfirm) return null;
    const { editedTitle, editedTime, isEditing, kind, suggestedTags, routeDecision } = voiceConfirm;
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
        <Text style={styles.confirmScenarioLine}>
          {routeDecision === 'LOCAL' ? t('talkHome.scenarioLocal') : t('talkHome.scenarioComplex')}
        </Text>

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

        <Text style={styles.confirmBlockLabel}>{STRINGS.TAG_EDITOR.title}</Text>
        <View style={styles.tagRow}>
          {suggestedTags.map((tag) => (
            <Pressable
              key={tag}
              style={styles.tagChip}
              onPress={() => {
                setVoiceConfirm((prev) =>
                  prev
                    ? {
                        ...prev,
                        suggestedTags:
                          prev.suggestedTags.filter((t) => t !== tag).length > 0
                            ? prev.suggestedTags.filter((t) => t !== tag)
                            : [STRINGS.TAG_KEYS.A_TRIER],
                      }
                    : prev,
                );
              }}
            >
              <Text style={styles.tagChipText}>
                #{STRINGS.TAG_LABELS[tag as keyof typeof STRINGS.TAG_LABELS] ?? tag}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.tagQuickRow}>
          {(Object.keys(STRINGS.TAG_LABELS) as Array<keyof typeof STRINGS.TAG_LABELS>).map((tag) => (
            <Pressable
              key={`quick-${tag}`}
              style={styles.tagQuickBtn}
              onPress={() => {
                setVoiceConfirm((prev) =>
                  prev
                    ? {
                        ...prev,
                        suggestedTags: prev.suggestedTags.includes(tag)
                          ? prev.suggestedTags
                          : [...prev.suggestedTags, tag],
                      }
                    : prev,
                );
              }}
            >
              <Text style={styles.tagQuickBtnText}>
                {STRINGS.TAG_LABELS[tag]}
              </Text>
            </Pressable>
          ))}
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
            <Text style={styles.voiceProcessText}>
              {routeDecision === 'LOCAL' ? t('talkHome.voiceProcess') : t('talkHome.voiceCallExpert')}
            </Text>
          </Pressable>
        </View>
      </>
    );
  };

  return (
    <ImageBackground
      source={require('../../assets/background_talkie_vierge.png')}
      resizeMode="cover"
      style={styles.root}
      imageStyle={styles.talkieBgImage}
    >
      <View style={styles.talkieBgTint} />
      <RewardToast visible={Boolean(rewardToast)} message={rewardToast} />
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
        {voiceConfirm || isPostCaptureAnalyzing || isRecording ? (
          <View style={styles.semanticModalZone}>
            <BlurView intensity={38} tint="light" style={styles.pingCard}>
              {voiceConfirm
                ? renderConfirmCard()
                : isPostCaptureAnalyzing
                  ? renderAnalyzingCard()
                  : renderLiveSpeechCard()}
            </BlurView>
          </View>
        ) : null}

        <View style={styles.progressCard}>
          <Text style={styles.progressLabel}>{t('talkHome.progressCurrent')}</Text>
          <Text style={styles.progressLabel}>{t('talkHome.progressNextAnchor')}</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.talkWrap}>
          <Animated.View style={[styles.ghostTouchLayer, { transform: [{ scale: micScale }] }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Projet"
              onPress={onProjectPress}
              disabled={isBusy || voiceConfirm !== null || Platform.OS === 'web' || isPostCaptureAnalyzing}
              style={[styles.ghostZone, styles.ghostZoneLeft]}
            />
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
              style={[styles.ghostZone, styles.ghostZoneCenter]}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quick note"
              onPress={onQuickNotePress}
              disabled={isBusy || voiceConfirm !== null || Platform.OS === 'web' || isPostCaptureAnalyzing}
              style={[styles.ghostZone, styles.ghostZoneRight]}
            />
          </Animated.View>
          {microToast ? <Text style={styles.microToast}>{microToast}</Text> : null}
          <Text style={styles.creditLine}>{Math.max(0, remainingIntents)}/10 Intents</Text>
        </View>
      </View>
    </ImageBackground>
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
  talkieBgImage: {
    opacity: 0.98,
  },
  talkieBgTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(246, 247, 244, 0.1)',
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
  semanticModalZone: {
    position: 'absolute',
    top: '34%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  pingCard: {
    width: '56%',
    maxWidth: 300,
    minHeight: 150,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(236, 246, 246, 0.36)',
    borderWidth: 0,
    shadowColor: '#5f7a79',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 6,
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
  confirmScenarioLine: {
    marginTop: -6,
    marginBottom: 12,
    fontSize: 12,
    fontWeight: '700',
    color: '#2f7b7d',
    textAlign: 'left',
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
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  tagChip: {
    borderRadius: 10,
    backgroundColor: 'rgba(16,185,129,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagChipText: { color: '#065f46', fontSize: 12, fontWeight: '700' },
  tagQuickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  tagQuickBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagQuickBtnText: { color: '#2f4f5a', fontSize: 11, fontWeight: '600' },
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
    marginTop: 252,
    alignSelf: 'center',
    width: '80%',
    borderRadius: 14,
    backgroundColor: 'rgba(248, 248, 246, 0.9)',
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
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostTouchLayer: {
    width: '79%',
    maxWidth: 360,
    minWidth: 280,
    height: 108,
    position: 'relative',
  },
  ghostZone: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  ghostZoneLeft: {
    left: '7%',
    bottom: 19,
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  ghostZoneCenter: {
    left: '50%',
    bottom: 7,
    marginLeft: -43,
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  ghostZoneRight: {
    right: '7%',
    bottom: 19,
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  creditLine: {
    marginTop: 10,
    fontSize: 12,
    color: '#4f5f5a',
    letterSpacing: 0.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  microToast: {
    marginTop: 8,
    fontSize: 12,
    color: '#0f766e',
    fontWeight: '700',
    textAlign: 'center',
  },
});
