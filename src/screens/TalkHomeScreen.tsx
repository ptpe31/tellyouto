import { Audio } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import * as Localization from 'expo-localization';
import Share from 'react-native-share';
import * as chrono from 'chrono-node';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { Bell, Check, Lock, Mic, Pencil, UserCircle2, Waves, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RewardToast } from '../components/RewardToast';
import {
  ActivityIndicator,
  Alert,
  Animated,
  DeviceEventEmitter,
  Easing,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MainInterface, type UiMode } from '../components/MainInterface';
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
} from '../api/trankilV2Db';
import { syncPendingIntentions } from '../api/syncService';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import type { TalkCaptureDebugPayload } from '../constants/talkCaptureDebug';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import type { AppLanguage } from '../context/LanguageContext';
import { useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { isAdFreeModeActive } from '../context/UserSpectrumContext';
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
import { claimDailyQuestBonus, getDailyQuestSnapshot, type DailyQuest } from '../services/QuestManager';
import { awardZenForAction } from '../services/ZenEngine';
import {
  addDaysYmd,
  computeTimeHorizonFromDueDate,
  formatYmdLocal,
  TIME_HORIZON_META,
  type TimeHorizonKey,
} from '../services/TimeSorter';
import {
  enqueueCaptureProcessingJob,
  startCaptureProcessingForeground,
  stopCaptureProcessingForeground,
} from '../services/CaptureProcessingService';
import { STRINGS } from '../constants/Strings';
import { runManualIaRechargeVideo } from '../services/AdManager';
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
const LIVE_TEXT_DEBOUNCE_MS = 280;

function ratioPct(value: number, total: number): `${number}%` {
  return `${((value / total) * 100).toFixed(2)}%` as `${number}%`;
}

type CaptureChannel = 'intention' | 'quick_note' | 'projet';
type ConceptTarget = 'PROJECT' | 'TASK' | 'NOTE';

type VoiceConfirmState = {
  rawTranscript: string;
  kind: VoiceIntentKind;
  editedTitle: string;
  editedTime: string;
  dueDateYmd: string | null;
  suggestedTags: string[];
  routeDecision: OrchestratorDecision;
  localType: 'TASK' | 'HABIT' | 'NOTE';
  isEditing: boolean;
  isTimeListening?: boolean;
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
  selectedTaskIndexes: number[];
  taskAlarmIndexes: number[];
};

type DeadlineCaptureState = {
  visible: boolean;
  baseText: string;
  capturedText: string;
  isListening: boolean;
  lastError: string;
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

function resolveChronoParser(locale: string) {
  const lang = (locale || 'fr').slice(0, 2).toLowerCase();
  if (lang === 'fr') return chrono.fr;
  if (lang === 'de') return chrono.de;
  if (lang === 'it') return chrono.it;
  if (lang === 'es') return chrono.es;
  if (lang === 'ja') return chrono.ja;
  if (lang === 'zh') return chrono.zh;
  return chrono.en;
}

function computeDueDateFromWhenText(whenText: string, locale: string): string | null {
  const cleaned = whenText.trim();
  if (!cleaned) return null;
  const direct = cleaned.match(/\b(\d{8})\b/);
  if (direct?.[1]) return direct[1];
  const parser = resolveChronoParser(locale);
  const parsed = parser.parseDate(cleaned, new Date(), { forwardDate: true });
  if (!parsed) return null;
  return formatYmdLocal(parsed);
}

function buildTimeLabelFromDate(date: Date | null, locale: string): string {
  if (!date) return '';
  try {
    const loc = locale || Intl.DateTimeFormat().resolvedOptions().locale || undefined;
    const day = new Intl.DateTimeFormat(loc, { day: '2-digit', month: 'short' }).format(date);
    const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(date);
    return `${day}, ${time}`;
  } catch {
    return date.toLocaleString();
  }
}

function growthPointsFromExpertRows(rows: GeminiExpertIntention[]): number {
  if (rows.some((r) => r.type === 'PROJECT')) return growthPointsForType('PROJECT');
  if (rows.some((r) => r.type === 'HABIT')) return growthPointsForType('HABIT');
  if (rows.some((r) => r.type === 'TASK')) return growthPointsForType('TASK');
  return 0;
}

function parseYyyyMmDd(input: string): Date | null {
  const raw = String(input || '').trim();
  if (!/^\d{8}$/.test(raw)) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6));
  const d = Number(raw.slice(6, 8));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

function formatDueDateShort(input: string): string {
  const date = parseYyyyMmDd(input);
  if (!date) return '--';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || undefined;
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(date);
  } catch {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}

async function persistGeminiExpertRows(
  rawInput: string,
  rows: GeminiExpertIntention[],
  options?: { taskAlarmIndexes?: number[]; selectedTaskIndexes?: number[] },
): Promise<void> {
  let currentParentId: string | null = null;
  let taskCursor = 0;
  const alarmSet = new Set(options?.taskAlarmIndexes ?? []);
  const selectedSet = new Set(options?.selectedTaskIndexes ?? []);
  for (const row of rows) {
    if (row.type === 'TASK' && selectedSet.size > 0 && !selectedSet.has(taskCursor)) {
      taskCursor += 1;
      continue;
    }
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
      due_date:
        row.type === 'TASK'
          ? String((row.metadata as { due_date?: unknown })?.due_date || '').trim() || null
          : null,
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
  const [deadlineCapture, setDeadlineCapture] = useState<DeadlineCaptureState>({
    visible: false,
    baseText: '',
    capturedText: '',
    isListening: false,
    lastError: '',
  });
  const [uiMode, setUiMode] = useState<UiMode>('IDLE');
  const [isProjectHoldActive, setIsProjectHoldActive] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<ConceptTarget>('PROJECT');
  const [isMicLocked, setIsMicLocked] = useState(false);
  const [isCapturePaused, setIsCapturePaused] = useState(false);
  const [cancelSweepActive, setCancelSweepActive] = useState(false);
  const [livePartial, setLivePartial] = useState('');
  const [audioLevel, setAudioLevel] = useState(0.16);
  const [waveBars, setWaveBars] = useState<number[]>([8, 10, 13, 18, 24, 18, 13, 10, 8]);
  const [remainingIntents, setRemainingIntents] = useState(10);
  const [microToast, setMicroToast] = useState('');
  const [rewardToast, setRewardToast] = useState('');
  const [growthScore, setGrowthScore] = useState(0);
  const [flowerPulseKey, setFlowerPulseKey] = useState(0);
  const [flowerNeedsAttention, setFlowerNeedsAttention] = useState(false);
  const [localEcoScore, setLocalEcoScore] = useState(0);
  const [dailyQuest, setDailyQuest] = useState<DailyQuest | null>(null);
  const [dailyQuestProgress, setDailyQuestProgress] = useState(0);
  const [dailyQuestTarget, setDailyQuestTarget] = useState(0);
  const [dailyQuestCanClaim, setDailyQuestCanClaim] = useState(false);
  const [dailyQuestClaimed, setDailyQuestClaimed] = useState(false);
  const voiceActiveRef = useRef(false);
  const stopAfterStartRef = useRef(false);
  const projectGestureHoldingRef = useRef(false);
  const deadlineCaptureActiveRef = useRef(false);
  const timeFieldCaptureActiveRef = useRef(false);
  const stopQuickCaptureRef = useRef<null | (() => Promise<void>)>(null);
  const captureChannelRef = useRef<CaptureChannel | null>(null);
  const startedAtRef = useRef<number>(0);
  const partialTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const speechErrorRef = useRef(false);
  const lastPartialLenRef = useRef(0);
  const debounceLiveTextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLiveTextPushAtRef = useRef(0);
  const cancelSweepAnim = useRef(new Animated.Value(0)).current;
  const avRecordingRef = useRef<Audio.Recording | null>(null);
  const projectAudioRef = useRef<Audio.Recording | null>(null);
  const micScale = useRef(new Animated.Value(1)).current;
  const centerFade = useRef(new Animated.Value(0)).current;

  const transitionUiMode = useCallback((next: UiMode) => {
    setUiMode((prev) => {
      if (prev === next) return prev;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      return next;
    });
  }, []);

  const flushLiveTranscriptNow = useCallback(() => {
    if (debounceLiveTextTimerRef.current) {
      clearTimeout(debounceLiveTextTimerRef.current);
      debounceLiveTextTimerRef.current = null;
    }
    lastLiveTextPushAtRef.current = Date.now();
    setLivePartial(partialTranscriptRef.current);
  }, []);

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
    setDeadlineCapture({ visible: false, baseText: '', capturedText: '', isListening: false, lastError: '' });
    await clearProjectAudioFile(uri);
  }, [clearProjectAudioFile, projectRefine]);

  const refreshRemainingIntents = useCallback(async () => {
    try {
      await applyGrowthDecayIfNeeded();
      const stats = await getTrankilV2UserStats();
      setRemainingIntents(stats.ia_credits);
      setGrowthScore(stats.zen_points);
      setLocalEcoScore(await getLocalEcoScore());
      setFlowerNeedsAttention(false);
      const quest = await getDailyQuestSnapshot();
      setDailyQuest(quest.quest);
      setDailyQuestProgress(quest.progress);
      setDailyQuestTarget(quest.target);
      setDailyQuestCanClaim(quest.canClaim);
      setDailyQuestClaimed(quest.claimed);
    } catch {
      setRemainingIntents(10);
      setGrowthScore(0);
      setFlowerNeedsAttention(false);
      setLocalEcoScore(0);
      setDailyQuest(null);
      setDailyQuestProgress(0);
      setDailyQuestTarget(0);
      setDailyQuestCanClaim(false);
      setDailyQuestClaimed(false);
    }
  }, []);

  const onClaimDailyQuest = useCallback(async () => {
    if (!dailyQuestCanClaim || isBusy) return;
    setIsBusy(true);
    try {
      const claim = await claimDailyQuestBonus();
      if (!claim.ok) {
        Alert.alert(t('quests.notReadyTitle'), t('quests.notReadyBody'));
        return;
      }
      await syncPendingIntentions();
      setRewardToast(t('quests.claimedToast', { gain: claim.gain }));
      setTimeout(() => setRewardToast(''), 2200);
      await refreshRemainingIntents();
    } finally {
      setIsBusy(false);
    }
  }, [dailyQuestCanClaim, isBusy, refreshRemainingIntents, t]);

  const adFreeActive = isAdFreeModeActive(spectrum);

  const promptIaRechargeModal = useCallback(() => {
    Alert.alert(
      t('economy.recharge.modalTitle'),
      t('economy.recharge.modalBody'),
      [
        { text: t('common.later'), style: 'cancel' },
        {
          text: t('economy.recharge.watchVideoCta'),
          onPress: () => {
            void (async () => {
              setIsBusy(true);
              try {
                const res = await runManualIaRechargeVideo();
                if (!res.ok) {
                  const reason =
                    res.reason === 'daily_limit_reached'
                      ? t('economy.recharge.dailyCapReached')
                      : res.reason === 'recharge_cooldown'
                        ? t('economy.recharge.cooldown')
                        : t('common.tryAgainSoon');
                  Alert.alert(t('economy.recharge.unavailableTitle'), reason);
                  return;
                }
                setRemainingIntents(res.creditsAfter);
                setMicroToast(t('economy.recharge.rewardToast'));
                await refreshRemainingIntents();
              } finally {
                setIsBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [refreshRemainingIntents, t]);

  useEffect(() => {
    void refreshRemainingIntents();
  }, [refreshRemainingIntents]);

  useFocusEffect(
    useCallback(() => {
      void refreshRemainingIntents();
    }, [refreshRemainingIntents]),
  );

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    deadlineCaptureActiveRef.current = deadlineCapture.visible && deadlineCapture.isListening;
  }, [deadlineCapture.isListening, deadlineCapture.visible]);

  useEffect(() => {
    if (projectRefine || voiceConfirm) {
      transitionUiMode('DECISION');
      return;
    }
    if (isRecording || isMicLocked || isProjectHoldActive) {
      transitionUiMode('RECORDING');
      return;
    }
    transitionUiMode('IDLE');
  }, [
    isMicLocked,
    isProjectHoldActive,
    isRecording,
    projectRefine,
    transitionUiMode,
    voiceConfirm,
  ]);

  useEffect(() => {
    Animated.timing(centerFade, {
      toValue: uiMode === 'IDLE' ? 0 : 1,
      duration: uiMode === 'IDLE' ? 120 : 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [centerFade, uiMode]);

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
    if (deadlineCaptureActiveRef.current) {
      setDeadlineCapture((prev) =>
        prev.visible ? { ...prev, capturedText: text, isListening: !event.isFinal } : prev,
      );
      return;
    }
    if (timeFieldCaptureActiveRef.current) {
      setVoiceConfirm((prev) => {
        if (!prev) return prev;
        const dueDateYmd = computeDueDateFromWhenText(text, i18n.language) ?? prev.dueDateYmd;
        if (event.isFinal) {
          timeFieldCaptureActiveRef.current = false;
        }
        return {
          ...prev,
          editedTime: text,
          dueDateYmd,
          isTimeListening: !event.isFinal,
        };
      });
      return;
    }
    partialTranscriptRef.current = text;
    const len = text.length;
    const delta = Math.abs(len - lastPartialLenRef.current);
    lastPartialLenRef.current = len;
    const derivedLevel = Math.min(1, 0.18 + delta / 22);
    setAudioLevel(derivedLevel);
    const now = Date.now();
    const flush = () => {
      lastLiveTextPushAtRef.current = Date.now();
      setLivePartial(partialTranscriptRef.current);
    };
    if (now - lastLiveTextPushAtRef.current >= LIVE_TEXT_DEBOUNCE_MS) {
      flush();
    } else if (!debounceLiveTextTimerRef.current) {
      debounceLiveTextTimerRef.current = setTimeout(() => {
        debounceLiveTextTimerRef.current = null;
        flush();
      }, LIVE_TEXT_DEBOUNCE_MS - (now - lastLiveTextPushAtRef.current));
    }
    if (event.isFinal && text.trim()) {
      finalTranscriptRef.current = text.trim();
    }
  });

  useEffect(() => {
    if (!(isRecording || isMicLocked)) {
      setWaveBars([8, 10, 13, 18, 24, 18, 13, 10, 8]);
      return;
    }
    if (isCapturePaused) {
      setWaveBars([8, 8, 8, 8, 8, 8, 8, 8, 8]);
      return;
    }
    const id = setInterval(() => {
      setAudioLevel((prev) => Math.max(0.1, prev * 0.87));
      const amp = 7 + audioLevel * 34;
      setWaveBars(
        Array.from({ length: 9 }, (_, idx) => {
          const center = 4 - Math.abs(4 - idx) * 0.8;
          const jitter = 0.55 + Math.random() * 0.85;
          return Math.max(6, center * amp * jitter);
        }),
      );
    }, 120);
    return () => clearInterval(id);
  }, [audioLevel, isCapturePaused, isMicLocked, isRecording]);

  useSpeechRecognitionEvent('error', (event) => {
    if (deadlineCaptureActiveRef.current) {
      setDeadlineCapture((prev) => (prev.visible ? { ...prev, isListening: false } : prev));
      return;
    }
    if (timeFieldCaptureActiveRef.current) {
      setVoiceConfirm((prev) => (prev ? { ...prev, isTimeListening: false } : prev));
      return;
    }
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
      timeFieldCaptureActiveRef.current = false;
      if (debounceLiveTextTimerRef.current) {
        clearTimeout(debounceLiveTextTimerRef.current);
        debounceLiveTextTimerRef.current = null;
      }
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
      flushLiveTranscriptNow();
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
  }, [clearProjectAudioFile, flushLiveTranscriptNow, t]);

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
      flushLiveTranscriptNow();
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
          dueDateYmd: null,
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
      const scheduleDueYmd = orchestration.schedule ? formatYmdLocal(orchestration.schedule) : null;
      const detectedTimeLabel =
        draft.timeMarker || buildTimeLabelFromDate(orchestration.schedule, i18n.language);
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
        editedTime: detectedTimeLabel,
        dueDateYmd: scheduleDueYmd,
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
  }, [emitTalkDebug, flushLiveTranscriptNow, i18n.language, t]);

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
        dueDateYmd: computeDueDateFromWhenText(timing, i18n.language),
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

  const startUniversalCapture = useCallback(() => {
    if (Platform.OS === 'web' || voiceConfirm || projectRefine || isBusy || isPostCaptureAnalyzing) return;
    if (voiceActiveRef.current || avRecordingRef.current || projectAudioRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsCapturePaused(false);
    stopAfterStartRef.current = false;
    transitionUiMode('RECORDING');
    if (currentTarget === 'PROJECT') {
      projectGestureHoldingRef.current = true;
      setMicroToast('Mode PROJET · transcription en direct');
      void startProjectHoldCapture();
      return;
    }
    captureChannelRef.current = currentTarget === 'NOTE' ? 'quick_note' : 'intention';
    setMicroToast(currentTarget === 'NOTE' ? 'Mode NOTE · capture brute' : 'Mode TACHE · tri local');
    void startQuickCapture();
  }, [
    currentTarget,
    isBusy,
    isPostCaptureAnalyzing,
    projectRefine,
    startProjectHoldCapture,
    startQuickCapture,
    transitionUiMode,
    voiceConfirm,
  ]);

  const stopUniversalCapture = useCallback(() => {
    setIsMicLocked(false);
    setIsCapturePaused(false);
    transitionUiMode('DECISION');
    projectGestureHoldingRef.current = false;
    if (voiceActiveRef.current && currentTarget === 'PROJECT') {
      void stopProjectHoldCapture();
      return;
    }
    if (voiceActiveRef.current) {
      void stopQuickCapture();
      return;
    }
    if (avRecordingRef.current) {
      void stopDeepCapture();
      return;
    }
    stopAfterStartRef.current = true;
  }, [currentTarget, stopDeepCapture, stopProjectHoldCapture, stopQuickCapture, transitionUiMode]);

  const cancelUniversalCapture = useCallback(async () => {
    setCancelSweepActive(true);
    cancelSweepAnim.setValue(0);
    await new Promise<void>((resolve) => {
      Animated.timing(cancelSweepAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => resolve());
    });
    setIsMicLocked(false);
    setIsCapturePaused(false);
    captureChannelRef.current = null;
    projectGestureHoldingRef.current = false;
    if (voiceActiveRef.current) {
      voiceActiveRef.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /* ignore */
      }
      const rec = projectAudioRef.current;
      projectAudioRef.current = null;
      if (rec) {
        try {
          await rec.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
      }
    }
    partialTranscriptRef.current = '';
    finalTranscriptRef.current = '';
    setLivePartial('');
    setIsProjectHoldActive(false);
    setIsRecording(false);
    setCaptureMode('idle');
    setIsBusy(false);
    setIsPostCaptureAnalyzing(false);
    transitionUiMode('IDLE');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setMicroToast('Capture annulee');
    setTimeout(() => setMicroToast(''), 1000);
    setCancelSweepActive(false);
    cancelSweepAnim.setValue(0);
  }, [cancelSweepAnim, transitionUiMode]);

  const togglePauseUniversalCapture = useCallback(async () => {
    if (!voiceActiveRef.current) return;
    if (!isCapturePaused) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        /* ignore */
      }
      if (currentTarget === 'PROJECT' && projectAudioRef.current) {
        try {
          await projectAudioRef.current.pauseAsync();
        } catch {
          /* ignore */
        }
      }
      setIsCapturePaused(true);
      return;
    }
    if (currentTarget === 'PROJECT') {
      if (projectAudioRef.current) {
        try {
          await projectAudioRef.current.startAsync();
        } catch {
          /* ignore */
        }
      }
      try {
        await ExpoSpeechRecognitionModule.start({
          lang: resolveSpeechLangForSession(i18n.language),
          interimResults: true,
          maxAlternatives: 1,
          continuous: true,
          requiresOnDeviceRecognition: false,
          addsPunctuation: true,
        });
      } catch {
        /* ignore */
      }
    } else {
      try {
        await ExpoSpeechRecognitionModule.start({
          lang: resolveSpeechLangForSession(i18n.language),
          interimResults: true,
          continuous: true,
          maxAlternatives: 1,
          iosTaskHint: 'dictation',
          iosVoiceProcessingEnabled: true,
        });
      } catch {
        /* ignore */
      }
    }
    voiceActiveRef.current = true;
    setIsCapturePaused(false);
  }, [currentTarget, i18n.language, isCapturePaused]);

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

  const stopDeadlineCapture = useCallback(async () => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /* ignore */
      }
    } finally {
      setDeadlineCapture((prev) => (prev.visible ? { ...prev, isListening: false } : prev));
    }
  }, []);

  const startDeadlineCapture = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      await ExpoSpeechRecognitionModule.start({
        lang: resolveSpeechLangForSession(i18n.language),
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
        addsPunctuation: true,
      });
      setDeadlineCapture((prev) => (prev.visible ? { ...prev, isListening: true } : prev));
    } catch {
      setDeadlineCapture((prev) => (prev.visible ? { ...prev, isListening: false } : prev));
    }
  }, [i18n.language]);

  const submitProjectGenerationWithDeadline = useCallback(
    async (deadlineText: string) => {
      if (!projectRefine) return;
      const baseText = deadlineCapture.baseText.trim() || projectRefine.editedText.trim();
      const cleanedDeadline = deadlineText.trim();
      if (!baseText || !cleanedDeadline) return;
      if (remainingIntents <= 0) {
        if (adFreeActive) {
          promptIaRechargeModal();
        } else {
          Alert.alert(t('talkHome.deepNoCreditsTitle'), t('talkHome.deepNoCreditsBody'));
        }
        return;
      }
      await stopDeadlineCapture();
      setProjectRefine((prev) => (prev ? { ...prev, isGeneratingPlan: true } : prev));
      setDeadlineCapture((prev) => ({ ...prev, visible: false, isListening: false }));
      setIsBusy(true);
      try {
        const consolidatedPrompt = `Voici mon projet : ${baseText}. Je veux le terminer ${cleanedDeadline}. Genere un plan de taches structure en JSON.`;
        const expertRows = await atomizeProject(consolidatedPrompt);
        const taskCount = expertRows.filter((row) => row.type === 'TASK').length;
        const projectTitle =
          expertRows.find((row) => row.type === 'PROJECT')?.title?.trim() || baseText.slice(0, 80);
        const selectedTaskIndexes = Array.from({ length: taskCount }, (_, i) => i);
        let taskIdx = -1;
        const taskAlarmIndexes = expertRows
          .map((row) => {
            if (row.type !== 'TASK') return -1;
            taskIdx += 1;
            return Boolean((row.metadata as { suggest_alarm?: unknown })?.suggest_alarm)
              ? taskIdx
              : -1;
          })
          .filter((idx) => idx >= 0);
        setProjectPlanPreview({
          projectTitle,
          rawInput: `${baseText}\nDeadline: ${cleanedDeadline}`,
          rows: expertRows,
          selectedTaskIndexes,
          taskAlarmIndexes,
        });
        setMicroToast(taskCount > 0 ? 'Plan IA pret a visualiser' : 'Aucune etape detectee');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('PLAN_JSON_PARSE_ERROR')) {
          setDeadlineCapture((prev) => ({
            ...prev,
            visible: true,
            capturedText: cleanedDeadline,
            isListening: false,
            lastError: 'Erreur de lecture du plan. Reessayer ?',
          }));
        } else {
          Alert.alert(t('talkHome.voicePersistErrorTitle'), msg || t('talkHome.voicePersistErrorBody'));
        }
      } finally {
        setProjectRefine((prev) => (prev ? { ...prev, isGeneratingPlan: false } : prev));
        setIsBusy(false);
      }
    },
    [deadlineCapture.baseText, projectRefine, remainingIntents, stopDeadlineCapture, t],
  );

  const openDeadlineCapture = useCallback(async () => {
    if (!projectRefine) return;
    const text = projectRefine.editedText.trim();
    if (!text) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    setDeadlineCapture({
      visible: true,
      baseText: text,
      capturedText: '',
      isListening: false,
      lastError: '',
    });
    setMicroToast("Capture de deadline active");
  }, [projectRefine, t]);

  const closeDeadlineCapture = useCallback(async () => {
    await stopDeadlineCapture();
    setDeadlineCapture((prev) => ({ ...prev, visible: false, capturedText: '', isListening: false, lastError: '' }));
    setMicroToast('');
  }, [stopDeadlineCapture]);

  const onProjectGeneratePlan = useCallback(async () => {
    await openDeadlineCapture();
  }, [openDeadlineCapture]);

  useEffect(() => {
    if (!deadlineCapture.visible || Platform.OS === 'web') return;
    void startDeadlineCapture();
    return () => {
      void stopDeadlineCapture();
    };
  }, [deadlineCapture.visible, startDeadlineCapture, stopDeadlineCapture]);

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

  const togglePlanTaskSelected = useCallback((taskIndex: number) => {
    setProjectPlanPreview((prev) => {
      if (!prev) return prev;
      const has = prev.selectedTaskIndexes.includes(taskIndex);
      return {
        ...prev,
        selectedTaskIndexes: has
          ? prev.selectedTaskIndexes.filter((idx) => idx !== taskIndex)
          : [...prev.selectedTaskIndexes, taskIndex],
      };
    });
  }, []);

  const onExportProjectPlanIcs = useCallback(async () => {
    if (!projectPlanPreview) return;
    const taskRows = projectPlanPreview.rows.filter((row) => row.type === 'TASK');
    const selectedRows = taskRows.filter((_, idx) =>
      projectPlanPreview.selectedTaskIndexes.includes(idx),
    );
    if (!selectedRows.length) {
      Alert.alert('Aucune tâche cochée', 'Coche au moins une tâche avant export agenda.');
      return;
    }
    const now = new Date();
    const nowUtcStamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TellYouTo//ProjectPlan//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    selectedRows.forEach((row, idx) => {
      const due = String((row.metadata as { due_date?: unknown })?.due_date || '').trim();
      const date = /^\d{8}$/.test(due)
        ? due
        : `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${Date.now()}-${idx}@tellyouto`);
      lines.push(`DTSTAMP:${nowUtcStamp}`);
      lines.push(`DTSTART;VALUE=DATE:${date}`);
      lines.push(`SUMMARY:${row.title.replace(/\r?\n/g, ' ').slice(0, 180)}`);
      lines.push(`DESCRIPTION:Projet ${projectPlanPreview.projectTitle}`.slice(0, 240));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const ics = `${lines.join('\r\n')}\r\n`;
    const path = `${FileSystem.cacheDirectory}tellyouto-project-plan.ics`;
    await FileSystem.writeAsStringAsync(path, ics, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    await Share.open({
      url: path,
      type: 'text/calendar',
      failOnCancel: false,
      filename: 'tellyouto-project-plan',
    });
  }, [projectPlanPreview]);

  const onValidateProjectPlan = useCallback(async () => {
    if (!projectPlanPreview) return;
    if (remainingIntents <= 0) {
      if (adFreeActive) {
        promptIaRechargeModal();
      } else {
        Alert.alert(t('talkHome.deepNoCreditsTitle'), t('talkHome.deepNoCreditsBody'));
      }
      return;
    }
    setIsBusy(true);
    try {
      await resetLocalStreakOnExpert();
      await persistGeminiExpertRows(projectPlanPreview.rawInput, projectPlanPreview.rows, {
        taskAlarmIndexes: projectPlanPreview.taskAlarmIndexes,
        selectedTaskIndexes: projectPlanPreview.selectedTaskIndexes,
      });
      const expertPoints = growthPointsFromExpertRows(projectPlanPreview.rows);
      if (expertPoints > 0) {
        const next = projectPlanPreview.rows.some((r) => r.type === 'PROJECT')
          ? (await awardZenForAction('PROJECT_VALIDATION')).stats
          : (await awardZenForAction('TASK_VALIDATION')).stats;
        setGrowthScore(next.zen_points);
        setFlowerPulseKey((k) => k + 1);
        setFlowerNeedsAttention(false);
      }
      const afterConsume = await consumeTrankilV2IntentCredit();
      setRemainingIntents(afterConsume.ia_credits);
      setProjectPlanPreview(null);
      await cancelProjectRefine();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRewardToast('Projet ancre et enregistre');
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
    timeFieldCaptureActiveRef.current = false;
    const trimmedTitle = voiceConfirm.editedTitle.trim();
    if (!trimmedTitle) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    const desc = voiceConfirm.editedTime.trim();
    const resolvedDueDate =
      computeDueDateFromWhenText(desc, i18n.language) ?? voiceConfirm.dueDateYmd ?? null;
    const rawTranscript = voiceConfirm.rawTranscript.trim();
    const routeDecision = voiceConfirm.routeDecision;
    console.log('[QuickTaskFlow] decision.start', {
      routeDecision,
      localType: voiceConfirm.localType,
      title: trimmedTitle,
      editedTime: desc,
      resolvedDueDate,
    });
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
        if (remainingIntents <= 0) {
          if (adFreeActive) {
            promptIaRechargeModal();
          } else {
            Alert.alert(t('talkHome.deepNoCreditsTitle'), t('talkHome.deepNoCreditsBody'));
          }
          return;
        }
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
            const next = expertRows.some((r) => r.type === 'PROJECT')
              ? (await awardZenForAction('PROJECT_VALIDATION')).stats
              : (await awardZenForAction('TASK_VALIDATION')).stats;
            setGrowthScore(next.zen_points);
            setFlowerPulseKey((k) => k + 1);
            setFlowerNeedsAttention(false);
          }
        }
        const afterConsume = await consumeTrankilV2IntentCredit();
        setRemainingIntents(afterConsume.ia_credits);
      } else {
        const floatingCategory = 'sans_pression';
        const nextCategory =
          resolvedDueDate
            ? (voiceConfirm.suggestedTags[0] ?? STRINGS.TAG_KEYS.A_TRIER).toLowerCase()
            : floatingCategory;
        const hasAlarm = Boolean(resolvedDueDate);
        console.log('[QuickTaskFlow] sqlite.insert.payload', {
          title: trimmedTitle,
          type: voiceConfirm.localType,
          due_date: resolvedDueDate,
          has_alarm: hasAlarm,
          category_id: nextCategory,
        });
        await insertTrankilV2Intention({
          id: newTalkEntityId(),
          type:
            voiceConfirm.localType === 'NOTE'
              ? 'NOTE'
              : mapVoiceKindToIntentType(localTypeToVoiceKind(voiceConfirm.localType)),
          title: trimmedTitle,
          due_date: resolvedDueDate,
          content_raw: rawTranscript,
          metadata_json: JSON.stringify(
            {
              timeMarker: desc,
              source: 'orchestrator_local',
              has_alarm: hasAlarm,
              due_date: resolvedDueDate,
            },
            null,
            2,
          ),
          suggested_tags: JSON.stringify(
            resolvedDueDate && voiceConfirm.suggestedTags.length
              ? voiceConfirm.suggestedTags
              : [floatingCategory],
          ),
          category_id: nextCategory,
          parent_id: null,
          status: 'TODO',
          is_organized: 0,
          is_local_processed: 1,
          complexity_level: 1,
          created_at: Date.now(),
        });
        console.log('[QuickTaskFlow] sqlite.insert.success', {
          title: trimmedTitle,
          due_date: resolvedDueDate,
          category_id: nextCategory,
        });
        const localPoints =
          voiceConfirm.localType === 'HABIT'
            ? growthPointsForType('HABIT')
            : voiceConfirm.localType === 'TASK'
              ? growthPointsForType('TASK')
              : 0;
        if (localPoints > 0) {
          const next = await awardZenForAction('TASK_VALIDATION');
          setGrowthScore(next.stats.zen_points);
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
    i18n.language,
    voiceConfirm,
    t,
    resetVoiceConfirm,
  ]);

  const onDictateWhenField = useCallback(async () => {
    if (!voiceConfirm || voiceConfirm.captureChannel !== 'intention') return;
    if (Platform.OS === 'web') return;
    try {
      timeFieldCaptureActiveRef.current = true;
      setVoiceConfirm((prev) => (prev ? { ...prev, isTimeListening: true } : prev));
      await ExpoSpeechRecognitionModule.start({
        lang: resolveSpeechLangForSession(i18n.language),
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
        addsPunctuation: true,
      });
    } catch {
      timeFieldCaptureActiveRef.current = false;
      setVoiceConfirm((prev) => (prev ? { ...prev, isTimeListening: false } : prev));
    }
  }, [i18n.language, voiceConfirm]);

  const intentTypeLabel = (k: VoiceIntentKind) =>
    t(`talkHome.intentType.${k}` as const);

  const renderPingCard = () => null;

  /** Quick : texte ASR partiel/final. Deep : consigne mains libres (pas de preview .m4a). */
  const renderLiveSpeechCard = () => {
    if (isProjectHoldActive || isRecording || isMicLocked) {
      const line = livePartial.trim()
        ? livePartial.trim()
        : t('talkHome.voiceLivePlaceholder');
      const tokens = line.split(/\s+/).filter(Boolean);
      const trailing = tokens.slice(-4).join(' ');
      return (
        <Animated.View
          style={[
            styles.titleHeroWrap,
            cancelSweepActive
              ? {
                  transform: [{ translateX: cancelSweepAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -180] }) }],
                  opacity: cancelSweepAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                }
              : null,
          ]}
        >
          {isMicLocked ? (
            <View style={styles.liveLockBadge}>
              <Lock size={13} color="#e8f6f6" />
              <Text style={styles.liveLockBadgeText}>LOCK</Text>
            </View>
          ) : null}
          <View style={styles.waveformRow}>
            {waveBars.map((h, idx) => (
              <View
                key={`wave-${idx}`}
                style={[
                  styles.waveformBar,
                  {
                    height: h,
                    opacity: 0.35 + (idx % 2 ? 0.25 : 0.4),
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.liveTextMaskWrap}>
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(9,13,20,0.96)', 'rgba(9,13,20,0)']}
              style={[styles.liveTextGradientMask, styles.liveTextGradientTop]}
            />
            <Text style={styles.projectLiveTextMuted}>{line}</Text>
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(9,13,20,0)', 'rgba(9,13,20,0.96)']}
              style={[styles.liveTextGradientMask, styles.liveTextGradientBottom]}
            />
          </View>
          {trailing ? <Text style={styles.projectLiveTextTail}>{trailing}</Text> : null}
        </Animated.View>
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
        <Text style={styles.confirmScenarioLine}>
          {projectRefine.isGeneratingPlan ? 'Analyse Gemini...' : 'Phase decision — choisis une action en bas.'}
        </Text>
      </>
    );
  };

  const micA11yLabel = useMemo(() => {
    if (isRecording) return t('talkHome.orbital.holdRelease');
    if (currentTarget === 'PROJECT') return t('talkHome.a11yTalkieProjet');
    if (currentTarget === 'NOTE') return t('talkHome.a11yTalkieQuickNote');
    return t('talkHome.a11yMicQuick');
  }, [currentTarget, isRecording, t]);

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
    const resolvedDueYmd =
      computeDueDateFromWhenText(editedTime, i18n.language) ?? voiceConfirm.dueDateYmd ?? null;
    const horizonKey = computeTimeHorizonFromDueDate(resolvedDueYmd);
    const horizonMeta = TIME_HORIZON_META[horizonKey];
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
          <View style={styles.whenHeaderRow}>
            <Text style={styles.confirmBlockLabel}>
              {voiceConfirm.localType === 'HABIT' ? t('talkHome.frequencyLabel') : t('talkHome.whenLabel')}
            </Text>
            <View style={styles.whenBadge}>
              <Text style={styles.whenBadgeText}>
                {horizonMeta.emoji} {t(horizonMeta.labelKey)}
              </Text>
            </View>
          </View>
          {isEditing ? (
            <View style={styles.whenInputRow}>
              <TextInput
                value={editedTime}
                onChangeText={(v) => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setVoiceConfirm((prev) =>
                    prev
                      ? {
                          ...prev,
                          editedTime: v,
                          dueDateYmd:
                            computeDueDateFromWhenText(v, i18n.language) ?? prev.dueDateYmd ?? null,
                        }
                      : prev,
                  );
                }}
                style={styles.editTimeInput}
                placeholder={
                  voiceConfirm.localType === 'HABIT'
                    ? t('talkHome.habitFrequencyPlaceholder')
                    : t('talkHome.whenPlaceholder')
                }
                placeholderTextColor="rgba(44,62,80,0.45)"
              />
              <Pressable
                onPress={() => {
                  void onDictateWhenField();
                }}
                style={styles.whenMicBtn}
                disabled={voiceConfirm.isTimeListening}
              >
                <Mic size={16} color="#2C3E50" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.timeValueWrap}>
              <Text style={styles.timeValue}>
                {timeDisplay || t('horizons.optionalNoPressure')}
              </Text>
            </View>
          )}
          {voiceConfirm.localType === 'HABIT' && isEditing ? (
            <View style={styles.freqRow}>
              {[t('talkHome.frequencyDaily'), t('talkHome.frequencyWeek'), t('talkHome.frequencyWeekend')].map((preset) => (
                <Pressable
                  key={preset}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setVoiceConfirm((prev) => (prev ? { ...prev, editedTime: preset, dueDateYmd: null } : prev));
                  }}
                  style={styles.freqPreset}
                >
                  <Text style={styles.freqPresetText}>{preset}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
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
      {adFreeActive ? <Text style={styles.zenModeBadge}>Mode Zen Actif</Text> : null}

      {dailyQuest ? (
        <View style={styles.questCard}>
          <Text style={styles.questTitle}>Quete du Jour - {dailyQuest.title}</Text>
          <Text style={styles.questDesc}>{dailyQuest.description}</Text>
          <Text style={styles.questProgress}>
            Progression: {Math.min(dailyQuestProgress, dailyQuestTarget)}/{dailyQuestTarget}
          </Text>
          {dailyQuestClaimed ? (
            <Text style={styles.questClaimed}>Bonus deja reclame</Text>
          ) : (
            <Pressable
              onPress={() => {
                void onClaimDailyQuest();
              }}
              disabled={!dailyQuestCanClaim || isBusy}
              style={[
                styles.questClaimBtn,
                !dailyQuestCanClaim || isBusy ? styles.questClaimBtnDisabled : null,
              ]}
            >
              <Text style={styles.questClaimText}>Reclamer mon bonus</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      <View style={styles.bodySpacer} />

      <View
        style={[styles.bottomHud, { bottom: insets.bottom + 132 }]}
        pointerEvents="none"
      >
        <BottomStatus microToast={microToast} />
      </View>

      <MainInterface
        uiMode={uiMode}
        currentTarget={currentTarget}
        onSelectTarget={setCurrentTarget}
        bottomInset={insets.bottom}
        micDisabled={!(!isBusy && !isPostCaptureAnalyzing && voiceConfirm === null && projectRefine === null)}
        onMicStartPress={startUniversalCapture}
        onCaptureCancel={() => {
          void cancelUniversalCapture();
        }}
        onCapturePauseToggle={() => {
          void togglePauseUniversalCapture();
        }}
        onCaptureSend={stopUniversalCapture}
        isCapturePaused={isCapturePaused}
        showDecisionActions={Boolean(projectRefine)}
        decisionDisabled={isBusy || (projectRefine?.isGeneratingPlan ?? false)}
        onDecisionCancel={() => {
          void cancelProjectRefine();
        }}
        onDecisionSaveNote={() => {
          void onProjectSaveAsNote();
        }}
        onDecisionSaveAudio={() => {
          void onProjectSaveAsAudio();
        }}
        onDecisionGenerate={() => {
          void onProjectGeneratePlan();
        }}
        centerContent={
          uiMode === 'IDLE' ? null : (
            <Animated.View
              style={[
                styles.semanticModalZone,
                {
                  opacity: centerFade,
                  transform: [
                    {
                      scale: centerFade.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.97, 1],
                      }),
                    },
                  ],
                },
              ]}
              pointerEvents="box-none"
            >
              <LinearGradient
                colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.02)']}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={[
                  styles.pingCard,
                  uiMode === 'DECISION' ? styles.pingCardDecision : null,
                ]}
              >
                {projectRefine
                  ? renderProjectRefineCard()
                  : voiceConfirm
                    ? renderConfirmCard()
                    : isPostCaptureAnalyzing
                    ? renderAnalyzingCard()
                    : isRecording || isMicLocked
                      ? renderLiveSpeechCard()
                      : renderPingCard()}
              </LinearGradient>
            </Animated.View>
          )
        }
      />

      <Modal
        visible={deadlineCapture.visible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          void closeDeadlineCapture();
        }}
      >
        <View style={styles.deadlineBackdrop}>
          <View style={styles.deadlineCard}>
            <Text style={styles.deadlineTitle}>C&apos;est pour quand ?</Text>
            <Text style={styles.deadlineSubtitle}>
              Ajoute une contrainte temporelle pour fiabiliser le plan.
            </Text>
            {deadlineCapture.lastError ? (
              <View style={styles.deadlineErrorBox}>
                <Text style={styles.deadlineErrorText}>{deadlineCapture.lastError}</Text>
                <Pressable
                  style={styles.deadlineRetryBtn}
                  onPress={() => {
                    void submitProjectGenerationWithDeadline(deadlineCapture.capturedText);
                  }}
                  disabled={isBusy || !deadlineCapture.capturedText.trim()}
                >
                  <Text style={styles.deadlineRetryText}>Reessayer</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.deadlineQuickRow}>
              {['Demain', '1 semaine', '1 mois'].map((choice) => (
                <Pressable
                  key={choice}
                  style={styles.deadlineQuickBtn}
                  onPress={() => {
                    void submitProjectGenerationWithDeadline(choice);
                  }}
                  disabled={isBusy}
                >
                  <Text style={styles.deadlineQuickText}>{choice}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[
                styles.deadlineMicBtn,
                deadlineCapture.isListening ? styles.deadlineMicBtnActive : null,
              ]}
              onPress={() => {
                if (deadlineCapture.isListening) {
                  void stopDeadlineCapture();
                } else {
                  void startDeadlineCapture();
                }
              }}
              disabled={isBusy}
            >
              <Text style={styles.deadlineMicText}>
                {deadlineCapture.isListening ? '🎙️ Ecoute...' : '🎙️ Activer micro'}
              </Text>
            </Pressable>

            <TextInput
              value={deadlineCapture.capturedText}
              onChangeText={(v) => {
                setDeadlineCapture((prev) => ({ ...prev, capturedText: v }));
              }}
              placeholder="Ex: dans 2 mois, pour samedi, fin d'annee"
              placeholderTextColor="rgba(44,62,80,0.45)"
              style={styles.deadlineInput}
            />

            <View style={styles.deadlineActions}>
              <Pressable
                style={[styles.deadlineActionBtn, styles.deadlineCancelBtn]}
                onPress={() => {
                  void closeDeadlineCapture();
                }}
                disabled={isBusy}
              >
                <Text style={styles.deadlineCancelText}>❌ ANNULER</Text>
              </Pressable>
              <Pressable
                style={[styles.deadlineActionBtn, styles.deadlineConfirmBtn]}
                onPress={() => {
                  void submitProjectGenerationWithDeadline(deadlineCapture.capturedText);
                }}
                disabled={isBusy || !deadlineCapture.capturedText.trim()}
              >
                <Text style={styles.deadlineConfirmText}>✅ GENERER LE PLAN</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
                    const selected = (projectPlanPreview?.selectedTaskIndexes ?? []).includes(taskIdx);
                    const enabled = (projectPlanPreview?.taskAlarmIndexes ?? []).includes(taskIdx);
                    const dueDate = String((row.metadata as { due_date?: unknown })?.due_date || '').trim();
                    return (
                      <View key={`${row.title}-${taskIdx}`} style={styles.planTaskRow}>
                        <Pressable
                          style={styles.planCheckBtn}
                          onPress={() => togglePlanTaskSelected(taskIdx)}
                        >
                          <Check size={16} color={selected ? '#008080' : 'rgba(44,62,80,0.35)'} />
                        </Pressable>
                        <Pressable style={styles.planBellBtn} onPress={() => togglePlanTaskAlarm(taskIdx)}>
                          <Bell size={20} color={enabled ? '#FF8C00' : 'rgba(44,62,80,0.35)'} />
                        </Pressable>
                        <View style={styles.planTaskMain}>
                          <Text style={[styles.planTaskText, !selected ? styles.planTaskTextMuted : null]}>
                            {row.title}
                          </Text>
                          <Text style={styles.planTaskDate}>{formatDueDateShort(dueDate)}</Text>
                        </View>
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
                style={[styles.planActionBtn, styles.planExportBtn]}
                onPress={() => {
                  void onExportProjectPlanIcs();
                }}
                disabled={isBusy}
              >
                <Text style={styles.planExportText}>📅 EXPORTER VERS AGENDA</Text>
              </Pressable>
              <Pressable
                style={[styles.planActionBtn, styles.planValidateBtn]}
                onPress={() => {
                  void onValidateProjectPlan();
                }}
                disabled={isBusy}
              >
                <Text style={styles.planValidateText}>✅ ANCRER LE PROJET</Text>
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
    backgroundColor: '#0f1722',
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
  zenModeBadge: {
    marginTop: 4,
    alignSelf: 'flex-end',
    fontSize: 11,
    fontWeight: '700',
    color: '#0f766e',
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.28)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bodySpacer: {
    flex: 1,
  },
  questCard: {
    marginTop: 8,
    marginHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.2)',
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 12,
  },
  questTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2d6f70',
  },
  questDesc: {
    marginTop: 4,
    fontSize: 12,
    color: '#334155',
  },
  questProgress: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  questClaimBtn: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#008080',
    paddingVertical: 8,
    alignItems: 'center',
  },
  questClaimBtnDisabled: {
    opacity: 0.5,
  },
  questClaimText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 12,
  },
  questClaimed: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f766e',
  },
  conceptBar: {
    position: 'absolute',
    top: 106,
    left: 22,
    right: 22,
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(168,179,197,0.28)',
    backgroundColor: '#2a313d',
    zIndex: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 6,
  },
  conceptBtn: {
    flex: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(54,63,79,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(17,22,31,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  conceptBtnActive: {
    backgroundColor: 'rgba(40,57,52,0.95)',
    borderColor: 'rgba(60, 234, 159, 0.45)',
    shadowColor: '#3CEA9F',
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    elevation: 4,
  },
  conceptBtnText: {
    color: '#d7dbe1',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  conceptBtnTextActive: {
    color: '#eafff4',
  },
  conceptBtnSub: {
    marginTop: 2,
    color: 'rgba(197,204,216,0.82)',
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
  },
  conceptBtnSubActive: {
    color: 'rgba(216,255,233,0.86)',
  },
  bottomHud: {
    position: 'absolute',
    left: 22,
    right: 22,
    alignItems: 'center',
    zIndex: 11,
  },
  universalMicDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 24,
    alignItems: 'center',
  },
  universalMicWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  universalMicBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9, 225, 238, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(124, 247, 252, 0.45)',
    shadowColor: '#08d9e5',
    shadowOpacity: 0.42,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 16,
    elevation: 10,
  },
  universalMicBtnLocked: {
    backgroundColor: 'rgba(7, 208, 224, 0.28)',
    borderColor: 'rgba(173, 252, 255, 0.72)',
  },
  universalMicIcon: {
    fontSize: 36,
  },
  universalHintWrap: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  universalMicHint: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(214,221,232,0.85)',
    letterSpacing: 0.6,
  },
  microLockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(26, 206, 221, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(145, 244, 255, 0.35)',
  },
  microLockPillText: {
    color: '#b8fbff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
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
    zIndex: 9,
    elevation: 10,
  },
  pingCard: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(28,37,50,0.24)',
    borderWidth: 1,
    borderColor: 'rgba(193,205,226,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 12,
  },
  pingCardDecision: {
    minHeight: '100%',
    transform: [{ scale: 1.02 }],
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
  whenHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  whenBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(0, 128, 128, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  whenBadgeText: {
    color: '#14545c',
    fontSize: 11,
    fontWeight: '700',
  },
  whenInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    flex: 1,
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
  whenMicBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.25)',
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  freqRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  freqPreset: {
    borderWidth: 1,
    borderColor: 'rgba(0,128,128,0.32)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,128,128,0.08)',
  },
  freqPresetText: {
    color: '#14545c',
    fontSize: 12,
    fontWeight: '700',
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
    color: '#BDC3C7',
    fontSize: 24,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 34,
    letterSpacing: 0.3,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  },
  liveTextMaskWrap: {
    width: '100%',
    minHeight: 96,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  liveTextGradientMask: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 20,
    zIndex: 2,
  },
  liveTextGradientTop: {
    top: 0,
  },
  liveTextGradientBottom: {
    bottom: 0,
  },
  projectLiveTextTail: {
    marginTop: 4,
    color: 'rgba(189,195,199,0.45)',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  liveLockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: 'rgba(0,128,128,0.72)',
  },
  liveLockBadgeText: {
    color: '#e8f6f6',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  waveformRow: {
    marginBottom: 12,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  waveformBar: {
    width: 5,
    borderRadius: 3,
    backgroundColor: '#39e6f2',
    shadowColor: '#17d8e5',
    shadowOpacity: 0.32,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 4,
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
  deadlineBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 13, 18, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  deadlineCard: {
    borderRadius: 18,
    backgroundColor: '#F5F5F0',
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  deadlineTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#2C3E50',
    textAlign: 'center',
  },
  deadlineSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(44,62,80,0.72)',
    textAlign: 'center',
  },
  deadlineErrorBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,140,0,0.35)',
    backgroundColor: 'rgba(255,140,0,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  deadlineErrorText: {
    color: '#7a4d00',
    fontSize: 13,
    fontWeight: '700',
  },
  deadlineRetryBtn: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,128,128,0.4)',
    backgroundColor: 'rgba(0,128,128,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deadlineRetryText: {
    color: '#2C3E50',
    fontWeight: '800',
    fontSize: 12,
  },
  deadlineQuickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  deadlineQuickBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,128,128,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,128,128,0.2)',
  },
  deadlineQuickText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2C3E50',
  },
  deadlineMicBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.16)',
    backgroundColor: 'rgba(44,62,80,0.05)',
  },
  deadlineMicBtnActive: {
    backgroundColor: 'rgba(255,140,0,0.14)',
    borderColor: 'rgba(255,140,0,0.42)',
  },
  deadlineMicText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2C3E50',
  },
  deadlineInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.16)',
    backgroundColor: 'rgba(255,255,255,0.82)',
    color: '#2C3E50',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deadlineActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  deadlineActionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deadlineCancelBtn: {
    backgroundColor: 'rgba(247,247,247,0.92)',
    borderColor: 'rgba(44,62,80,0.18)',
  },
  deadlineConfirmBtn: {
    backgroundColor: 'rgba(0,128,128,0.88)',
    borderColor: 'rgba(181,237,229,0.45)',
  },
  deadlineCancelText: {
    color: '#2C3E50',
    fontSize: 13,
    fontWeight: '700',
  },
  deadlineConfirmText: {
    color: '#F6FFFD',
    fontSize: 13,
    fontWeight: '800',
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
  planCheckBtn: {
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 2,
  },
  planBellBtn: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 2,
  },
  planTaskMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  planTaskText: {
    flex: 1,
    fontSize: 14,
    color: '#2C3E50',
    lineHeight: 20,
    fontWeight: '600',
  },
  planTaskTextMuted: {
    opacity: 0.5,
    textDecorationLine: 'line-through',
  },
  planTaskDate: {
    fontSize: 12,
    fontWeight: '700',
    color: '#516a78',
    minWidth: 54,
    textAlign: 'right',
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
  planExportBtn: {
    backgroundColor: 'rgba(255, 140, 0, 0.2)',
    borderColor: 'rgba(255, 140, 0, 0.45)',
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
  planExportText: {
    color: '#6b4200',
    fontWeight: '800',
    fontSize: 12,
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
