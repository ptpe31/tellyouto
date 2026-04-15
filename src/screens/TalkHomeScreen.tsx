import { Audio } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import * as Localization from 'expo-localization';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { Bell, Check, Folder, Pencil, Target, UserCircle2, Waves, X, Zap } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RewardToast } from '../components/RewardToast';
import {
  ActivityIndicator,
  Alert,
  Animated,
  DeviceEventEmitter,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PanGestureHandler,
  State as GestureState,
  type PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { askGeminiExpert, atomizeProject, type GeminiExpertIntention } from '../services/GeminiExpert';
import { transcribeWithWhisperLocal } from '../services/WhisperAdapter';
import { onLocalAiValidated, resetLocalStreakOnExpert } from '../services/BonusEngine';
import { runIntentOrchestration, type OrchestratorDecision } from '../services/IntentOrchestrator';
import {
  enqueueCaptureProcessingJob,
  startCaptureProcessingForeground,
  stopCaptureProcessingForeground,
} from '../services/CaptureProcessingService';
import { STRINGS } from '../constants/Strings';
import {
  alertNativeModuleMissing,
  isLikelyMissingNativeModuleError,
} from '../utils/nativeModuleErrorAlert';
import { resolveSpeechLangForSession } from '../utils/speechLocale';

/** Texte flottant sur l’OLED (verre dépoli du fond) — aligné brief produit */
const OLED_TEXT = '#2C3E50';
const TALKIE_BG_BASE = { width: 571, height: 1076 } as const;
/** Zone écran OLED sur l’asset de référence (571×1076) — alignée au carré central du talkie */
const TALKIE_OLED = { x: 78, y: 248, w: 416, h: 368 } as const;
const TALKIE_BTN_LAYOUT = {
  left: { cx: 122, cy: 888, diameter: 66 },
  center: { cx: 286, cy: 878, diameter: 92 },
  right: { cx: 450, cy: 888, diameter: 66 },
} as const;

function ratioPct(value: number, total: number): `${number}%` {
  return `${((value / total) * 100).toFixed(2)}%` as `${number}%`;
}

type CaptureChannel = 'intention' | 'quick_note' | 'projet';

type VoiceConfirmState = {
  rawTranscript: string;
  kind: VoiceIntentKind;
  editedTitle: string;
  editedTime: string;
  suggestedTags: string[];
  routeDecision: OrchestratorDecision;
  localType: 'TASK' | 'HABIT' | 'NOTE';
  isEditing: boolean;
  captureChannel?: CaptureChannel;
};

type ProjectRefinementState = {
  transcript: string;
  editedText: string;
  audioUri: string | null;
  isEditing: boolean;
  isGeneratingPlan: boolean;
};

type ProjectPlanPreviewState = {
  projectTitle: string;
  rawInput: string;
  rows: GeminiExpertIntention[];
  taskAlarmIndexes: number[];
};

const BottomStatus = React.memo(function BottomStatus({
  microToast,
}: {
  microToast: string;
}) {
  if (!microToast) return null;
  return <Text style={styles.microToast}>{microToast}</Text>;
});

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
  options?: { taskAlarmIndexes?: number[] },
): Promise<void> {
  let currentParentId: string | null = null;
  let taskCursor = 0;
  const alarmSet = new Set(options?.taskAlarmIndexes ?? []);
  for (const row of rows) {
    const id = newTalkEntityId();
    if (row.type === 'PROJECT') {
      currentParentId = id;
    }
    const shouldSetAlarm = row.type === 'TASK' && alarmSet.has(taskCursor);
    const metadata = {
      ...(row.metadata ?? {}),
      ...(shouldSetAlarm ? { has_alarm: true } : {}),
    };
    if (row.type === 'TASK') {
      taskCursor += 1;
    }
    await insertTrankilV2Intention({
      id,
      type: row.type,
      title: row.title,
      content_raw: rawInput,
      metadata_json: JSON.stringify(metadata, null, 2),
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
  const insets = useSafeAreaInsets();
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
  const [projectRefine, setProjectRefine] = useState<ProjectRefinementState | null>(null);
  const [projectPlanPreview, setProjectPlanPreview] = useState<ProjectPlanPreviewState | null>(null);
  const [isProjectHoldActive, setIsProjectHoldActive] = useState(false);
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
  const projectGestureHoldingRef = useRef(false);
  const stopQuickCaptureRef = useRef<null | (() => Promise<void>)>(null);
  const captureChannelRef = useRef<CaptureChannel | null>(null);
  const startedAtRef = useRef<number>(0);
  const partialTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const speechErrorRef = useRef(false);
  const avRecordingRef = useRef<Audio.Recording | null>(null);
  const projectAudioRef = useRef<Audio.Recording | null>(null);
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

  const clearProjectAudioFile = useCallback(async (uri: string | null): Promise<void> => {
    if (!uri) return;
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      /* ignore */
    }
  }, []);

  const resetVoiceConfirm = useCallback(() => {
    setVoiceConfirm(null);
  }, []);

  const cancelProjectRefine = useCallback(async () => {
    const uri = projectRefine?.audioUri ?? null;
    setProjectRefine(null);
    await clearProjectAudioFile(uri);
  }, [clearProjectAudioFile, projectRefine]);

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
      if (captureChannelRef.current === 'projet' && projectGestureHoldingRef.current) {
        console.log('LOG [Audio-Capture] Signal d\'arrêt reçu : TIMEOUT/AUTRE');
      }
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
      const rec = projectAudioRef.current;
      projectAudioRef.current = null;
      if (rec) {
        void rec.stopAndUnloadAsync().catch(() => undefined);
      }
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
    if (
      isBusy ||
      voiceConfirm ||
      projectRefine ||
      voiceActiveRef.current ||
      avRecordingRef.current
    ) {
      return;
    }
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
  }, [i18n.language, isBusy, projectRefine, t, voiceConfirm]);

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

  const startProjectHoldCapture = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') {
      Alert.alert(
        t('talkHome.voiceWebUnsupportedTitle'),
        t('talkHome.voiceWebUnsupportedBody'),
      );
      return;
    }
    if (
      isBusy ||
      isPostCaptureAnalyzing ||
      voiceConfirm ||
      projectRefine ||
      voiceActiveRef.current
    ) {
      return;
    }
    setIsBusy(true);
    try {
      await unloadAvRecording();
      await clearProjectAudioFile(projectRefine?.audioUri ?? null);
      const permissionResponse = await Audio.requestPermissionsAsync();
      if (!permissionResponse.granted) {
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

      speechErrorRef.current = false;
      partialTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      setLivePartial('');
      setCaptureMode('quick');
      setIsRecording(true);
      setIsProjectHoldActive(true);
      captureChannelRef.current = 'projet';
      startedAtRef.current = Date.now();
      voiceActiveRef.current = true;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      const recordingResult = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      projectAudioRef.current = recordingResult.recording;

      await ExpoSpeechRecognitionModule.start({
        lang: resolveSpeechLangForSession(i18n.language),
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
        requiresOnDeviceRecognition: false,
        addsPunctuation: true,
      });
    } catch (e: unknown) {
      setCaptureMode('idle');
      setIsRecording(false);
      setIsProjectHoldActive(false);
      voiceActiveRef.current = false;
      captureChannelRef.current = null;
      const rec = projectAudioRef.current;
      projectAudioRef.current = null;
      if (rec) {
        try {
          await rec.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
      }
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomeSpeech', e);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(t('talkHome.recordingErrorTitle'), msg);
      }
    } finally {
      setIsBusy(false);
    }
  }, [
    clearProjectAudioFile,
    i18n.language,
    isBusy,
    isPostCaptureAnalyzing,
    projectRefine,
    t,
    unloadAvRecording,
    voiceConfirm,
  ]);

  const stopProjectHoldCapture = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') return;
    if (!voiceActiveRef.current) return;
    console.log('LOG [Audio-Capture] Signal d\'arrêt reçu : RELÂCHEMENT PHYSIQUE');
    voiceActiveRef.current = false;
    projectGestureHoldingRef.current = false;
    setIsBusy(true);
    setIsProjectHoldActive(false);
    let audioUri: string | null = null;
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
      const rec = projectAudioRef.current;
      projectAudioRef.current = null;
      if (rec) {
        try {
          await rec.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
        audioUri = rec.getURI() ?? null;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      setIsRecording(false);
      setCaptureMode('idle');
      await new Promise<void>((r) => setTimeout(r, 220));
      const text = (
        finalTranscriptRef.current ||
        partialTranscriptRef.current ||
        ''
      ).trim();
      partialTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      setLivePartial('');
      if (!text) {
        await clearProjectAudioFile(audioUri);
        Alert.alert(
          t('talkHome.transcriptionUnclearTitle'),
          t('talkHome.transcriptionUnclearBody'),
        );
        return;
      }
      setProjectRefine({
        transcript: text,
        editedText: text,
        audioUri,
        isEditing: false,
        isGeneratingPlan: false,
      });
      setMicroToast('');
      captureChannelRef.current = null;
    } catch (e: unknown) {
      await clearProjectAudioFile(audioUri);
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('talkHome.recordingErrorTitle'), msg);
    } finally {
      setIsBusy(false);
      setIsPostCaptureAnalyzing(false);
    }
  }, [clearProjectAudioFile, t]);

  const stopQuickCapture = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') return;
    if (!voiceActiveRef.current) {
      return;
    }
    voiceActiveRef.current = false;
    setIsPostCaptureAnalyzing(true);
    setIsBusy(true);
    await startCaptureProcessingForeground('quick');
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
      await enqueueCaptureProcessingJob(text, i18n.language);
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

      const channel: CaptureChannel = captureChannelRef.current ?? 'intention';
      captureChannelRef.current = null;

      if (channel === 'quick_note') {
        const title =
          text.length > 200 ? `${text.slice(0, 197)}…` : text;
        setVoiceConfirm({
          rawTranscript: text,
          kind: 'task',
          editedTitle: title.trim() || t('talkHome.confirmEmptyTitle'),
          editedTime: '',
          suggestedTags: [STRINGS.TAG_KEYS.A_TRIER],
          routeDecision: 'LOCAL',
          localType: 'NOTE',
          isEditing: false,
          captureChannel: 'quick_note',
        });
        setMicroToast('');
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
        captureChannel: 'intention',
      });
      setMicroToast(
        orchestration.decision === 'LOCAL'
          ? STRINGS.CAPTURE.LOCAL_MAX
          : t('talkHome.scenarioComplexHint'),
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      Alert.alert(t('talkHome.recordingErrorTitle'), message);
    } finally {
      await stopCaptureProcessingForeground();
      captureChannelRef.current = null;
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
    await startCaptureProcessingForeground('deep');
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
      await enqueueCaptureProcessingJob(transcript, i18n.language);
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
        captureChannel: 'projet',
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
      await stopCaptureProcessingForeground();
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
  }, [emitTalkDebug, i18n.language, interactionLanguage, t, unloadAvRecording]);

  const onMicPressIn = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || projectRefine || isBusy || isPostCaptureAnalyzing) return;
    if (voiceActiveRef.current || avRecordingRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    stopAfterStartRef.current = false;
    captureChannelRef.current = 'intention';
    void startQuickCapture();
  }, [
    isBusy,
    isPostCaptureAnalyzing,
    projectRefine,
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

  const onProjectPressIn = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || projectRefine || isBusy || isPostCaptureAnalyzing) return;
    if (voiceActiveRef.current || avRecordingRef.current || projectAudioRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    projectGestureHoldingRef.current = true;
    void startProjectHoldCapture();
  }, [isBusy, isPostCaptureAnalyzing, projectRefine, startProjectHoldCapture, voiceConfirm]);

  const onProjectPressOut = useCallback(() => {
    projectGestureHoldingRef.current = false;
    if (voiceActiveRef.current) {
      void stopProjectHoldCapture();
    }
  }, [stopProjectHoldCapture]);

  const onProjectGestureStateChange = useCallback(
    (event: PanGestureHandlerStateChangeEvent) => {
      const { state } = event.nativeEvent;
      if (state === GestureState.ACTIVE) {
        onProjectPressIn();
        return;
      }
      if (
        state === GestureState.END ||
        state === GestureState.CANCELLED ||
        state === GestureState.FAILED
      ) {
        if (state !== GestureState.END && projectGestureHoldingRef.current) {
          console.log('LOG [Audio-Capture] Signal d\'arrêt reçu : TIMEOUT/AUTRE');
        }
        onProjectPressOut();
      }
    },
    [onProjectPressIn, onProjectPressOut],
  );

  const onQuickNotePress = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || projectRefine || isBusy || isPostCaptureAnalyzing) return;
    if (voiceActiveRef.current || avRecordingRef.current) return;
    stopAfterStartRef.current = false;
    captureChannelRef.current = 'quick_note';
    void startQuickCapture();
    setTimeout(() => {
      if (voiceActiveRef.current) {
        void stopQuickCapture();
      }
    }, 1150);
  }, [isBusy, isPostCaptureAnalyzing, projectRefine, startQuickCapture, stopQuickCapture, voiceConfirm]);

  const onCancelVoice = useCallback(() => {
    if (!voiceConfirm) return;
    resetVoiceConfirm();
  }, [voiceConfirm, resetVoiceConfirm]);

  const onProjectSaveAsNote = useCallback(async () => {
    if (!projectRefine) return;
    const text = projectRefine.editedText.trim();
    if (!text) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    await insertTrankilV2Intention({
      id: newTalkEntityId(),
      type: 'NOTE',
      title: text.length > 180 ? `${text.slice(0, 177)}...` : text,
      content_raw: text,
      metadata_json: JSON.stringify(
        {
          source: 'project_refine_note',
          rawTranscript: projectRefine.transcript,
        },
        null,
        2,
      ),
      suggested_tags: JSON.stringify([STRINGS.TAG_KEYS.A_TRIER]),
      category_id: STRINGS.TAG_KEYS.A_TRIER.toLowerCase(),
      parent_id: null,
      status: 'TODO',
      is_organized: 0,
      is_local_processed: 1,
      complexity_level: 0,
      created_at: Date.now(),
    });
    await cancelProjectRefine();
    setMicroToast('Ajoute au Vrac');
    void refreshRemainingIntents();
  }, [cancelProjectRefine, projectRefine, refreshRemainingIntents, t]);

  const onProjectSaveAsAudio = useCallback(async () => {
    if (!projectRefine) return;
    const text = projectRefine.editedText.trim();
    if (!text) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    await insertTrankilV2Intention({
      id: newTalkEntityId(),
      type: 'AUDIO',
      title: text.length > 120 ? `${text.slice(0, 117)}...` : text,
      content_raw: text,
      metadata_json: JSON.stringify(
        {
          source: 'project_refine_audio',
          audioUri: projectRefine.audioUri,
          rawTranscript: projectRefine.transcript,
        },
        null,
        2,
      ),
      suggested_tags: JSON.stringify([STRINGS.TAG_KEYS.A_TRIER]),
      category_id: STRINGS.TAG_KEYS.A_TRIER.toLowerCase(),
      parent_id: null,
      status: 'TODO',
      is_organized: 0,
      is_local_processed: 1,
      complexity_level: 0,
      created_at: Date.now(),
    });
    setProjectRefine(null);
    setMicroToast('Audio + texte sauvegardes');
    void refreshRemainingIntents();
  }, [projectRefine, refreshRemainingIntents, t]);

  const onProjectGeneratePlan = useCallback(async () => {
    if (!projectRefine) return;
    const text = projectRefine.editedText.trim();
    if (!text) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    if (remainingIntents <= 0) {
      Alert.alert(t('talkHome.deepNoCreditsTitle'), t('talkHome.deepNoCreditsBody'));
      return;
    }
    setProjectRefine((prev) => (prev ? { ...prev, isGeneratingPlan: true } : prev));
    setIsBusy(true);
    try {
      const expertRows = await atomizeProject(text);
      const taskCount = expertRows.filter((row) => row.type === 'TASK').length;
      const projectTitle =
        expertRows.find((row) => row.type === 'PROJECT')?.title?.trim() || text.slice(0, 80);
      setProjectPlanPreview({
        projectTitle,
        rawInput: text,
        rows: expertRows,
        taskAlarmIndexes: [],
      });
      setMicroToast(taskCount > 0 ? 'Plan IA pret a visualiser' : 'Aucune etape detectee');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('talkHome.voicePersistErrorTitle'), msg || t('talkHome.voicePersistErrorBody'));
    } finally {
      setProjectRefine((prev) => (prev ? { ...prev, isGeneratingPlan: false } : prev));
      setIsBusy(false);
    }
  }, [projectRefine, remainingIntents, t]);

  const togglePlanTaskAlarm = useCallback((taskIndex: number) => {
    setProjectPlanPreview((prev) => {
      if (!prev) return prev;
      const has = prev.taskAlarmIndexes.includes(taskIndex);
      return {
        ...prev,
        taskAlarmIndexes: has
          ? prev.taskAlarmIndexes.filter((idx) => idx !== taskIndex)
          : [...prev.taskAlarmIndexes, taskIndex],
      };
    });
  }, []);

  const onValidateProjectPlan = useCallback(async () => {
    if (!projectPlanPreview) return;
    if (remainingIntents <= 0) {
      Alert.alert(t('talkHome.deepNoCreditsTitle'), t('talkHome.deepNoCreditsBody'));
      return;
    }
    setIsBusy(true);
    try {
      await resetLocalStreakOnExpert();
      await persistGeminiExpertRows(projectPlanPreview.rawInput, projectPlanPreview.rows, {
        taskAlarmIndexes: projectPlanPreview.taskAlarmIndexes,
      });
      const expertPoints = growthPointsFromExpertRows(projectPlanPreview.rows);
      if (expertPoints > 0) {
        const next = await updateGrowth(expertPoints);
        setGrowthScore(next.growth_score);
        setFlowerPulseKey((k) => k + 1);
        setFlowerNeedsAttention(false);
      }
      const afterConsume = await consumeTrankilV2IntentCredit();
      setRemainingIntents(afterConsume.remaining_intents);
      setProjectPlanPreview(null);
      await cancelProjectRefine();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRewardToast('Plan valide et enregistre');
      setTimeout(() => setRewardToast(''), 2000);
      setMicroToast('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('talkHome.voicePersistErrorTitle'), msg || t('talkHome.voicePersistErrorBody'));
    } finally {
      setIsBusy(false);
    }
  }, [cancelProjectRefine, projectPlanPreview, remainingIntents, t]);

  const onProcessVoice = useCallback(async () => {
    if (!voiceConfirm) return;
    const trimmedTitle = voiceConfirm.editedTitle.trim();
    if (!trimmedTitle) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    const desc = voiceConfirm.editedTime.trim();
    const rawTranscript = voiceConfirm.rawTranscript.trim();
    const routeDecision = voiceConfirm.routeDecision;
    setIsBusy(true);
    try {
      if (voiceConfirm.captureChannel === 'quick_note') {
        await insertTrankilV2Intention({
          id: newTalkEntityId(),
          type: 'NOTE',
          title: trimmedTitle,
          content_raw: rawTranscript,
          metadata_json: JSON.stringify(
            {
              timeMarker: desc,
              source: 'quick_note_raw',
              plain: true,
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
          is_local_processed: 0,
          complexity_level: 0,
          created_at: Date.now(),
        });
        resetVoiceConfirm();
        setMicroToast('');
        return;
      }

      if (routeDecision === 'COMPLEX') {
        await resetLocalStreakOnExpert();
        setIsExpertLoading(true);
        const expertRows =
          voiceConfirm.captureChannel === 'projet'
            ? await atomizeProject(rawTranscript)
            : await askGeminiExpert(rawTranscript);
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

  const renderPingCard = () => null;

  /** Quick : texte ASR partiel/final. Deep : consigne mains libres (pas de preview .m4a). */
  const renderLiveSpeechCard = () => {
    if (isProjectHoldActive) {
      const line = livePartial.trim()
        ? livePartial.trim()
        : t('talkHome.voiceLivePlaceholder');
      return (
        <View style={styles.titleHeroWrap}>
          <Text style={styles.projectLiveTextMuted}>{line}</Text>
        </View>
      );
    }
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

  const renderProjectRefineCard = () => {
    if (!projectRefine) return null;
    const textValue = projectRefine.editedText.trim();
    return (
      <>
        <ScrollView
          style={styles.projectRefineScroll}
          contentContainerStyle={styles.projectRefineContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.confirmBlockLabel}>Projet capture</Text>
          {projectRefine.isEditing ? (
            <TextInput
              value={projectRefine.editedText}
              onChangeText={(v) => {
                setProjectRefine((prev) => (prev ? { ...prev, editedText: v } : prev));
              }}
              style={styles.editTitleInput}
              multiline
              autoFocus
              placeholder={t('talkHome.voiceLivePlaceholder')}
              placeholderTextColor="rgba(44,62,80,0.45)"
            />
          ) : (
            <Pressable
              style={styles.titleHeroWrap}
              onPress={() => {
                setProjectRefine((prev) => (prev ? { ...prev, isEditing: true } : prev));
              }}
            >
              <Text style={styles.projectLiveTextMuted}>
                {textValue || t('talkHome.voiceLivePlaceholder')}
              </Text>
            </Pressable>
          )}

          {projectRefine.isGeneratingPlan ? (
            <Text style={styles.confirmScenarioLine}>Analyse Gemini...</Text>
          ) : null}

          <View style={styles.projectChoiceGrid}>
            <Pressable
              style={[styles.projectChoiceBtn, styles.voiceNoteBtn]}
              onPress={() => {
                void cancelProjectRefine();
              }}
              disabled={isBusy}
            >
              <Text style={styles.voiceNoteText}>❌ ANNULER</Text>
            </Pressable>
            <Pressable
              style={[styles.projectChoiceBtn, styles.voiceNoteBtn]}
              onPress={() => {
                void onProjectSaveAsNote();
              }}
              disabled={isBusy}
            >
              <Text style={styles.voiceNoteText}>💾 NOTE</Text>
            </Pressable>
            <Pressable
              style={[styles.projectChoiceBtn, styles.voiceNoteBtn]}
              onPress={() => {
                void onProjectSaveAsAudio();
              }}
              disabled={isBusy}
            >
              <Text style={styles.voiceNoteText}>🎙️ AUDIO</Text>
            </Pressable>
            <Pressable
              style={[styles.projectChoiceBtn, styles.voiceValidateBtn]}
              onPress={() => {
                void onProjectGeneratePlan();
              }}
              disabled={isBusy || projectRefine.isGeneratingPlan}
            >
              <Text style={styles.voiceValidateText}>✨ GENERER PLAN PROJET</Text>
              <Text style={styles.projectCreditHint}>(1 💎)</Text>
            </Pressable>
          </View>
        </ScrollView>
      </>
    );
  };

  const micA11yLabel = useMemo(() => {
    if (isRecording) return t('talkHome.orbital.holdRelease');
    return t('talkHome.a11yMicQuick');
  }, [isRecording, t]);

  const renderConfirmCard = () => {
    if (!voiceConfirm) return null;
    const {
      editedTitle,
      editedTime,
      isEditing,
      kind,
      suggestedTags,
      routeDecision,
      captureChannel,
    } = voiceConfirm;
    const timeDisplay = editedTime.trim() ? editedTime.trim() : t('talkHome.timeUnspecified');
    const scenarioLine =
      captureChannel === 'quick_note'
        ? t('talkHome.scenarioQuickNote')
        : routeDecision === 'LOCAL'
          ? t('talkHome.scenarioLocal')
          : t('talkHome.scenarioComplex');
    const typeLabel =
      captureChannel === 'quick_note' ? t('talkHome.intentType.note') : intentTypeLabel(kind);
    const validateCta =
      routeDecision === 'COMPLEX' ? t('talkHome.voiceCallExpert') : t('talkHome.voiceValidate');

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
            <Pencil size={20} color={OLED_TEXT} />
          </Pressable>
        </View>

        <View style={styles.typeRow}>
          <Text style={styles.confirmMetaLabel}>{t('talkHome.confirmTypePrefix')}</Text>
          <Text style={styles.typeValue}>{typeLabel}</Text>
        </View>
        <Text style={styles.confirmScenarioLine}>{scenarioLine}</Text>

        <Text style={styles.confirmBlockLabel}>{t('talkHome.confirmActionLabel')}</Text>
        {isEditing ? (
          <TextInput
            value={editedTitle}
            onChangeText={(v) => {
              setVoiceConfirm((prev) => (prev ? { ...prev, editedTitle: v } : prev));
            }}
            style={styles.editTitleInput}
            multiline
            placeholderTextColor="rgba(44,62,80,0.45)"
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
              placeholderTextColor="rgba(44,62,80,0.45)"
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
            style={[styles.voiceActionBtn, styles.voiceNoteBtn]}
            onPress={() => {
              void onCancelVoice();
            }}
            disabled={isBusy}
          >
            <View style={styles.voiceActionContent}>
              <X size={16} color="#2C3E50" />
              <Text style={styles.voiceNoteText}>{t('talkHome.voiceNote')}</Text>
            </View>
          </Pressable>
          <Pressable
            style={[styles.voiceActionBtn, styles.voiceValidateBtn]}
            onPress={() => {
              void onProcessVoice();
            }}
            disabled={isBusy}
          >
            <View style={styles.voiceActionContent}>
              <Check size={16} color="#f2fefd" />
              <Text style={styles.voiceValidateText}>{validateCta}</Text>
            </View>
          </Pressable>
        </View>
      </>
    );
  };

  return (
    <View style={styles.root}>
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

      <View style={styles.bodySpacer} />

      <View
        style={[styles.bottomHud, { bottom: insets.bottom + 118 }]}
        pointerEvents="none"
      >
        <BottomStatus microToast={microToast} />
      </View>

      <View style={styles.talkieGhostDeck} pointerEvents="box-none">
        <PanGestureHandler
          enabled={
            !(
              isBusy ||
              voiceConfirm !== null ||
              projectRefine !== null ||
              Platform.OS === 'web' ||
              isPostCaptureAnalyzing
            )
          }
          activateAfterLongPress={160}
          minPointers={1}
          maxPointers={1}
          shouldCancelWhenOutside={false}
          onHandlerStateChange={onProjectGestureStateChange}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={t('talkHome.a11yTalkieProjet')}
            accessibilityHint={t('talkHome.talkieProjet')}
            style={[styles.ghostSide, styles.ghostSideLeft]}
          >
            {isProjectHoldActive || projectRefine ? null : (
              <View style={[styles.ghostBtnInner, { opacity: 0.8 }]}>
                <Folder size={28} color="#2C3E50" />
                <Text style={styles.ghostBtnLabel}>{t('talkHome.talkieProjet')}</Text>
              </View>
            )}
          </View>
        </PanGestureHandler>
        <Animated.View style={[styles.ghostMainWrap, { transform: [{ scale: micScale }] }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={micA11yLabel}
            accessibilityHint={t('talkHome.talkieIntention')}
            onPressIn={onMicPressIn}
            onPressOut={onMicPressOut}
            disabled={
              isBusy ||
              voiceConfirm !== null ||
              projectRefine !== null ||
              Platform.OS === 'web' ||
              isPostCaptureAnalyzing
            }
            hitSlop={14}
            android_ripple={{ color: 'rgba(0,128,128,0.14)', borderless: true }}
            style={styles.ghostMain}
          >
            {({ pressed }) =>
              isProjectHoldActive || projectRefine ? null : (
                <View style={[styles.ghostMainInner, { opacity: pressed ? 0.5 : 0.8 }]}>
                  <Target size={38} color="#2C3E50" />
                  <Text style={styles.ghostBtnLabel}>{t('talkHome.talkieIntention')}</Text>
                </View>
              )
            }
          </Pressable>
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('talkHome.a11yTalkieQuickNote')}
          accessibilityHint={t('talkHome.talkieQuickNote')}
          onPress={onQuickNotePress}
          onPressIn={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          }}
          disabled={
            isBusy || voiceConfirm !== null || projectRefine !== null || Platform.OS === 'web' || isPostCaptureAnalyzing
          }
          hitSlop={12}
          android_ripple={{ color: 'rgba(44,62,80,0.12)', borderless: true }}
          style={[styles.ghostSide, styles.ghostSideRight]}
        >
          {({ pressed }) =>
            isProjectHoldActive || projectRefine ? null : (
              <View style={[styles.ghostBtnInner, { opacity: pressed ? 0.5 : 0.8 }]}>
                <Zap size={28} color="#2C3E50" />
                <Text style={styles.ghostBtnLabel}>{t('talkHome.talkieQuickNote')}</Text>
              </View>
            )
          }
        </Pressable>
      </View>

      <View style={styles.semanticModalZone} pointerEvents="box-none">
        <View style={styles.oledModalFrame}>
          <View style={styles.pingCard}>
            {projectRefine
              ? renderProjectRefineCard()
              : voiceConfirm
                ? renderConfirmCard()
                : isPostCaptureAnalyzing
                ? renderAnalyzingCard()
                : isRecording
                  ? renderLiveSpeechCard()
                  : renderPingCard()}
          </View>
        </View>
      </View>

      <Modal
        visible={Boolean(projectPlanPreview)}
        transparent
        animationType="slide"
        onRequestClose={() => setProjectPlanPreview(null)}
      >
        <View style={styles.planPreviewBackdrop}>
          <View style={styles.planPreviewCard}>
            <Text style={styles.planPreviewTitle}>Visualiser IA Plan (1 Crédit)</Text>
            <Text style={styles.planPreviewWarning}>
              Le crédit est débité au clic sur Valider Plan et non sur la visualisation.
            </Text>
            <Text style={styles.planPreviewProjectTitle}>
              {projectPlanPreview?.projectTitle || 'Projet'}
            </Text>
            <ScrollView style={styles.planPreviewScroll} contentContainerStyle={styles.planPreviewScrollContent}>
              {(() => {
                let taskIdx = -1;
                return (projectPlanPreview?.rows ?? [])
                  .filter((row) => row.type === 'TASK')
                  .map((row) => {
                    taskIdx += 1;
                    const enabled = (projectPlanPreview?.taskAlarmIndexes ?? []).includes(taskIdx);
                    return (
                      <View key={`${row.title}-${taskIdx}`} style={styles.planTaskRow}>
                        <Pressable style={styles.planBellBtn} onPress={() => togglePlanTaskAlarm(taskIdx)}>
                          <Bell size={20} color={enabled ? '#FF8C00' : 'rgba(44,62,80,0.35)'} />
                        </Pressable>
                        <Text style={styles.planTaskText}>{row.title}</Text>
                      </View>
                    );
                  });
              })()}
            </ScrollView>

            <View style={styles.planPreviewActions}>
              <Pressable style={[styles.planActionBtn, styles.planCancelBtn]} onPress={() => setProjectPlanPreview(null)}>
                <Text style={styles.planCancelText}>❌ ANNULER</Text>
              </Pressable>
              <Pressable
                style={[styles.planActionBtn, styles.planValidateBtn]}
                onPress={() => {
                  void onValidateProjectPlan();
                }}
                disabled={isBusy}
              >
                <Text style={styles.planValidateText}>✅ VALIDER LE PLAN</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F0',
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
    backgroundColor: 'transparent',
  },
  brandName: { fontSize: 34, fontWeight: '700', color: '#2e5f68' },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  bodySpacer: {
    flex: 1,
  },
  bottomHud: {
    position: 'absolute',
    left: 22,
    right: 22,
    alignItems: 'center',
    zIndex: 11,
  },
  /** Zones tactiles invisibles, alignées sur les 3 boutons physiques du talkie (fond image) */
  talkieGhostDeck: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 20,
  },
  ghostSide: {
    position: 'absolute',
    width: ratioPct(TALKIE_BTN_LAYOUT.left.diameter, TALKIE_BG_BASE.width),
    height: ratioPct(TALKIE_BTN_LAYOUT.left.diameter, TALKIE_BG_BASE.width),
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0)',
  },
  ghostSideLeft: {
    left: ratioPct(
      TALKIE_BTN_LAYOUT.left.cx - TALKIE_BTN_LAYOUT.left.diameter / 2,
      TALKIE_BG_BASE.width,
    ),
    top: ratioPct(
      TALKIE_BTN_LAYOUT.left.cy - TALKIE_BTN_LAYOUT.left.diameter / 2,
      TALKIE_BG_BASE.height,
    ),
  },
  ghostSideRight: {
    left: ratioPct(
      TALKIE_BTN_LAYOUT.right.cx - TALKIE_BTN_LAYOUT.right.diameter / 2,
      TALKIE_BG_BASE.width,
    ),
    top: ratioPct(
      TALKIE_BTN_LAYOUT.right.cy - TALKIE_BTN_LAYOUT.right.diameter / 2,
      TALKIE_BG_BASE.height,
    ),
  },
  ghostMainWrap: {
    position: 'absolute',
    left: ratioPct(
      TALKIE_BTN_LAYOUT.center.cx - TALKIE_BTN_LAYOUT.center.diameter / 2,
      TALKIE_BG_BASE.width,
    ),
    top: ratioPct(
      TALKIE_BTN_LAYOUT.center.cy - TALKIE_BTN_LAYOUT.center.diameter / 2,
      TALKIE_BG_BASE.height,
    ),
    width: ratioPct(TALKIE_BTN_LAYOUT.center.diameter, TALKIE_BG_BASE.width),
    height: ratioPct(TALKIE_BTN_LAYOUT.center.diameter, TALKIE_BG_BASE.width),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostMain: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0)',
  },
  ghostBtnInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  ghostMainInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  ghostBtnLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#2C3E50',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  semanticModalZone: {
    position: 'absolute',
    left: ratioPct(TALKIE_OLED.x, TALKIE_BG_BASE.width),
    top: ratioPct(TALKIE_OLED.y, TALKIE_BG_BASE.height),
    width: ratioPct(TALKIE_OLED.w, TALKIE_BG_BASE.width),
    height: ratioPct(TALKIE_OLED.h, TALKIE_BG_BASE.height),
    zIndex: 10,
    elevation: 10,
  },
  oledModalFrame: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 27,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 31,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0)',
  },
  pingCard: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 27,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 31,
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0)',
  },
  priorityBadge: {
    textAlign: 'center',
    color: '#2C3E50',
    fontWeight: '700',
    marginBottom: 8,
    fontSize: 17,
  },
  question: { textAlign: 'center', fontSize: 34, fontWeight: '600', color: '#2C3E50' },
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
  noText: { color: '#2C3E50', fontWeight: '700', fontSize: 24 },
  privacyHint: {
    marginTop: 12,
    textAlign: 'center',
    color: '#77807a',
    fontSize: 13,
    fontWeight: '500',
  },
  liveSpeechLead: {
    textAlign: 'center',
    color: '#2C3E50',
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
    color: '#2C3E50',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  editIconBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(44,62,80,0.06)',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  confirmScenarioLine: {
    marginTop: -7,
    marginBottom: 12,
    fontSize: 12,
    fontWeight: '600',
    color: '#2C3E50',
    textAlign: 'left',
  },
  confirmMetaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(44,62,80,0.75)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  typeValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2C3E50',
    backgroundColor: 'rgba(44, 62, 80, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    overflow: 'hidden',
  },
  confirmBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(44,62,80,0.72)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  titleHeroWrap: {
    backgroundColor: 'rgba(0,0,0,0)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(44, 62, 80, 0.18)',
  },
  titleHero: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2C3E50',
    lineHeight: 28,
  },
  liveStatusLead: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2C3E50',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  editTitleInput: {
    backgroundColor: 'rgba(44,62,80,0.06)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#2C3E50',
    borderWidth: 1,
    borderColor: 'rgba(44, 62, 80, 0.22)',
    minHeight: 56,
    textAlignVertical: 'top',
  },
  timeSection: {
    marginBottom: 14,
  },
  timeValueWrap: {
    backgroundColor: 'rgba(44,62,80,0.06)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    borderLeftColor: 'rgba(0, 128, 128, 0.65)',
  },
  timeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
  },
  editTimeInput: {
    backgroundColor: 'rgba(44,62,80,0.06)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
    borderWidth: 1,
    borderColor: 'rgba(44, 62, 80, 0.22)',
  },
  voiceActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  tagChip: {
    borderRadius: 10,
    backgroundColor: 'rgba(44,62,80,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagChipText: { color: '#2C3E50', fontSize: 12, fontWeight: '700' },
  tagQuickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  tagQuickBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagQuickBtnText: { color: '#2C3E50', fontSize: 11, fontWeight: '600' },
  voiceActionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#4e6967',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  voiceActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceNoteBtn: {
    backgroundColor: 'rgba(245, 247, 246, 0.55)',
    borderColor: 'rgba(161, 178, 175, 0.38)',
  },
  voiceNoteText: {
    color: '#2C3E50',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.6,
  },
  voiceValidateBtn: {
    backgroundColor: 'rgba(34, 126, 128, 0.78)',
    borderColor: 'rgba(202, 245, 239, 0.42)',
  },
  voiceValidateText: {
    color: '#f2fefd',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.7,
  },
  projectLiveTextMuted: {
    color: 'rgba(44,62,80,0.62)',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 30,
  },
  projectRefineScroll: {
    flex: 1,
  },
  projectRefineContent: {
    paddingBottom: 6,
  },
  projectChoiceGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  projectChoiceBtn: {
    width: '48.5%',
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  projectCreditHint: {
    marginTop: 2,
    color: '#c9f4f0',
    fontSize: 11,
    fontWeight: '700',
  },
  planPreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 20, 18, 0.36)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 26,
  },
  planPreviewCard: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: '#F6F2E8',
    borderWidth: 1,
    borderColor: 'rgba(122, 104, 78, 0.15)',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
  },
  planPreviewTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#2C3E50',
  },
  planPreviewWarning: {
    marginTop: 8,
    fontSize: 12,
    color: '#7a5a2f',
    fontWeight: '600',
  },
  planPreviewProjectTitle: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
  },
  planPreviewScroll: {
    marginTop: 10,
    flex: 1,
  },
  planPreviewScrollContent: {
    paddingBottom: 14,
    gap: 8,
  },
  planTaskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 10,
  },
  planBellBtn: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 2,
  },
  planTaskText: {
    flex: 1,
    fontSize: 14,
    color: '#2C3E50',
    lineHeight: 20,
    fontWeight: '600',
  },
  planPreviewActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  planActionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  planCancelBtn: {
    backgroundColor: 'rgba(245, 247, 246, 0.75)',
    borderColor: 'rgba(161, 178, 175, 0.38)',
  },
  planValidateBtn: {
    backgroundColor: 'rgba(34, 126, 128, 0.86)',
    borderColor: 'rgba(202, 245, 239, 0.42)',
  },
  planCancelText: {
    color: '#2C3E50',
    fontWeight: '700',
    fontSize: 13,
  },
  planValidateText: {
    color: '#f2fefd',
    fontWeight: '800',
    fontSize: 13,
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
  creditLine: {
    marginTop: 6,
    fontSize: 12,
    color: '#2C3E50',
    letterSpacing: 0.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  microToast: {
    marginTop: 4,
    fontSize: 12,
    color: '#2C3E50',
    fontWeight: '700',
    textAlign: 'center',
  },
});
