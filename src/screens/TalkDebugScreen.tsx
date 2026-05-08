import { randomUUID } from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as chrono from 'chrono-node';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Dimensions,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Bell, Check, Lock } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import {
  consumeFreeCaptureSuccessOnce,
  countTrankilV2RootTodoTasksDueOnLocalDate,
  deleteTrankilV2IntentionById,
  getFreeCaptureQuotaSnapshot,
  getTrankilV2IntentionById,
  getTrankilV2UnorganizedCount,
  insertTrankilV2Intention,
  patchMetadata,
  updateTrankilV2IntentionPendingAiFlag,
} from '../api/trankilV2Db';
import {
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTION_PEEK_SNAPSHOT_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import { mapTrankilIntentionToTimelineItemRow, type TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { TALK_CAPTURE_DEBUG_EVENT, type TalkCaptureDebugPayload } from '../constants/talkCaptureDebug';
import { IntentionSuggestionsBanner } from '../components/IntentionSuggestionsBanner';
import { PassProModal } from '../components/PassProModal';
import { TalkCaptureMicButton } from '../components/TalkCaptureMicButton';
import { IntentionDetailSheet } from '../components/IntentionDetailSheet';
import { PilotStatusHeader } from '../components/PilotStatusHeader';
import type { GeminiExpertIntention } from '../services/GeminiExpert';
import {
  exportProjectPlanToIcs,
  formatDueDateShort,
} from '../services/ProjectPlanFlowService';
import { cleanTranscriptText, generateSmartTitle, shouldLockSmartTitle } from '../services/smartTitle';
import { formatYmdLocal } from '../services/TimeSorter';
import { resolveSpeechLangForSession } from '../utils/speechLocale';
import {
  getDefaultCalendarId,
  setDefaultCalendarId,
} from '../services/calendarMirrorSync';
import { getAutoArchiveAfterCalendarSync } from '../services/premiumBridgeSettings';
import { logActivity } from '../services/UserActivityService';
import type { AppTabParamList } from '../navigation/types';
import { showAppToast } from '../services/appToast';
import { applyOfflineFirstShellFailure } from '../services/captureOfflineFirstUtils';
import {
  applyPostCaptureEffects,
  buildFinalTranscriptForCapture,
  buildTemporalCaptureRecap,
  executeAudioMemoCapture,
  executeHabitCapture,
  executeListInventoryCapture,
  executeQuickNoteCapture,
  executeTaskCapture,
  generateProjectPlanFromDeadline,
  handleCaptureFlowError,
  persistValidatedProjectPlan,
  type CaptureStrategyDeps,
  type PostCaptureEffectsConfig,
} from '../services/captureStrategies';
import {
  inferOneTapSkeletonFromTranscript,
  logOneTapCaptureCycleStartBanner,
  ONE_TAP_DEBUG_LOG_CONT,
  type OneTapUniversalResult,
} from '../services/oneTapUniversalCapture';
import { hydrateOneTapDraftWithFavoriteAlias } from '../services/traffic/locationFavorites';
import {
  persistOneTapDraft,
} from '../services/oneTapPersist';
import { useOptionalIntentionContext } from '../context/IntentionContext';
import { activateSentinelTrip } from '../services/traffic/sentinelActivation';
import { consumeSentinelQuotaOnTripValidation } from '../services/QuotaManager';
import { rootNavigationRef } from '../navigation/rootNavigationRef';

function newId(): string {
  try {
    return randomUUID();
  } catch {
    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

type WritableDeviceCalendar = {
  id: string;
  title: string;
  color: string;
};

function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function normalizeCategoryId(raw: unknown): string {
  const up = String(raw ?? '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) return up;
  return 'PERSO';
}

const LAST_CALENDAR_STORAGE_KEY = '@tellyouto/talk_debug_last_calendar_id';
const CALENDAR_SYNC_PREFS_KEY = '@tellyouto/talk_debug_calendar_sync_prefs';
const ALARM_SYNC_PREFS_KEY = '@tellyouto/talk_debug_alarm_sync_prefs';

export function TalkDebugScreen() {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const intentionFlow = useOptionalIntentionContext();
  const [passProVisible, setPassProVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const windowH = Dimensions.get('window').height;
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<TrankilV2TimelineItemRow | null>(null);
  const [detailPosition, setDetailPosition] = useState<'peek' | 'full'>('full');
  const [detailPeekHeightPx, setDetailPeekHeightPx] = useState(40);
  const peekSnapshotRef = useRef<{ categoryTag?: unknown; predictedType?: unknown; title?: unknown } | null>(null);
  const [phoenixInput, setPhoenixInput] = useState('');
  const [phoenixSubmitting, setPhoenixSubmitting] = useState(false);
  const [captureStep, setCaptureStep] = useState<'idle' | 'recording'>('idle');
  const [rawTranscript, setRawTranscript] = useState('');
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [lockedTitle, setLockedTitle] = useState('');
  const [isTitleLocked, setIsTitleLocked] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [hasManualTitleEdit, setHasManualTitleEdit] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [freeQuotaSnapshot, setFreeQuotaSnapshot] = useState<{ remaining: number; max: number } | null>(null);
  const [deadlineModalVisible, setDeadlineModalVisible] = useState(false);
  const [deadlineText, setDeadlineText] = useState('');
  const [deadlineError, setDeadlineError] = useState('');
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [autoArchiveAfterCalendarSync, setAutoArchiveAfterCalendarSync] = useState(false);
  const [calendarOptions, setCalendarOptions] = useState<WritableDeviceCalendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null);
  const [calendarPickerVisible, setCalendarPickerVisible] = useState(false);
  const [calendarPickerTarget, setCalendarPickerTarget] = useState<'task' | 'habit' | 'project' | null>(null);
  const [calendarSyncByType, setCalendarSyncByType] = useState<Record<'task' | 'habit' | 'project', boolean>>({
    task: false,
    habit: false,
    project: true,
  });
  const [alarmSyncByType, setAlarmSyncByType] = useState<Record<'task' | 'habit' | 'project', boolean>>({
    task: false,
    habit: false,
    project: false,
  });
  const [projectPlanPreview, setProjectPlanPreview] = useState<null | {
    projectTitle: string;
    rawInput: string;
    rows: GeminiExpertIntention[];
    selectedTaskIndexes: number[];
    taskAlarmIndexes: number[];
  }>(null);
  const projectShellIdRef = useRef<string | null>(null);
  const [todayTodoCount, setTodayTodoCount] = useState(0);
  const [headerUnorganizedCount, setHeaderUnorganizedCount] = useState(0);

  const refreshPilotHeader = useCallback(async () => {
    const ymd = formatYmdLocal(new Date());
    const [unorg, todayN, snap] = await Promise.all([
      getTrankilV2UnorganizedCount(),
      countTrankilV2RootTodoTasksDueOnLocalDate(ymd),
      spectrum.isProUser ? Promise.resolve(null) : getFreeCaptureQuotaSnapshot(),
    ]);
    setHeaderUnorganizedCount(unorg);
    setTodayTodoCount(todayN);
    if (snap) {
      setFreeQuotaSnapshot({ remaining: snap.remaining, max: snap.max });
    } else {
      setFreeQuotaSnapshot(null);
    }
  }, [spectrum.isProUser]);

  useFocusEffect(
    useCallback(() => {
      void refreshPilotHeader();
    }, [refreshPilotHeader]),
  );

  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => void refreshPilotHeader()),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [refreshPilotHeader]);

  const emitTalkDebug = useCallback((payload: TalkCaptureDebugPayload) => {
    DeviceEventEmitter.emit(TALK_CAPTURE_DEBUG_EVENT, payload);
  }, []);

  const maybeConsumeFreeCaptureSuccess = useCallback(async () => {
    if (spectrum.isProUser) return;
    await consumeFreeCaptureSuccessOnce();
    const snap = await getFreeCaptureQuotaSnapshot();
    setFreeQuotaSnapshot({ remaining: snap.remaining, max: snap.max });
  }, [spectrum.isProUser]);

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
      const parseWith = (mod: { parseDate?: (t: string, r: Date) => Date | null }) =>
        typeof mod?.parseDate === 'function' ? mod.parseDate(raw, ref) : null;
      let parsed: Date | null = null;
      if (locale.startsWith('fr')) parsed = parseWith(chrono.fr);
      else if (locale.startsWith('en')) parsed = parseWith(chrono.en);
      else if (locale.startsWith('de')) parsed = parseWith(chrono.de);
      else if (locale.startsWith('it')) parsed = parseWith(chrono.it);
      else if (locale.startsWith('es')) parsed = parseWith(chrono.es);
      else if (locale.startsWith('ja')) parsed = parseWith(chrono.ja);
      else if (locale.startsWith('zh')) parsed = parseWith(chrono.zh);
      else if (locale.startsWith('nl')) parsed = parseWith(chrono.nl);
      else if (locale.startsWith('sv')) parsed = parseWith(chrono.sv);
      else if (typeof (chrono as { parseDate?: (t: string, r: Date) => Date | null }).parseDate === 'function') {
        parsed = (chrono as { parseDate: (t: string, r: Date) => Date | null }).parseDate(raw, ref);
      } else {
        parsed = parseWith(chrono.en);
      }
      if (!parsed) return null;
      return formatYmdLocal(parsed);
    },
    [spectrum.locale],
  );

  const hardResetToIdle = useCallback(() => {
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

  const selectedCalendar = useMemo(
    () => calendarOptions.find((item) => item.id === selectedCalendarId) ?? null,
    [calendarOptions, selectedCalendarId],
  );

  const selectCalendar = useCallback(async (calendarId: string) => {
    setSelectedCalendarId(calendarId);
    await AsyncStorage.setItem(LAST_CALENDAR_STORAGE_KEY, calendarId);
    await setDefaultCalendarId(calendarId);
  }, []);

  const persistCalendarSyncPrefs = useCallback(
    async (next: Record<'task' | 'habit' | 'project', boolean>) => {
      setCalendarSyncByType(next);
      await AsyncStorage.setItem(CALENDAR_SYNC_PREFS_KEY, JSON.stringify(next));
    },
    [],
  );

  const ensureWritableCalendars = useCallback(async (): Promise<WritableDeviceCalendar[]> => {
    const permission = await Calendar.getCalendarPermissionsAsync();
    if (permission.status !== 'granted') {
      const req = await Calendar.requestCalendarPermissionsAsync();
      if (req.status !== 'granted') {
        setCalendarOptions([]);
        setSelectedCalendarId(null);
        return [];
      }
    }
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars
      .filter((item) => item.allowsModifications)
      .map((item) => ({
        id: item.id,
        title: item.title || t('timeline.untitled'),
        color: item.color || '#64748b',
      }));
    setCalendarOptions(writable);
    const remembered = (await AsyncStorage.getItem(LAST_CALENDAR_STORAGE_KEY)) || (await getDefaultCalendarId());
    const fallbackId = writable[0]?.id ?? null;
    const nextId = writable.some((item) => item.id === remembered) ? remembered : fallbackId;
    setSelectedCalendarId(nextId);
    return writable;
  }, [t]);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(CALENDAR_SYNC_PREFS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Record<'task' | 'habit' | 'project', boolean>>;
          setCalendarSyncByType({
            task: Boolean(parsed.task),
            habit: Boolean(parsed.habit),
            project: parsed.project === undefined ? true : Boolean(parsed.project),
          });
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const enabled = await getAutoArchiveAfterCalendarSync();
      setAutoArchiveAfterCalendarSync(enabled);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(ALARM_SYNC_PREFS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Record<'task' | 'habit' | 'project', boolean>>;
          setAlarmSyncByType({
            task: Boolean(parsed.task),
            habit: Boolean(parsed.habit),
            project: Boolean(parsed.project),
          });
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const toggleCalendarSyncFor = useCallback(
    (kind: 'task' | 'habit' | 'project') => {
      void (async () => {
        if (!spectrum.isProUser) {
          if (rootNavigationRef.isReady()) {
            rootNavigationRef.navigate('ProSubscription');
          }
          return;
        }
        const next = {
          ...calendarSyncByType,
          [kind]: !calendarSyncByType[kind],
        };
        await persistCalendarSyncPrefs(next);
        if (next[kind] && !selectedCalendarId) {
          const calendars = await ensureWritableCalendars();
          if (calendars.length > 1) {
            setCalendarPickerTarget(kind);
            setCalendarPickerVisible(true);
          } else if (calendars[0]?.id) {
            await selectCalendar(calendars[0].id);
          }
        }
      })();
    },
    [calendarSyncByType, ensureWritableCalendars, navigation, persistCalendarSyncPrefs, selectedCalendarId, selectCalendar, spectrum.isProUser],
  );

  const toggleAlarmSyncFor = useCallback(
    (kind: 'task' | 'habit' | 'project') => {
      void (async () => {
        if (!spectrum.isProUser) {
          if (rootNavigationRef.isReady()) {
            rootNavigationRef.navigate('ProSubscription');
          }
          return;
        }
        const next = { ...alarmSyncByType, [kind]: !alarmSyncByType[kind] };
        setAlarmSyncByType(next);
        await AsyncStorage.setItem(ALARM_SYNC_PREFS_KEY, JSON.stringify(next));
      })();
    },
    [alarmSyncByType, navigation, spectrum.isProUser],
  );

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
  }, [t]);

  const captureStrategyDeps = useMemo<CaptureStrategyDeps>(
    () => ({
      newId,
      spectrum: { locale: spectrum.locale, isProUser: spectrum.isProUser },
      withTimeout,
      parseDueDateFromText,
      emitTalkDebug,
      persistAudioMemoFile,
      translate: (key, options) => t(key, options),
    }),
    [
      emitTalkDebug,
      parseDueDateFromText,
      persistAudioMemoFile,
      spectrum.isProUser,
      spectrum.locale,
      t,
      withTimeout,
    ],
  );

  const micLocked = !spectrum.isProUser && (freeQuotaSnapshot?.remaining ?? 1) <= 0;

  const beforeStartCapture = useCallback(async (): Promise<boolean> => {
    if (busy) return false;
    if (micLocked) {
      setPassProVisible(true);
      return false;
    }
    return true;
  }, [busy, micLocked]);

  const onMicTranscript = useCallback(
    (text: string) => {
      setRawTranscript(text);
      if (!isTitleLocked && shouldLockSmartTitle(text)) {
        const smart = generateSmartTitle(cleanTranscriptText(text), spectrum.locale);
        if (smart) {
          setLockedTitle(smart);
          setIsTitleLocked(true);
          if (!hasManualTitleEdit) setTitleDraft(smart);
        }
      }
    },
    [hasManualTitleEdit, isTitleLocked, spectrum.locale],
  );

  const onMicStart = useCallback(() => {
    setCaptureStep('recording');
    setRawTranscript('');
    setLockedTitle('');
    setIsTitleLocked(false);
    setTitleDraft('');
    setHasManualTitleEdit(false);
    setAudioUri(null);
  }, []);

  const onMicEnd = useCallback((payload: { transcript: string; audioUri: string | null }) => {
    const t0 = perfNowMs();
    logOneTapCaptureCycleStartBanner();
    console.log(`[OneTapPerf] T0_CAPTURE_END${ONE_TAP_DEBUG_LOG_CONT}t0_ms: ${Math.round(t0)}`);
    setAudioUri(payload.audioUri);
    setTranscriptDraft(payload.transcript);
  }, []);

  const openPeekAfterOk = useCallback(() => {
    const snap = peekSnapshotRef.current;
    const categoryId = normalizeCategoryId(snap?.categoryTag);
    const peekRow = {
      id: 'peek_pending',
      type: 'NOTE',
      category_id: categoryId,
      display_title: '',
      title: '',
      due_date: null,
      metadata_json: '{}',
      status: 'TODO',
      created_at: Date.now(),
      updated_at: Date.now(),
      is_archived: 0,
      is_dirty: 0,
    } as unknown as TrankilV2TimelineItemRow;
    setDetailRow(peekRow);
    setDetailPosition('peek');
    setDetailPeekHeightPx(40);
    setDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRow(null);
    setDetailPosition('full');
    setDetailPeekHeightPx(40);
  }, []);

  useEffect(() => {
    const subSnap = DeviceEventEmitter.addListener(INTENTION_PEEK_SNAPSHOT_EVENT_NAME, (payload) => {
      peekSnapshotRef.current = payload as { categoryTag?: unknown; predictedType?: unknown; title?: unknown } | null;
    });
    const subFirstSave = DeviceEventEmitter.addListener(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, (payload) => {
      const intentionId = String((payload as any)?.intentionId ?? '').trim();
      if (!intentionId) return;
      void (async () => {
        const full = await getTrankilV2IntentionById(intentionId);
        if (!full) return;
        const mapped = mapTrankilIntentionToTimelineItemRow(full);
        setDetailRow((prev) => {
          if (!prev) return prev;
          if (!detailOpen) return prev;
          if (detailPosition !== 'peek') return prev;
          return mapped;
        });
        if (detailOpen && detailPosition === 'peek') {
          setDetailPeekHeightPx(200);
        }
      })();
    });
    return () => {
      subSnap.remove();
      subFirstSave.remove();
    };
  }, [detailOpen, detailPosition]);

  const onMicValidated = useCallback(() => {
    setCaptureStep('idle');
  }, []);

  const onMicCancel = useCallback(async () => {
    hardResetToIdle();
  }, [hardResetToIdle]);

  const onChooseAction = useCallback(
    async (action: 'note' | 'task' | 'habit' | 'project' | 'audio' | 'list' | 'cancel') => {
      if (action === 'cancel') {
        hardResetToIdle();
        return;
      }
      setBusy(true);
      try {
        const finalTranscript = buildFinalTranscriptForCapture(transcriptDraft, rawTranscript);
        const smartTitle = (
          titleDraft.trim() ||
          (isTitleLocked ? lockedTitle : '') ||
          generateSmartTitle(finalTranscript, spectrum.locale) ||
          finalTranscript
        ).trim();

        const postEffectsConfigFor = (mirrorType: 'TASK' | 'HABIT'): PostCaptureEffectsConfig => ({
          isProUser: spectrum.isProUser,
          calendarSyncEnabled: mirrorType === 'TASK' ? calendarSyncByType.task : calendarSyncByType.habit,
          alarmSyncEnabled: mirrorType === 'TASK' ? alarmSyncByType.task : alarmSyncByType.habit,
          autoArchiveAfterCalendarSync,
          selectedCalendarId,
        });

        if (action === 'note') {
          const res = await executeQuickNoteCapture({
            deps: captureStrategyDeps,
            title: smartTitle || t('timeline.note'),
            finalTranscript,
            fallbackNoteTitle: t('timeline.note'),
          });
          if (!res.ok) throw res.error;
          if (res.outcome.kind !== 'simple_note_or_audio') throw new Error('unexpected_capture_outcome');
          await maybeConsumeFreeCaptureSuccess();
          pushSuccessFeedback(t(res.outcome.successFeedbackI18nKey));
          hardResetToIdle();
          return;
        }

        if (action === 'task') {
          const res = await executeTaskCapture({
            deps: captureStrategyDeps,
            finalTranscript,
            smartTitle,
            quickTaskLabel: t('talkDebug.quickTask'),
          });
          if (!res.ok) throw res.error;
          if (res.outcome.kind !== 'persisted_temporal') throw new Error('unexpected_capture_outcome');
          const o = res.outcome;
          await maybeConsumeFreeCaptureSuccess();
          const cfg = postEffectsConfigFor(o.mirrorType);
          void (async () => {
            const fx = await applyPostCaptureEffects(o.intentionId, o.mirrorType, {
              title: o.title,
              dueDateYmd: o.dueDateYmd,
              metadataJson: o.metadataJson,
            }, cfg);
            pushSuccessFeedback(buildTemporalCaptureRecap(o.recapIntroI18nKey, fx, t));
          })();
          hardResetToIdle();
          return;
        }

        if (action === 'habit') {
          const res = await executeHabitCapture({
            deps: captureStrategyDeps,
            finalTranscript,
            smartTitle,
            habitsDefaultTitle: t('common.habits'),
            birthdayLabel: t('talkDebug.birthdayLabel'),
          });
          if (!res.ok) throw res.error;
          if (res.outcome.kind === 'offline_raw_note_saved') {
            showAppToast(t('capture.offlineNoteGenericToast'));
            hardResetToIdle();
            return;
          }
          if (res.outcome.kind !== 'persisted_temporal') throw new Error('unexpected_capture_outcome');
          const o = res.outcome;
          await maybeConsumeFreeCaptureSuccess();
          const cfg = postEffectsConfigFor(o.mirrorType);
          void (async () => {
            const fx = await applyPostCaptureEffects(o.intentionId, o.mirrorType, {
              title: o.title,
              dueDateYmd: o.dueDateYmd,
              metadataJson: o.metadataJson,
            }, cfg);
            pushSuccessFeedback(buildTemporalCaptureRecap(o.recapIntroI18nKey, fx, t));
          })();
          hardResetToIdle();
          return;
        }

        if (action === 'project') {
          setTitleDraft('');
          setLockedTitle('');
          setIsTitleLocked(false);
          setDeadlineText('');
          setDeadlineError('');
          setDeadlineModalVisible(true);
          return;
        }

        if (action === 'audio') {
          const res = await executeAudioMemoCapture({
            deps: captureStrategyDeps,
            title: smartTitle || t('timeline.memoAudio'),
            finalTranscript,
            fallbackAudioTitle: t('timeline.memoAudio'),
            audioUri,
          });
          if (!res.ok) {
            if (res.code === 'AUDIO_MISSING') {
              Alert.alert(t('talkDebug.audioTitle'), t('talkDebug.audioMissing'));
              return;
            }
            throw res.error;
          }
          if (res.outcome.kind !== 'simple_note_or_audio') throw new Error('unexpected_capture_outcome');
          await maybeConsumeFreeCaptureSuccess();
          pushSuccessFeedback(t(res.outcome.successFeedbackI18nKey));
          hardResetToIdle();
          return;
        }

        if (action === 'list') {
          const res = await executeListInventoryCapture({
            deps: captureStrategyDeps,
            finalTranscript,
            fallbackTitle: t('talkDebug.listFallbackTitle'),
          });
          if (!res.ok) {
            if (res.code === 'LIST_QUOTA') {
              showAppToast(t('talkDebug.listQuotaExhaustedToast'));
              setPassProVisible(true);
              return;
            }
            throw res.error;
          }
          if (res.outcome.kind !== 'list_inventory_persisted') throw new Error('unexpected_capture_outcome');
          pushSuccessFeedback(t(res.outcome.successFeedbackI18nKey));
          hardResetToIdle();
          return;
        }
      } catch (e) {
        await handleCaptureFlowError(e, { translate: t });
      } finally {
        setBusy(false);
      }
    },
    [
      alarmSyncByType.habit,
      alarmSyncByType.task,
      audioUri,
      autoArchiveAfterCalendarSync,
      calendarSyncByType.habit,
      calendarSyncByType.task,
      captureStrategyDeps,
      hardResetToIdle,
      isTitleLocked,
      lockedTitle,
      maybeConsumeFreeCaptureSuccess,
      navigation,
      pushSuccessFeedback,
      rawTranscript,
      selectedCalendarId,
      spectrum.isProUser,
      spectrum.locale,
      t,
      titleDraft,
      transcriptDraft,
    ],
  );

  useEffect(() => {
    if (!projectPlanPreview) return;
    void ensureWritableCalendars();
  }, [ensureWritableCalendars, projectPlanPreview]);

  const submitProjectGenerationWithDeadline = useCallback(async () => {
    const finalTranscript = transcriptDraft.trim() || rawTranscript.trim();
    const cleanedDeadline = deadlineText.trim();
    if (!finalTranscript || !cleanedDeadline) return;
    setIsGeneratingPlan(true);
    setDeadlineError('');
    const shellId = newId();
    projectShellIdRef.current = shellId;
    const shellTitle = (generateSmartTitle(finalTranscript, spectrum.locale) || finalTranscript).trim().slice(0, 200) || t('common.projects');
    try {
      await insertTrankilV2Intention({
        id: shellId,
        type: 'NOTE',
        title: shellTitle,
        content_raw: finalTranscript,
        metadata_json: JSON.stringify(
          {
            source: 'offline_first_project_shell',
            offline_first_pending_ai: true,
            ai_capture_kind: 'PROJECT_ATOMIZE',
            project_deadline_text: cleanedDeadline,
          },
          null,
          2,
        ),
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: 'PERSO',
        parent_id: null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 0,
        complexity_level: 0,
        created_at: Date.now(),
        is_pending_ai: 1,
      });
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
    } catch {
      projectShellIdRef.current = null;
      setIsGeneratingPlan(false);
      return;
    }
    try {
      const preview = await generateProjectPlanFromDeadline({
        finalTranscript,
        deadlineText: cleanedDeadline,
        parseDueDateFromText,
      });
      const shellRow = await getTrankilV2IntentionById(shellId);
      void shellRow;
      await patchMetadata(shellId, { awaiting_project_validation: true, offline_first_pending_ai: false });
      await updateTrankilV2IntentionPendingAiFlag(shellId, 0);
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      setDeadlineModalVisible(false);
      setProjectPlanPreview(preview);
    } catch (e: unknown) {
      await applyOfflineFirstShellFailure(shellId, e);
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('PLAN_JSON_PARSE_ERROR') || msg.includes('GEMINI_ROWS_INVALID')) {
        setDeadlineError(t('talkDebug.planParseError'));
      }
      showAppToast(t('capture.offlineNoteGenericToast'));
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [deadlineText, parseDueDateFromText, rawTranscript, spectrum.locale, transcriptDraft, t]);

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

  const onValidateProjectPlan = useCallback(async (options?: { forceCalendarId?: string; skipPicker?: boolean }) => {
    if (!projectPlanPreview) return;
    setBusy(true);
    try {
      const archiveProjectOnSave =
        Boolean(autoArchiveAfterCalendarSync) &&
        Boolean(calendarSyncByType.project) &&
        Boolean(spectrum.isProUser);
      await persistValidatedProjectPlan({
        preview: projectPlanPreview,
        taskAlarmIndexes: projectPlanPreview.taskAlarmIndexes,
        selectedTaskIndexes: projectPlanPreview.selectedTaskIndexes,
        audioUri,
        status: archiveProjectOnSave ? 'ARCHIVED' : 'TODO',
        isOrganized: archiveProjectOnSave ? 1 : 0,
      });
      if (projectShellIdRef.current) {
        await deleteTrankilV2IntentionById(projectShellIdRef.current);
        projectShellIdRef.current = null;
      }
      const writableCalendars =
        calendarOptions.length > 0 ? calendarOptions : await ensureWritableCalendars();
      if (calendarSyncByType.project && spectrum.isProUser) {
        if (writableCalendars.length > 1 && !calendarPickerVisible && !options?.skipPicker) {
          setCalendarPickerTarget('project');
          setCalendarPickerVisible(true);
          return;
        }
        const currentCalendarId =
          options?.forceCalendarId ?? selectedCalendarId ?? writableCalendars[0]?.id ?? null;
        if (currentCalendarId) await selectCalendar(currentCalendarId);
      }
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      setProjectPlanPreview(null);
      if (archiveProjectOnSave) {
        void logActivity('CALENDAR_SYNC_ARCHIVE', 0, {
          intention_type: 'PROJECT',
          selected_tasks: projectPlanPreview.selectedTaskIndexes.length,
        });
        pushSuccessFeedback(t('talkDebug.savedCalendarArchivedToast'));
      }
      pushSuccessFeedback(
        calendarSyncByType.project && spectrum.isProUser
          ? t('talkDebug.savedCalendarToast')
          : t('talkDebug.projectAnchored'),
      );
      hardResetToIdle();
    } catch (e: unknown) {
      await handleCaptureFlowError(e, {
        translate: t,
        alertTitleKey: 'common.projects',
        fallbackMessageKey: 'talkDebug.projectValidationError',
      });
    } finally {
      setBusy(false);
    }
  }, [
    audioUri,
    calendarOptions,
    calendarSyncByType.project,
    calendarPickerVisible,
    ensureWritableCalendars,
    hardResetToIdle,
    autoArchiveAfterCalendarSync,
    projectPlanPreview,
    pushSuccessFeedback,
    selectCalendar,
    selectedCalendarId,
    spectrum.isProUser,
    t,
  ]);

  const onSubmitPhoenix = useCallback(async () => {
    const transcript = phoenixInput.trim();
    if (!transcript) return;
    if (!intentionFlow) {
      Alert.alert('Capture', 'IntentionProvider manquant (Dev Client requis).');
      return;
    }
    setPhoenixSubmitting(true);
    try {
      intentionFlow.startCapture();
      await intentionFlow.submitCapturePayload({ transcript, audioUri: null, lang: resolveSpeechLangForSession(i18n.language) });
      setPhoenixInput('');
    } catch (e) {
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    } finally {
      setPhoenixSubmitting(false);
    }
  }, [i18n.language, intentionFlow, phoenixInput]);

  return (
    <View style={styles.root}>
      <PassProModal
        visible={passProVisible}
        onDismiss={() => setPassProVisible(false)}
      />
      <IntentionDetailSheet
        visible={detailOpen}
        row={detailRow}
        theme={theme}
        onClose={closeDetail}
        initialPosition={detailPosition}
        peekHeightPx={detailPeekHeightPx}
        validationMode
      />
      <View style={[styles.headerSafe, { paddingTop: Math.max(insets.top, 6) }]}>
        <View style={styles.phoenixRow}>
          <TextInput
            value={phoenixInput}
            onChangeText={setPhoenixInput}
            placeholder="Tape ton intention ici..."
            placeholderTextColor="rgba(226,232,240,0.55)"
            style={styles.phoenixInput}
            editable={!phoenixSubmitting && !busy}
            returnKeyType="send"
            onSubmitEditing={() => void onSubmitPhoenix()}
          />
          <TouchableOpacity
            style={[styles.phoenixSendBtn, (phoenixSubmitting || busy) ? styles.disabled : null]}
            onPress={() => void onSubmitPhoenix()}
            disabled={phoenixSubmitting || busy}
            activeOpacity={0.8}
          >
            <Text style={styles.phoenixSendText}>Envoyer</Text>
          </TouchableOpacity>
        </View>
        <PilotStatusHeader
          variant="talkDebug"
          isProUser={spectrum.isProUser}
          freeRemaining={freeQuotaSnapshot?.remaining ?? 0}
          freeMax={freeQuotaSnapshot?.max ?? 3}
          dayOfMonth={new Date().getDate()}
          todayTodoCount={todayTodoCount}
          piggyCount={headerUnorganizedCount}
          onPressCredits={() => {
            if (rootNavigationRef.isReady()) {
              rootNavigationRef.navigate('ProSubscription');
            }
          }}
          onPressCalendar={() =>
            navigation.navigate('Timeline', {
              initialTimeNav: 'TODAY',
              initialContext: 'ALL',
            })
          }
          onPressPiggy={() =>
            navigation.navigate('Timeline', {
              initialTimeNav: 'TODAY',
              initialContext: 'PIGGY',
            })
          }
          translate={t}
        />
      </View>

      {captureStep === 'idle' &&
      transcriptDraft.trim().length > 0 &&
      !deadlineModalVisible ? (
        <View style={styles.projectCtaWrap}>
          <Pressable
            style={styles.projectCtaBtn}
            onPress={() => {
              setTitleDraft('');
              setLockedTitle('');
              setIsTitleLocked(false);
              setDeadlineError('');
              setDeadlineModalVisible(true);
            }}
            disabled={busy}
          >
            <Text style={styles.projectCtaText}>{t('talkDebug.oneTapOpenProjectPlan')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.middleSpacer} />

      <IntentionSuggestionsBanner
        visible={
          captureStep === 'idle' &&
          !deadlineModalVisible
        }
        bottomOffset={112}
      />

      <View
        style={[
          styles.captureDock,
          {
            paddingBottom: Math.max(insets.bottom, 10),
            justifyContent: captureStep === 'idle' ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <TalkCaptureMicButton
          variant="talkDebug"
          disabled={busy}
          locked={micLocked}
          lockedHintText={t('talkDebug.micQuotaUpsellHint')}
          waveformA11yLabel={t('talkDebug.voiceWaveformA11y')}
          onLockedPress={() => setPassProVisible(true)}
          beforeStart={beforeStartCapture}
          onCaptureStart={onMicStart}
          onCaptureEnd={onMicEnd}
          onCaptureCancel={onMicCancel}
          onPeekStart={openPeekAfterOk}
          onValidated={onMicValidated}
          onTranscriptChange={onMicTranscript}
        />
      </View>

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
              <Pressable
                style={[styles.overlayActionBtn, styles.cancelBtn]}
                onPress={() => {
                  setDeadlineModalVisible(false);
                }}
                disabled={isGeneratingPlan}
              >
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
            {selectedCalendar ? (
              <Pressable
                style={styles.calendarCurrentBtn}
                onPress={() => setCalendarPickerVisible(true)}
                disabled={busy}
              >
                <View style={[styles.calendarColorDot, { backgroundColor: selectedCalendar.color }]} />
                <Text style={styles.calendarCurrentText}>
                  {t('talkDebug.calendarDefaultLabel', { calendar: selectedCalendar.title })}
                </Text>
              </Pressable>
            ) : null}
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
      {calendarPickerVisible ? (
        <View style={styles.overlayBackdrop}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>{t('talkDebug.calendarPickerTitle')}</Text>
            <Text style={styles.overlaySub}>{t('talkDebug.calendarPickerSubtitle')}</Text>
            <ScrollView style={styles.calendarPickerList}>
              {calendarOptions.map((item) => {
                const selected = item.id === selectedCalendarId;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.calendarPickerItem, selected ? styles.calendarPickerItemSelected : null]}
                    onPress={() => {
                      if (calendarPickerTarget === 'project') {
                        void onValidateProjectPlan({ forceCalendarId: item.id, skipPicker: true });
                        return;
                      }
                      void (async () => {
                        await selectCalendar(item.id);
                        setCalendarPickerVisible(false);
                        setCalendarPickerTarget(null);
                      })();
                    }}
                  >
                    <View style={[styles.calendarColorDot, { backgroundColor: item.color }]} />
                    <Text style={styles.calendarPickerText}>{item.title}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={[styles.overlayActionBtn, styles.cancelBtn]}
              onPress={() => setCalendarPickerVisible(false)}
            >
              <Text style={styles.fanBtnText}>{t('common.later')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  headerSafe: { paddingHorizontal: 16, paddingBottom: 8 },
  phoenixRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  phoenixInput: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.55)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(15,23,42,0.55)',
    fontWeight: '700',
  },
  phoenixSendBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#008080',
    borderWidth: 1,
    borderColor: 'rgba(236,254,255,0.35)',
  },
  phoenixSendText: { color: '#ecfeff', fontSize: 14, fontWeight: '900' },
  statusHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  statusHeaderSpacer: { flex: 1 },
  statusHeaderCluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calendarGlyph: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.45)',
    backgroundColor: 'rgba(0, 128, 128, 0.16)',
  },
  calendarGlyphDay: { color: '#F5F5F0', fontSize: 22, fontWeight: '800', minWidth: 26, textAlign: 'center' },
  softBadgeTodo: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 128, 128, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.55)',
  },
  softBadgeTodoText: { color: '#ecfeff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  zeroTodoCheck: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 245, 240, 0.12)',
  },
  softBadgePiggy: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 140, 0, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255, 140, 0, 0.5)',
  },
  softBadgePiggyText: { color: '#fff7ed', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  middleScroll: { flex: 1, minHeight: 0 },
  middleScrollContent: { paddingHorizontal: 16, paddingBottom: 16 },
  middleSpacer: { flex: 1, minHeight: 0 },
  monetizationStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.25)',
  },
  creditsMini: { color: 'rgba(226, 232, 240, 0.85)', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  captureDock: { paddingHorizontal: 20, paddingTop: 10, minHeight: 120 },
  captureTranscriptShell: { width: '100%', position: 'relative', marginBottom: 14 },
  captureTranscriptScroll: { width: '100%' },
  validationCanvas: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#111827',
  },
  validationText: {
    marginTop: 20,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
    color: '#E3F2FD',
  },
  pilotRowDocked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 4,
  },
  ctrlBtnPrimary: { width: 72, height: 72, borderRadius: 999, backgroundColor: '#008080' },
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
    marginBottom: 8,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: '#008080',
    justifyContent: 'center',
    alignItems: 'center',
  },
  micShell: { alignSelf: 'center', width: '100%', alignItems: 'center', gap: 10, marginBottom: 8 },
  micHintPress: { maxWidth: 320, paddingHorizontal: 14, paddingVertical: 8 },
  micHintText: { color: 'rgba(226, 232, 240, 0.92)', fontSize: 12, lineHeight: 16, textAlign: 'center', fontWeight: '700' },
  micBtnLocked: { backgroundColor: '#475569' },
  micLockBadge: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionMainBtn: {
    flex: 1,
  },
  calendarToggleBtn: {
    width: 44,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  calendarToggleOn: {
    backgroundColor: '#008080',
    borderColor: '#008080',
  },
  calendarToggleLocked: {
    backgroundColor: '#e2e8f0',
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
  calendarCurrentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  calendarCurrentText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700',
  },
  calendarColorDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  calendarPickerList: { maxHeight: 280 },
  calendarPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  calendarPickerItemSelected: {
    borderColor: '#008080',
    backgroundColor: '#ecfeff',
  },
  calendarPickerText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
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
  projectCtaWrap: { paddingHorizontal: 20, paddingVertical: 6, alignItems: 'center' },
  projectCtaBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,128,128,0.45)',
    backgroundColor: 'rgba(236,254,255,0.9)',
  },
  projectCtaText: { color: '#0f766e', fontWeight: '800', fontSize: 13 },
});
