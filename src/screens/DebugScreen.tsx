import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from 'react-native-paper';

import { showFirebaseProjectIdDebugAlert } from '../components/FirebaseProjectIdDebugAlert';
import { getTrankilV2IntentionTaskCounts } from '../api/trankilV2Db';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import type { TalkCaptureDebugPayload } from '../constants/talkCaptureDebug';
import { askGeminiExpert } from '../services/GeminiExpert';
import { executeFactoryResetDataPlane } from '../services/factoryReset';
import { usePower } from '../context/PowerContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  applyGeminiLocalModelOverride,
  ensureGeminiRemoteModelInitialized,
  forceRefreshGeminiRemoteConfig,
  getActiveGeminiModelId,
  getLastRemoteConfigResolvedModelId,
} from '../services/geminiRemoteModelSteering';
import { runGeminiModelHealthCheck } from '../services/geminiModelHealthCheck';
import { TrafficScheduler, type TrafficMonitoringSnapshot } from '../services/traffic/TrafficScheduler';
import { TrafficSimulator } from '../services/traffic/TrafficSimulator';
import { computeDurationTargetSec } from '../services/traffic/TrafficEngine';
import {
  hydrateDebugUserTierOverride,
  setDebugUserTierOverride,
  type DebugUserTierOverride,
} from '../services/debugUserTierOverride';

export function DebugScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const power = usePower();
  const { spectrum, setProUser } = useUserSpectrum();
  const [busy, setBusy] = useState<
    'db' | 'simElastic' | 'remoteModel' | 'iaHealth' | null
  >(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rcModelDisplay, setRcModelDisplay] = useState<string | null>(null);
  const [localModelDisplay, setLocalModelDisplay] = useState(() => getActiveGeminiModelId());
  const [validatedModelDisplay, setValidatedModelDisplay] = useState<string>('None');
  const [iaCacheBusy, setIaCacheBusy] = useState(false);
  const [talkCaptureLog, setTalkCaptureLog] = useState<TalkCaptureDebugPayload | null>(null);
  const [dbCounts, setDbCounts] = useState({ intentionsCount: 0, tasksCount: 0 });
  const [trafficSnapshot, setTrafficSnapshot] = useState<TrafficMonitoringSnapshot | null>(null);
  const [tierOverride, setTierOverride] = useState<DebugUserTierOverride>(null);
  const simulatorRef = useRef<TrafficSimulator | null>(null);
  const schedulerRef = useRef<TrafficScheduler | null>(null);
  const criticalAlertShownRef = useRef(false);
  const simulatedArrivalAtMsRef = useRef<number>(0);

  const syncModelLabels = useCallback(() => {
    setRcModelDisplay(getLastRemoteConfigResolvedModelId());
    setLocalModelDisplay(getActiveGeminiModelId());
  }, []);

  const refreshValidatedModelDisplay = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('validated_model_id');
      if (!raw) {
        setValidatedModelDisplay('None');
        return;
      }
      const parsed = JSON.parse(raw) as { modelId?: unknown; expiresAtMs?: unknown };
      const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : '';
      const expiresAtMs = Number(parsed.expiresAtMs ?? 0);
      if (!modelId || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        setValidatedModelDisplay('None');
        return;
      }
      setValidatedModelDisplay(modelId);
    } catch {
      setValidatedModelDisplay('None');
    }
  }, []);

  const refreshDbCounts = useCallback(async () => {
    const counts = await getTrankilV2IntentionTaskCounts();
    setDbCounts(counts);
  }, []);

  useEffect(() => {
    void refreshDbCounts();
    const subIntentions = DeviceEventEmitter.addListener(
      INTENTIONS_CHANGED_EVENT_NAME,
      () => {
        void refreshDbCounts();
      },
    );
    const subTalkCapture = DeviceEventEmitter.addListener(
      TALK_CAPTURE_DEBUG_EVENT,
      (payload: TalkCaptureDebugPayload) => {
        setTalkCaptureLog(payload);
      },
    );
    return () => {
      subIntentions.remove();
      subTalkCapture.remove();
    };
  }, [refreshDbCounts]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await ensureGeminiRemoteModelInitialized();
        const override = await hydrateDebugUserTierOverride();
        setTierOverride(override);
        syncModelLabels();
        await refreshValidatedModelDisplay();
      })();
    }, [refreshValidatedModelDisplay, syncModelLabels]),
  );

  useEffect(() => {
    return () => {
      schedulerRef.current?.stop();
      schedulerRef.current = null;
    };
  }, []);

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
        Alert.alert(t('debug.factoryResetSuccessTitle'), t('debug.factoryResetSuccessBody'));
      }, 500);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [power, t]);

  const onRebuildDb = useCallback(() => {
    Alert.alert(t('debug.factoryResetConfirmTitle'), t('debug.factoryResetConfirmBody'), [
      { text: t('debug.factoryResetCancel'), style: 'cancel' },
      {
        text: t('debug.factoryResetContinue'),
        style: 'destructive',
        onPress: () => {
          Alert.alert(t('debug.factoryResetSecondTitle'), t('debug.factoryResetSecondBody'), [
            { text: t('debug.factoryResetCancel'), style: 'cancel' },
            {
              text: t('debug.factoryResetDestructive'),
              style: 'destructive',
              onPress: () => {
                void runFactoryReset();
              },
            },
          ]);
        },
      },
    ]);
  }, [runFactoryReset, t]);

  const onRefreshRemoteGeminiModel = useCallback(async () => {
    setLastError(null);
    setBusy('remoteModel');
    try {
      await forceRefreshGeminiRemoteConfig();
      syncModelLabels();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [syncModelLabels]);

  const onIaHealthCheck = useCallback(async () => {
    setLastError(null);
    setBusy('iaHealth');
    try {
      const result = await runGeminiModelHealthCheck();
      await applyGeminiLocalModelOverride(result.winnerId);
      syncModelLabels();
      await refreshValidatedModelDisplay();
      Alert.alert(
        t('debug.iaHealthTitle'),
        t('debug.iaHealthBody', {
          winner: result.winnerId,
          tested: result.testedCount,
          skipped: result.skippedCount,
          total: result.candidateCount,
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      Alert.alert(t('debug.iaHealthErrorTitle'), msg);
    } finally {
      setBusy(null);
    }
  }, [refreshValidatedModelDisplay, syncModelLabels, t]);

  const onResetIaCache = useCallback(async () => {
    setIaCacheBusy(true);
    try {
      await AsyncStorage.removeItem('validated_model_id');
      await ensureGeminiRemoteModelInitialized();
      syncModelLabels();
      await refreshValidatedModelDisplay();
      Alert.alert('IA', 'Cache réinitialisé');
    } finally {
      setIaCacheBusy(false);
    }
  }, [refreshValidatedModelDisplay, syncModelLabels]);

  const onForce404Test = useCallback(async () => {
    setIaCacheBusy(true);
    try {
      await applyGeminiLocalModelOverride('gemini-unknown-model');
      syncModelLabels();
      await refreshValidatedModelDisplay();
      await askGeminiExpert('test');
      syncModelLabels();
      await refreshValidatedModelDisplay();
      Alert.alert('IA', `OK: ${getActiveGeminiModelId()}`);
    } catch (e) {
      Alert.alert('IA', e instanceof Error ? e.message : String(e));
    } finally {
      setIaCacheBusy(false);
    }
  }, [refreshValidatedModelDisplay, syncModelLabels, t]);

  const onLaunchElasticSimulation = useCallback(async () => {
    setLastError(null);
    setBusy('simElastic');
    try {
      schedulerRef.current?.stop();
      const simulator = new TrafficSimulator();
      simulator.start();
      simulatorRef.current = simulator;
      criticalAlertShownRef.current = false;
      setTrafficSnapshot(null);

      const scheduler = new TrafficScheduler(
        {
          fetchTrafficSample: (task) => simulator.getNextMockTraffic(task),
        },
        {
          askSurveillanceActivation: async () => undefined,
          notifySurveillanceReminder: async () => undefined,
          triggerTopDepart: async () => undefined,
          notifyVigilanceOrange: async () => undefined,
          notifyVigilanceRed: async () => undefined,
        },
        {
          simulationMode: true,
          onMonitoringSnapshot: (snapshot) => {
            setTrafficSnapshot(snapshot);
            simulator.recordLog({
              simulatedNowMs: snapshot.simulatedNowMs,
              realDurationSec: snapshot.rawTrafficDurationSec,
              stabilizedDurationSec: snapshot.stabilizedTrafficDurationSec,
              nextJumpMs: snapshot.nextJumpMs,
              arrivalAtMs: simulatedArrivalAtMsRef.current,
            });
            if (snapshot.status === 'VIGILANCE_RED' && !criticalAlertShownRef.current) {
              criticalAlertShownRef.current = true;
              Alert.alert(t('debug.trafficCriticalTopDepartTitle'));
              simulator.dumpSimulationLogs();
            }
          },
        },
      );
      scheduler.setSimulationMode(true);
      schedulerRef.current = scheduler;
      await scheduler.start();

      const nowSimMs = simulator.getCurrentSimulatedNowMs();
      const arrivalAtMs = nowSimMs + 60 * 60 * 1000;
      simulatedArrivalAtMsRef.current = arrivalAtMs;
      const targetDurationSec = computeDurationTargetSec(25 * 60);

      await scheduler.upsertTripTask({
        id: 'debug_trip_muret_toulouse',
        destination: t('debug.trafficDebugTripDestination'),
        arrivalAtMs,
        status: 'ACTIVE',
        targetDurationSec,
        lastTrafficDuration: 25 * 60,
        internalScanCount: 0,
      });
      await scheduler.performTrafficCheck('debug_trip_muret_toulouse');
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const onApplyTierOverride = useCallback(
    async (next: DebugUserTierOverride) => {
      await setDebugUserTierOverride(next);
      setTierOverride(next);
      if (next === 'force_free') {
        await setProUser(false);
      } else if (next === 'force_pro') {
        await setProUser(true);
      }
    },
    [setProUser],
  );

  const rcLabel =
    rcModelDisplay === null
      ? t('debug.rcModelUnavailable')
      : t('debug.rcModelValue', { modelId: rcModelDisplay });
  const localOverrides =
    rcModelDisplay !== null && localModelDisplay !== rcModelDisplay;
  const tierLabelKey =
    tierOverride === 'force_free'
      ? 'debug.simUserModeFree'
      : tierOverride === 'force_pro'
        ? 'debug.simUserModePro'
        : 'debug.simUserModeReal';
  const effectiveTierKey = spectrum.isProUser ? 'debug.simUserModePro' : 'debug.simUserModeFree';

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
        {t('debug.pilotTitle')}
      </Text>
      <Text style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>{t('debug.note')}</Text>

      <View style={styles.section}>
        <View style={styles.iaCachePanel}>
          <View style={styles.iaCacheRow}>
            <Button mode="contained" onPress={() => void onResetIaCache()} disabled={iaCacheBusy}>
              Reset IA Cache
            </Button>
            <Text style={styles.iaCacheLabel}>Cache: {validatedModelDisplay}</Text>
          </View>
          <Button mode="outlined" onPress={() => void onForce404Test()} disabled={iaCacheBusy}>
            Force 404 Test
          </Button>
        </View>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.dashboardSectionPilotageIa')}
        </Text>
        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          {t('debug.simUserModeTitle', { tier: t(tierLabelKey) })}
        </Text>
        <View style={styles.godRow}>
          <Button
            mode={tierOverride === 'force_free' ? 'contained' : 'outlined'}
            onPress={() => void onApplyTierOverride('force_free')}
            disabled={busy !== null}
            style={styles.btnCompact}
          >
            {t('debug.simUserModeFree')}
          </Button>
          <Button
            mode={tierOverride === 'force_pro' ? 'contained' : 'outlined'}
            onPress={() => void onApplyTierOverride('force_pro')}
            disabled={busy !== null}
            style={styles.btnCompact}
          >
            {t('debug.simUserModePro')}
          </Button>
          <Button
            mode={tierOverride === null ? 'contained-tonal' : 'outlined'}
            onPress={() => void onApplyTierOverride(null)}
            disabled={busy !== null}
            style={styles.btnCompact}
          >
            {t('debug.simUserModeReal')}
          </Button>
        </View>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.simUserModeHelp', { effective: t(effectiveTierKey) })}
        </Text>
        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          {t('debug.rcModelCaption')}
        </Text>
        <Text style={[styles.mono, { color: theme.colors.onSurface }]}>{rcLabel}</Text>
        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          {t('debug.localModelCaption')}
        </Text>
        <Text style={[styles.mono, { color: theme.colors.onSurface }]}>
          {t('debug.localModelValue', { modelId: localModelDisplay })}
        </Text>
        {localOverrides ? (
          <Text style={[styles.help, { color: theme.colors.secondary }]}>
            {t('debug.localOverridesRcHint')}
          </Text>
        ) : null}
        <View style={styles.godRow}>
          <Button
            mode="contained-tonal"
            onPress={() => void onRefreshRemoteGeminiModel()}
            disabled={busy !== null}
            style={styles.btnCompact}
          >
            {t('debug.geminiRemoteModelRefresh')}
          </Button>
          <Button
            mode="contained"
            onPress={() => void onIaHealthCheck()}
            disabled={busy !== null}
            style={styles.btnCompact}
          >
            {t('debug.iaHealthButton')}
          </Button>
        </View>
        <Button
          mode="outlined"
          onPress={showFirebaseProjectIdDebugAlert}
          style={[styles.btn, styles.btnSecond]}
        >
          {t('debug.firebaseProjectIdButton')}
        </Button>

        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          {t('debug.oneTapPerfTitle')}
        </Text>
        {!talkCaptureLog?.oneTapPerfMs ? (
          <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
            {t('debug.oneTapPerfEmpty')}
          </Text>
        ) : (
          <>
            <Text style={[styles.mono, { color: theme.colors.onSurfaceVariant }]}>
              {t('debug.oneTapPerfT0', { ms: talkCaptureLog.oneTapPerfMs.t0 })}
            </Text>
            <Text style={[styles.mono, { color: theme.colors.onSurfaceVariant }]}>
              {t('debug.oneTapPerfT1', { ms: talkCaptureLog.oneTapPerfMs.t1 })}
            </Text>
            <Text style={[styles.mono, { color: theme.colors.onSurfaceVariant }]}>
              {t('debug.oneTapPerfT3', { ms: talkCaptureLog.oneTapPerfMs.t3 })}
            </Text>
            <Text style={[styles.mono, { color: theme.colors.onSurfaceVariant }]}>
              {t('debug.oneTapPerfGemini', { ms: talkCaptureLog.oneTapPerfMs.geminiMs })}
            </Text>
            <Text style={[styles.mono, { color: theme.colors.onSurfaceVariant }]}>
              {t('debug.oneTapPerfTotal', { ms: talkCaptureLog.oneTapPerfMs.totalFromT1Ms })}
            </Text>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.dashboardSectionFluxTraffic')}
        </Text>
        <Button
          mode="contained"
          onPress={() => void onLaunchElasticSimulation()}
          disabled={busy !== null}
          style={styles.btn}
          buttonColor="#7c3aed"
        >
          {t('debug.trafficLaunchElastic')}
        </Button>
        {trafficSnapshot ? (
          <View style={styles.trafficMonitorPanel}>
            <Text style={styles.trafficMonitorTitle}>{t('debug.trafficMonitorTitle')}</Text>
            <Text style={styles.trafficMonitorLine}>
              {t('debug.trafficSimulatedTime', {
                time: new Date(trafficSnapshot.simulatedNowMs).toLocaleTimeString(),
              })}
            </Text>
            <Text style={styles.trafficMonitorLine}>
              {t('debug.trafficNextJump', { sec: (trafficSnapshot.nextJumpMs / 1000).toFixed(1) })}
            </Text>
            <Text style={styles.trafficMonitorLine}>
              {t('debug.trafficEmaMin', {
                min: Math.round(trafficSnapshot.stabilizedTrafficDurationSec / 60),
              })}
            </Text>
            <Text style={styles.trafficMonitorLine}>
              {t('debug.trafficStatusLabel')}{' '}
              {trafficSnapshot.status}
            </Text>
            <Text style={styles.trafficMonitorLine}>
              {t('debug.trafficBufferSafety', { min: trafficSnapshot.bufferSafetyMin.toFixed(2) })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.dashboardSectionSysteme')}
        </Text>
        <Text style={[styles.mono, styles.countLine, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.sqliteCountsLine', {
            intentions: dbCounts.intentionsCount,
            tasks: dbCounts.tasksCount,
          })}
        </Text>
        <Button mode="outlined" onPress={onRebuildDb} disabled={busy !== null} style={styles.btn}>
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
            {busy === 'db'
              ? t('debug.busySqlite')
              : busy === 'simElastic'
                ? t('debug.busySimElastic')
                : busy === 'remoteModel'
                  ? t('debug.busyRemoteModel')
                  : busy === 'iaHealth'
                    ? t('debug.busyIaHealth')
                    : ''}
          </Text>
        </View>
      )}

      {lastError !== null && (
        <Text style={[styles.err, { color: theme.colors.error }]} selectable>
          {lastError}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 40 },
  heroTitle: { fontSize: 24, fontWeight: '800', marginBottom: 4 },
  note: { fontSize: 13, marginBottom: 20 },
  iaCachePanel: {
    backgroundColor: '#fde2e4',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  iaCacheRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  iaCacheLabel: { fontSize: 12, color: '#6b7280' },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  section: { marginBottom: 20 },
  btn: { alignSelf: 'flex-start' },
  btnSecond: { marginTop: 12 },
  help: { fontSize: 12, marginTop: 8, maxWidth: '100%' },
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
  trafficMonitorPanel: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
    backgroundColor: 'rgba(124,58,237,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  trafficMonitorTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#5b21b6',
    marginBottom: 2,
  },
  trafficMonitorLine: {
    fontSize: 12,
    color: '#2C3E50',
    fontFamily: 'monospace',
  },
});
