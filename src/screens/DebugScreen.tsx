import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, SegmentedButtons, Switch, useTheme } from 'react-native-paper';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { Bell } from 'lucide-react-native';

import { CalendarGranularSection } from '../components';
import { showFirebaseProjectIdDebugAlert } from '../components/FirebaseProjectIdDebugAlert';
import {
  consumeTrankilV2IntentCredit,
  getLastTrankilV2IntentionRaw,
  getTrankilV2IntentionTaskCounts,
  getTrankilV2UserStats,
  insertTrankilV2Intention,
  listTrankilV2Intentions,
  purgeTrankilV2IntentionsCascade,
  setAdState,
  setDebugSpawnFlies,
  type TrankilV2IntentionRow,
} from '../api/trankilV2Db';
import {
  deleteAllIntentions,
  insertIntention,
  intentionRowToDebugSnapshot,
  listIntentionsDescending,
  INTENTIONS_CHANGED_EVENT_NAME,
  LOCAL_DB_RESET_EVENT,
} from '../api/localDb';
import { ensureFirebaseAnonymousAuth, getFirestoreDb } from '../api/firebase';
import { getOrCreateDeviceId, syncPendingIntentions } from '../api/syncService';
import {
  DEBUG_LAST_RAIL_INBOX_PURGE_MS,
  DEBUG_LAST_TRANSIT_INTENTION_PURGE_MS,
} from '../config/transitPurgeKeys';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import type { TalkCaptureDebugPayload } from '../constants/talkCaptureDebug';
import { executeFactoryResetDataPlane } from '../services/factoryReset';
import { usePower } from '../context/PowerContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { seedDemoTypicalDay } from '../services/demoTypicalDay';
import { scheduleDebugAgentDirectAlarmIn10Minutes } from '../services/alarmManager';
import type { RailAlarmSoundId } from '../services/railAlarmSound';
import { palette } from '../theme/colors';
import { STRINGS } from '../constants/Strings';
import { atomizeProject, type GeminiExpertIntention } from '../services/GeminiExpert';

type ProjectPlanPreviewState = {
  projectTitle: string;
  rawInput: string;
  rows: GeminiExpertIntention[];
  taskAlarmIndexes: number[];
};

function formatDueDateLocal(dueDate: string | null | undefined): string {
  const raw = String(dueDate || '').trim();
  if (!/^\d{8}$/.test(raw)) return '--';
  const yyyy = Number(raw.slice(0, 4));
  const mm = Number(raw.slice(4, 6));
  const dd = Number(raw.slice(6, 8));
  const date = new Date(yyyy, mm - 1, dd);
  if (Number.isNaN(date.getTime())) return '--';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || undefined;
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return `${dd}/${mm}/${yyyy}`;
  }
}

async function persistGeminiExpertRowsForDebug(
  rawInput: string,
  rows: GeminiExpertIntention[],
  taskAlarmIndexes: number[],
): Promise<{ projectId: string | null; insertedCount: number }> {
  let currentParentId: string | null = null;
  let projectId: string | null = null;
  let taskCursor = 0;
  let insertedCount = 0;
  const alarmSet = new Set(taskAlarmIndexes);
  for (const row of rows) {
    const id = randomUUID();
    if (row.type === 'PROJECT') {
      currentParentId = id;
      projectId = id;
    }
    const shouldSetAlarm = row.type === 'TASK' && alarmSet.has(taskCursor);
    const metadata = {
      ...(row.metadata ?? {}),
      ...(shouldSetAlarm ? { has_alarm: true } : {}),
      source: 'debug_project_simulation',
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
      is_local_processed: 0,
      complexity_level: 2,
      created_at: Date.now(),
    });
    insertedCount += 1;
  }
  return { projectId, insertedCount };
}

export function DebugScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { spectrum, setProUser, setPreferredAlarmSound } = useUserSpectrum();
  const power = usePower();
  const [busy, setBusy] = useState<
    | 'profile'
    | 'db'
    | 'sim'
    | 'demoDay'
    | 'simWaIntent'
    | 'simProject'
    | 'purgeIntentions'
    | 'purgeTrankilIntentions'
    | 'forceAgentAlarm'
    | null
  >(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rawIntentionsJson, setRawIntentionsJson] = useState<string>('[]');
  const [syncPurgeRailCloud, setSyncPurgeRailCloud] = useState<number | null>(
    null,
  );
  const [syncPurgeTransitCloud, setSyncPurgeTransitCloud] = useState<
    number | null
  >(null);
  const [lastRailPurgeMs, setLastRailPurgeMs] = useState<number | null>(null);
  const [lastTransitPurgeMs, setLastTransitPurgeMs] = useState<number | null>(
    null,
  );
  const [syncPurgeBusy, setSyncPurgeBusy] = useState(false);
  const [talkCaptureLog, setTalkCaptureLog] = useState<TalkCaptureDebugPayload | null>(
    null,
  );
  const [kpis, setKpis] = useState({
    marginRatio: 0,
    geminiCalls: 0,
    adEfficiency: 0,
    bioScore: 0,
  });
  const [debugProjectText, setDebugProjectText] = useState('');
  const [projectPlanPreview, setProjectPlanPreview] = useState<ProjectPlanPreviewState | null>(null);
  const [simLatencyMs, setSimLatencyMs] = useState<number | null>(null);
  const [trankilRows, setTrankilRows] = useState<TrankilV2IntentionRow[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [dbCounts, setDbCounts] = useState({ intentionsCount: 0, tasksCount: 0 });

  const refreshKpis = useCallback(async () => {
    const stats = await getTrankilV2UserStats();
    const marginRatio = stats.local_action_streak;
    const adEfficiency = stats.ad_videos_watched;
    const bioScore = stats.zen_points;
    setKpis({
      marginRatio,
      geminiCalls: 0,
      adEfficiency,
      bioScore,
    });
  }, []);

  const refreshSyncPurge = useCallback(async () => {
    setSyncPurgeBusy(true);
    try {
      const db = getFirestoreDb();
      if (!db) {
        setSyncPurgeRailCloud(null);
        setSyncPurgeTransitCloud(null);
        return;
      }
      await ensureFirebaseAnonymousAuth();
      const deviceId = await getOrCreateDeviceId();
      const railQ = query(
        collection(db, 'devices', deviceId, 'rail_inbox'),
        limit(50),
      );
      const transitQ = query(
        collection(db, 'devices', deviceId, 'intentions'),
        limit(50),
      );
      const [railSnap, transitSnap] = await Promise.all([
        getDocs(railQ),
        getDocs(transitQ),
      ]);
      setSyncPurgeRailCloud(railSnap.size);
      setSyncPurgeTransitCloud(transitSnap.size);
      const lr = await AsyncStorage.getItem(DEBUG_LAST_RAIL_INBOX_PURGE_MS);
      const lt = await AsyncStorage.getItem(DEBUG_LAST_TRANSIT_INTENTION_PURGE_MS);
      setLastRailPurgeMs(lr ? parseInt(lr, 10) : null);
      setLastTransitPurgeMs(lt ? parseInt(lt, 10) : null);
    } finally {
      setSyncPurgeBusy(false);
    }
  }, []);

  const refreshRawIntentions = useCallback(async () => {
    try {
      const rows = await listIntentionsDescending();
      const snap = rows.map(intentionRowToDebugSnapshot);
      setRawIntentionsJson(JSON.stringify(snap, null, 2));
    } catch (e) {
      setRawIntentionsJson(
        JSON.stringify(
          { error: e instanceof Error ? e.message : String(e) },
          null,
          2,
        ),
      );
    }
  }, []);

  const refreshTrankilIntentions = useCallback(async () => {
    const [rows, counts] = await Promise.all([
      listTrankilV2Intentions(),
      getTrankilV2IntentionTaskCounts(),
    ]);
    setTrankilRows(rows);
    setDbCounts(counts);
  }, []);

  useEffect(() => {
    void refreshRawIntentions();
    void refreshTrankilIntentions();
    void refreshSyncPurge();
    void refreshKpis();
    const subIntentions = DeviceEventEmitter.addListener(
      INTENTIONS_CHANGED_EVENT_NAME,
      () => {
        void refreshRawIntentions();
        void refreshTrankilIntentions();
        void refreshSyncPurge();
      },
    );
    const subReset = DeviceEventEmitter.addListener(
      LOCAL_DB_RESET_EVENT,
      () => void refreshRawIntentions(),
    );
    const subTalkCapture = DeviceEventEmitter.addListener(
      TALK_CAPTURE_DEBUG_EVENT,
      (payload: TalkCaptureDebugPayload) => {
        setTalkCaptureLog(payload);
      },
    );
    return () => {
      subIntentions.remove();
      subReset.remove();
      subTalkCapture.remove();
    };
  }, [refreshKpis, refreshRawIntentions, refreshSyncPurge, refreshTrankilIntentions]);

  const onForceMorning = useCallback(() => {
    DeviceEventEmitter.emit('DEBUG_FORCE_MORNING');
  }, []);

  const onForceEvening = useCallback(() => {
    DeviceEventEmitter.emit('DEBUG_FORCE_EVENING');
  }, []);

  const onSpawnFlies = useCallback(async () => {
    await setDebugSpawnFlies(10);
    Alert.alert(STRINGS.admin.title, STRINGS.admin.spawnDone);
  }, []);

  const onResetCredits = useCallback(async () => {
    await setAdState({ ia_credits: 0 });
    Alert.alert(STRINGS.admin.title, STRINGS.admin.resetDone);
  }, []);

  const onResetProfile = useCallback(async () => {
    setLastError(null);
    setBusy('profile');
    try {
      power.setEnergyScore(1);
      power.setLowPower(false);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [power]);

  const runFactoryReset = useCallback(async () => {
    setLastError(null);
    setBusy('db');
    try {
      const { health } = await executeFactoryResetDataPlane();
      power.setEnergyScore(1);
      power.setLowPower(false);
      if (!health.sqliteOk) {
        setLastError(t('debug.factoryResetHealthWarn'));
      }
      setTimeout(() => {
        Alert.alert(
          t('debug.factoryResetSuccessTitle'),
          t('debug.factoryResetSuccessBody'),
        );
      }, 500);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [power, t]);

  const onRebuildDb = useCallback(() => {
    Alert.alert(
      t('debug.factoryResetConfirmTitle'),
      t('debug.factoryResetConfirmBody'),
      [
        { text: t('debug.factoryResetCancel'), style: 'cancel' },
        {
          text: t('debug.factoryResetContinue'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('debug.factoryResetSecondTitle'),
              t('debug.factoryResetSecondBody'),
              [
                { text: t('debug.factoryResetCancel'), style: 'cancel' },
                {
                  text: t('debug.factoryResetDestructive'),
                  style: 'destructive',
                  onPress: () => {
                    void runFactoryReset();
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [runFactoryReset, t]);

  const externalSenderId =
    spectrum.platform_user_id?.trim() || 'talkndone_local_sim';

  const onSimMessage = useCallback(async () => {
    setLastError(null);
    setBusy('sim');
    try {
      await insertIntention({
        id: randomUUID(),
        title: t('debug.simWhatsApp'),
        description: t('debug.simSampleRaw'),
        status: 'pending',
        priority: 70,
        weights: {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        },
        platform_type: 'none',
        platform_user_id: externalSenderId,
        created_at: Date.now(),
        estimated_duration: 25,
        user_forced_urgent: false,
        is_late_night: false,
        alarm_enabled: false,
        is_flexible: true,
        is_micro_habit: false,
        is_hard_constraint: false,
      });
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [externalSenderId, spectrum, t]);

  const onSeedDemoDay = useCallback(async () => {
    setLastError(null);
    setBusy('demoDay');
    try {
      await seedDemoTypicalDay(
        spectrum.platform_type,
        spectrum.platform_user_id,
        [
          {
            title: t('debug.demoIntent1Title'),
            description: t('debug.demoIntent1Desc'),
            weights: {
              structure: 0.58,
              momentum: 0.18,
              zen: 0.14,
              stats: 0.1,
            },
            priority: 92,
            estimated_duration: 45,
            actual_duration: 42,
            completedHour: 9,
            completedMinute: 15,
          },
          {
            title: t('debug.demoIntent2Title'),
            description: t('debug.demoIntent2Desc'),
            weights: {
              structure: 0.12,
              momentum: 0.58,
              zen: 0.18,
              stats: 0.12,
            },
            priority: 88,
            estimated_duration: 30,
            actual_duration: 33,
            completedHour: 10,
            completedMinute: 45,
          },
          {
            title: t('debug.demoIntent3Title'),
            description: t('debug.demoIntent3Desc'),
            weights: {
              structure: 0.14,
              momentum: 0.12,
              zen: 0.56,
              stats: 0.18,
            },
            priority: 84,
            estimated_duration: 25,
            actual_duration: 24,
            completedHour: 12,
            completedMinute: 30,
          },
          {
            title: t('debug.demoIntent4Title'),
            description: t('debug.demoIntent4Desc'),
            weights: {
              structure: 0.32,
              momentum: 0.28,
              zen: 0.22,
              stats: 0.18,
            },
            priority: 80,
            estimated_duration: 50,
            actual_duration: 48,
            completedHour: 15,
            completedMinute: 20,
          },
          {
            title: t('debug.demoIntent5Title'),
            description: t('debug.demoIntent5Desc'),
            weights: {
              structure: 0.18,
              momentum: 0.18,
              zen: 0.18,
              stats: 0.46,
            },
            priority: 76,
            estimated_duration: 40,
            actual_duration: 38,
            completedHour: 17,
            completedMinute: 5,
          },
        ],
      );
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [spectrum.platform_type, spectrum.platform_user_id, t]);

  const onSimWhatsAppIntention = useCallback(async () => {
    setLastError(null);
    setBusy('simWaIntent');
    try {
      await insertIntention({
        id: randomUUID(),
        title: t('debug.testWhatsAppTitle'),
        description: '',
        status: 'pending',
        priority: 72,
        weights: {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        },
        platform_type: 'whatsapp',
        platform_user_id: spectrum.platform_user_id?.trim() || 'debug_wa',
        created_at: Date.now(),
        estimated_duration: 25,
        user_forced_urgent: false,
        is_late_night: false,
        alarm_enabled: false,
        is_micro_habit: false,
        is_hard_constraint: false,
        is_flexible: true,
        raw_transcript: t('debug.testWhatsAppRaw'),
        energy_score: 0.72,
      });
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      void syncPendingIntentions();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [spectrum, t]);

  const onPurgeIntentions = useCallback(() => {
    Alert.alert(
      t('debug.purgeIntentionsConfirmTitle'),
      t('debug.purgeIntentionsConfirmBody'),
      [
        { text: t('debug.purgeIntentionsCancel'), style: 'cancel' },
        {
          text: t('debug.purgeIntentionsConfirm'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLastError(null);
              setBusy('purgeIntentions');
              try {
                await deleteAllIntentions();
                setRawIntentionsJson('[]');
              } catch (e) {
                setLastError(e instanceof Error ? e.message : String(e));
              } finally {
                await refreshRawIntentions();
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }, [refreshRawIntentions, t]);

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

  const onSimulateDebugProject = useCallback(async () => {
    const text = debugProjectText.trim();
    if (!text) {
      Alert.alert('Debug Projet', 'Ajoute un texte dans le champ de simulation.');
      return;
    }
    setLastError(null);
    setBusy('simProject');
    const startedAt = Date.now();
    try {
      const rows = await atomizeProject(text);
      const projectTitle = rows.find((row) => row.type === 'PROJECT')?.title?.trim() || text.slice(0, 80);
      const latency = Date.now() - startedAt;
      setSimLatencyMs(latency);
      console.log(`[DebugProjet] latency_to_preview_ms=${latency}`);
      setProjectPlanPreview({
        projectTitle,
        rawInput: text,
        rows,
        taskAlarmIndexes: [],
      });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [debugProjectText]);

  const onValidateDebugProjectPlan = useCallback(async () => {
    if (!projectPlanPreview) return;
    setLastError(null);
    setBusy('simProject');
    try {
      const afterConsume = await consumeTrankilV2IntentCredit();
      const saved = await persistGeminiExpertRowsForDebug(
        projectPlanPreview.rawInput,
        projectPlanPreview.rows,
        projectPlanPreview.taskAlarmIndexes,
      );
      setProjectPlanPreview(null);
      Alert.alert(
        'Plan valide',
        `✅ SQLite OK\nID projet: ${saved.projectId ?? 'n/a'}\nLignes insérées: ${saved.insertedCount}\nCrédits restants: ${afterConsume.ia_credits}`,
      );
      await refreshRawIntentions();
      await refreshTrankilIntentions();
      await refreshKpis();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [projectPlanPreview, refreshKpis, refreshRawIntentions, refreshTrankilIntentions]);

  const onPurgeTrankilIntentions = useCallback(() => {
    Alert.alert(
      'Vider Intentions + Taches (Debug)',
      'Es-tu sur de vouloir tout effacer ? Cette action est irreversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Vider',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLastError(null);
              setBusy('purgeTrankilIntentions');
              try {
                const deleted = await purgeTrankilV2IntentionsCascade();
                Alert.alert(
                  'Debug',
                  `Suppression cascade OK\nIntentions: ${deleted.intentionsDeleted}\nTaches: ${deleted.tasksDeleted}`,
                );
                await refreshKpis();
                await refreshTrankilIntentions();
              } catch (e) {
                setLastError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }, [refreshKpis, refreshTrankilIntentions]);

  const onTestLogLastRaw = useCallback(async () => {
    try {
      const last = await getLastTrankilV2IntentionRaw();
      if (!last) {
        console.log('[Debug][TEST LOG] aucune ligne en base');
        Alert.alert('TEST LOG', 'Aucune ligne en base.');
        return;
      }
      console.log('[Debug][TEST LOG][LAST_ROW]', JSON.stringify(last, null, 2));
      Alert.alert('TEST LOG', `Derniere ligne loggee: ${last.id}`);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const toggleProjectExpanded = useCallback((projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  }, []);

  const onForceAgentDirectAlarm = useCallback(async () => {
    setLastError(null);
    setBusy('forceAgentAlarm');
    try {
      const id = await scheduleDebugAgentDirectAlarmIn10Minutes();
      Alert.alert(
        t('debug.forceAgentAlarmSuccessTitle'),
        t('debug.forceAgentAlarmSuccessBody', { id }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('debug.forceAgentAlarmErrorTitle'), msg);
    } finally {
      setBusy(null);
    }
  }, [t]);

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
        {t('debug.pilotTitle')}
      </Text>
      <Text style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
        {t('debug.note')}
      </Text>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>{STRINGS.admin.title}</Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {STRINGS.admin.kpiMargin}: {kpis.marginRatio.toFixed(2)}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {STRINGS.admin.kpiTokens}: {kpis.geminiCalls}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {STRINGS.admin.kpiAds}: {kpis.adEfficiency.toFixed(2)}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {STRINGS.admin.kpiBio}: {kpis.bioScore.toFixed(2)}
        </Text>
        <View style={styles.godRow}>
          <Button mode="contained-tonal" onPress={onForceMorning} style={styles.btnCompact}>
            {STRINGS.admin.forceMorning}
          </Button>
          <Button mode="contained-tonal" onPress={onForceEvening} style={styles.btnCompact}>
            {STRINGS.admin.forceEvening}
          </Button>
        </View>
        <View style={styles.godRow}>
          <Button mode="contained-tonal" onPress={() => void onSpawnFlies()} style={styles.btnCompact}>
            {STRINGS.admin.spawnFlies}
          </Button>
          <Button mode="contained-tonal" onPress={() => void onResetCredits()} style={styles.btnCompact}>
            {STRINGS.admin.resetCredits}
          </Button>
        </View>
      </View>
      <Button
        mode="outlined"
        onPress={showFirebaseProjectIdDebugAlert}
        style={styles.btn}
      >
        {t('debug.firebaseProjectIdButton')}
      </Button>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.talkCaptureSectionTitle')}
        </Text>
        {!talkCaptureLog ? (
          <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
            {t('debug.talkCaptureEmpty')}
          </Text>
        ) : (
          <>
            <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
              {talkCaptureLog.mode === 'quick'
                ? t('debug.talkCaptureModeQuick')
                : t('debug.talkCaptureModeDeep')}
            </Text>
            <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
              {t('debug.talkCaptureRawLabel')}
            </Text>
            <Text
              selectable
              style={[styles.mono, { color: theme.colors.onSurfaceVariant }]}
            >
              {talkCaptureLog.rawTranscript}
            </Text>
            {talkCaptureLog.localStructuredJson ? (
              <>
                <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
                  {t('debug.talkCaptureLocalLabel')}
                </Text>
                <Text
                  selectable
                  style={[styles.mono, styles.rawJson, { color: theme.colors.onSurfaceVariant }]}
                >
                  {talkCaptureLog.localStructuredJson}
                </Text>
              </>
            ) : null}
            {talkCaptureLog.geminiFullJson ? (
              <>
                <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
                  {t('debug.talkCaptureGeminiLabel')}
                </Text>
                <Text
                  selectable
                  style={[styles.mono, styles.rawJson, { color: theme.colors.onSurfaceVariant }]}
                >
                  {talkCaptureLog.geminiFullJson}
                </Text>
              </>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.calendarSection')}
        </Text>
        <CalendarGranularSection />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.soundSectionTitle')}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.soundHelp')}
        </Text>
        <SegmentedButtons
          value={spectrum.preferred_alarm_sound}
          onValueChange={(v) => void setPreferredAlarmSound(v as RailAlarmSoundId)}
          buttons={[
            { value: 'default', label: t('debug.soundDefault') },
            { value: 'zen', label: t('debug.soundZen') },
            { value: 'digital', label: t('debug.soundDigital') },
          ]}
          style={styles.segment}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.demoDaySectionTitle')}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.demoDayHelp')}
        </Text>
        <Button
          mode="contained"
          onPress={onSeedDemoDay}
          disabled={busy !== null}
          style={styles.btn}
          buttonColor={palette.orange}
        >
          {t('debug.demoDayButton')}
        </Button>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.simSectionTitle')}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.simSectionHelp')}
        </Text>
        <Button
          mode="contained"
          onPress={onSimMessage}
          disabled={busy !== null}
          style={styles.btn}
          buttonColor={palette.teal}
        >
          {t('debug.simWhatsApp')}
        </Button>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.simWhatsAppHelp')}
        </Text>
        <Button
          mode="contained-tonal"
          onPress={onSimWhatsAppIntention}
          disabled={busy !== null}
          style={styles.btn}
        >
          {t('debug.simWhatsAppIntentionButton')}
        </Button>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.simWhatsAppIntentionHelp')}
        </Text>

        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          Simuler Debug Projet
        </Text>
        <TextInput
          value={debugProjectText}
          onChangeText={setDebugProjectText}
          multiline
          placeholder="Ex: Lancer la nouvelle version mobile avec checklist..."
          placeholderTextColor="#839096"
          style={styles.debugProjectInput}
        />
        <Button
          mode="contained"
          onPress={() => void onSimulateDebugProject()}
          disabled={busy !== null}
          style={styles.btn}
          buttonColor={palette.orange}
        >
          Simuler Debug Projet
        </Button>
        {simLatencyMs !== null ? (
          <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
            Latence IA vers modale: {simLatencyMs} ms
          </Text>
        ) : null}
        <Button
          mode="outlined"
          onPress={() => void onPurgeTrankilIntentions()}
          disabled={busy !== null}
          style={[styles.btn, styles.btnSecond]}
        >
          Vider la table Intentions (Debug)
        </Button>
        <Button
          mode="outlined"
          onPress={() => void onTestLogLastRaw()}
          disabled={busy !== null}
          style={[styles.btn, styles.btnSecond]}
        >
          TEST LOG
        </Button>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          Base SQLite Projets / Dates
        </Text>
        <Text style={[styles.mono, styles.countLine, { color: theme.colors.onSurfaceVariant }]}>
          intentions={dbCounts.intentionsCount} | tasks={dbCounts.tasksCount}
        </Text>
        {trankilRows.map((row) => {
          const isProject = row.type === 'PROJECT';
          const isNote = row.type === 'NOTE';
          const projectTasks = isProject
            ? trankilRows.filter((r) => r.parent_id === row.id && r.type === 'TASK')
            : [];
          const expanded = Boolean(expandedProjects[row.id]);
          return (
            <View
              key={row.id}
              style={[
                styles.dbRow,
                isProject ? styles.dbRowProject : null,
                isNote ? styles.dbRowNote : null,
              ]}
            >
              <View style={styles.dbRowHead}>
                <Text style={[styles.dbTypeBadge, isProject ? styles.badgeProject : styles.badgeNote]}>
                  {row.type}
                </Text>
                <Text style={styles.dbTitle} numberOfLines={2}>
                  {row.title}
                </Text>
              </View>
              <Text style={styles.mono}>id: {row.id}</Text>
              <Text style={styles.mono}>due_date: {formatDueDateLocal(row.due_date)}</Text>
              {isProject ? (
                <>
                  <Pressable onPress={() => toggleProjectExpanded(row.id)} style={styles.accordionBtn}>
                    <Text style={styles.accordionText}>
                      [{projectTasks.length}] taches {expanded ? '▲' : '▼'}
                    </Text>
                  </Pressable>
                  {expanded ? (
                    <View style={styles.subTaskWrap}>
                      {projectTasks.map((task) => {
                        const meta = (() => {
                          try {
                            return JSON.parse(task.metadata_json || '{}') as { has_alarm?: boolean };
                          } catch {
                            return {};
                          }
                        })();
                        return (
                          <View key={task.id} style={styles.subTaskRow}>
                            <Text style={styles.subTaskTitle} numberOfLines={2}>
                              {task.title}
                            </Text>
                            <Text style={styles.mono}>a: {meta.has_alarm ? 'true' : 'false'}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.sectionAgentNativeTitle')}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.forceAgentAlarmHelp')}
        </Text>
        <Button
          mode="contained"
          onPress={() => void onForceAgentDirectAlarm()}
          disabled={busy !== null}
          style={styles.btn}
          buttonColor={palette.teal}
        >
          {t('debug.forceAgentAlarmButton')}
        </Button>
      </View>

      <View style={styles.section}>
        <Button
          mode="contained"
          onPress={onResetProfile}
          disabled={busy !== null}
          style={styles.btn}
        >
          {t('debug.resetProfile')}
        </Button>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.resetProfileHelp')}
        </Text>
      </View>

      <View style={styles.section}>
        <Button
          mode="outlined"
          onPress={onRebuildDb}
          disabled={busy !== null}
          style={styles.btn}
        >
          {t('debug.rebuildDb')}
        </Button>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.rebuildDbHelp')}
        </Text>
      </View>

      {busy !== null && (
        <View style={styles.row}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={{ color: theme.colors.onSurface, marginLeft: 8 }}>
            {busy === 'profile'
              ? t('debug.busyProfile')
              : busy === 'db'
                ? t('debug.busySqlite')
                : busy === 'demoDay'
                  ? t('debug.demoDayBusy')
                  : busy === 'simWaIntent'
                    ? t('debug.simWhatsAppIntentionBusy')
                    : busy === 'purgeIntentions'
                      ? t('debug.purgeIntentionsBusy')
                      : busy === 'forceAgentAlarm'
                        ? t('debug.forceAgentAlarmBusy')
                        : t('debug.simBusy')}
          </Text>
        </View>
      )}

      {lastError !== null && (
        <Text style={[styles.err, { color: theme.colors.error }]} selectable>
          {lastError}
        </Text>
      )}

      <Text style={[styles.blockTitle, { color: theme.colors.primary }]}>
        {t('debug.sectionSpectrum')}
      </Text>
      <View style={[styles.switchRow, styles.switchRowSecond]}>
        <View style={styles.switchLabelCol}>
          <Text style={[styles.switchTitle, { color: theme.colors.onSurface }]}>
            {t('debug.proUserToggle')}
          </Text>
        </View>
        <Switch
          value={spectrum.isProUser === true}
          onValueChange={(v) => void setProUser(v)}
        />
      </View>
      <Text
        style={[styles.mono, { color: theme.colors.onSurface }]}
        selectable
      >
        {JSON.stringify(spectrum, null, 2)}
      </Text>

      <Text style={[styles.blockTitle, { color: theme.colors.primary }]}>
        {t('debug.sectionPower')}
      </Text>
      <Text
        style={[styles.mono, { color: theme.colors.onSurface }]}
        selectable
      >
        {JSON.stringify(
          {
            energyScore: power.energyScore,
            agentEnergySeconds: power.agentEnergySeconds,
            isLowPower: power.isLowPower,
          },
          null,
          2,
        )}
      </Text>

      <Text style={[styles.blockTitle, { color: theme.colors.primary }]}>
        {t('debug.sectionRawIntentions')}
      </Text>
      <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
        {t('debug.rawIntentionsHelp')}
      </Text>
      <Button
        mode="outlined"
        onPress={onPurgeIntentions}
        disabled={busy !== null}
        style={[styles.btn, styles.btnSecond]}
      >
        {t('debug.purgeIntentions')}
      </Button>
      <Text
        style={[styles.mono, styles.rawJson, { color: theme.colors.onSurface }]}
        selectable
      >
        {rawIntentionsJson}
      </Text>

      <Text style={[styles.blockTitle, { color: theme.colors.primary }]}>
        {t('debug.sectionSyncPurge')}
      </Text>
      <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
        {t('debug.syncPurgeHelp')}
      </Text>
      <Button
        mode="outlined"
        onPress={() => void refreshSyncPurge()}
        disabled={syncPurgeBusy}
        loading={syncPurgeBusy}
        style={[styles.btn, styles.btnSecond]}
      >
        {t('debug.syncPurgeRefresh')}
      </Button>
      <Text style={[styles.mono, { color: theme.colors.onSurface, marginTop: 10 }]}>
        {getFirestoreDb() === null
          ? t('debug.syncPurgeNoDb')
          : [
              `${t('debug.syncPurgeRailInboxCloud')}: ${syncPurgeRailCloud === null ? '—' : syncPurgeRailCloud}`,
              `${t('debug.syncPurgeTransitCloud')}: ${syncPurgeTransitCloud === null ? '—' : syncPurgeTransitCloud}`,
              `${t('debug.syncPurgeLastRail')}: ${lastRailPurgeMs != null ? new Date(lastRailPurgeMs).toISOString() : t('debug.syncPurgeNever')}`,
              `${t('debug.syncPurgeLastTransit')}: ${lastTransitPurgeMs != null ? new Date(lastTransitPurgeMs).toISOString() : t('debug.syncPurgeNever')}`,
            ].join('\n')}
      </Text>

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
                  void onValidateDebugProjectPlan();
                }}
                disabled={busy !== null}
              >
                <Text style={styles.planValidateText}>✅ VALIDER LE PLAN</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 40 },
  heroTitle: { fontSize: 24, fontWeight: '800', marginBottom: 4 },
  note: { fontSize: 13, marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  section: { marginBottom: 20 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchRowSecond: { marginTop: 14 },
  switchLabelCol: { flex: 1, minWidth: 0 },
  switchTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  btn: { alignSelf: 'flex-start' },
  btnSecond: { marginTop: 12 },
  help: { fontSize: 12, marginTop: 8, maxWidth: '100%' },
  segment: { marginTop: 10, alignSelf: 'stretch' },
  godRow: { marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btnCompact: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  err: { marginBottom: 12, fontSize: 13 },
  blockTitle: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  mono: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  countLine: { marginTop: 2, marginBottom: 8 },
  rawJson: { marginTop: 10 },
  dbRow: {
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.18)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  dbRowProject: {
    borderColor: 'rgba(0,128,128,0.45)',
    backgroundColor: 'rgba(0,128,128,0.06)',
  },
  dbRowNote: {
    borderColor: 'rgba(255,140,0,0.42)',
    backgroundColor: 'rgba(255,140,0,0.06)',
  },
  dbRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  dbTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 10,
    fontWeight: '800',
  },
  badgeProject: {
    backgroundColor: 'rgba(0,128,128,0.2)',
    color: '#005f5f',
  },
  badgeNote: {
    backgroundColor: 'rgba(255,140,0,0.2)',
    color: '#7c4500',
  },
  dbTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: '#2C3E50' },
  accordionBtn: {
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.22)',
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  accordionText: { fontSize: 12, fontWeight: '700', color: '#2C3E50' },
  subTaskWrap: { marginTop: 8, gap: 6 },
  subTaskRow: {
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.16)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  subTaskTitle: { color: '#2C3E50', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  debugProjectInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(44,62,80,0.2)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 88,
    color: '#2C3E50',
    backgroundColor: 'rgba(255,255,255,0.7)',
    textAlignVertical: 'top',
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
});
