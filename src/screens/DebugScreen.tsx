import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Platform,
  Pressable,
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
import {
  getTrankilV2IntentionTaskCounts,
  rebuildTrankilV2IntentionsTableForDebug,
  withTrankilV2Database,
} from '../api/trankilV2Db';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import type { TalkCaptureDebugPayload } from '../constants/talkCaptureDebug';
import { askGeminiExpert } from '../services/GeminiExpert';
import { showAppToast } from '../services/appToast';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  applyGeminiLocalModelOverride,
  clearGeminiValidatedModelCache,
  ensureGeminiRemoteModelInitialized,
  GEMINI_DEBUG_OVERRIDE_STORAGE_KEY,
  forceRefreshGeminiRemoteConfig,
  getActivePass1ModelId,
  getActivePass2ModelId,
  getResolvedPass1ModelFromRemoteConfig,
  getResolvedPass2ModelFromRemoteConfig,
} from '../services/geminiRemoteModelSteering';
import { runGeminiModelHealthCheck } from '../services/geminiModelHealthCheck';
import {
  clearBatteryPermissionRequestedFlag,
  requestIgnoreBatteryOptimizationAndroid,
} from '../services/PermissionService';
import { TrafficScheduler, type TrafficMonitoringSnapshot } from '../services/traffic/TrafficScheduler';
import { TrafficSimulator } from '../services/traffic/TrafficSimulator';
import { computeDurationTargetSec } from '../services/traffic/TrafficEngine';
import {
  hydrateDebugUserTierOverride,
  setDebugUserTierOverride,
  type DebugUserTierOverride,
} from '../services/debugUserTierOverride';
import { neumorphicRaised } from '../theme/neumorphism';
import { useAppTheme } from '../context/ThemeContext';
import { useDesignTokens, type ZenTypography } from '../hooks/useDesignTokens';
import {
  ALL_TIMELINE_LAYOUT_MODES,
  type TimelineLayoutMode,
} from '../features/livingHub/timelineLayoutRegistry';
import {
  ALL_DESIGN_VARIANTS,
  DESIGN_VARIANT_LABELS,
  type DesignVariant,
} from '../theme/TalkThemeRegistry';

/**
 * Onglet **Debug** : reset / vidage SQLite, comptages, steering Gemini (Remote Config, health check, cache),
 * simulation **Sentinel** traffic, override tier utilisateur, écoute `TALK_CAPTURE_DEBUG_EVENT`.
 * Voir `PROJECT_STATUS.md` §1.2.
 *
 * @module DebugScreen
 */

export function DebugScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { designVariant, setDesignVariant, timelineLayoutMode, setTimelineLayoutMode } = useAppTheme();
  const designTokens = useDesignTokens();
  const { typography } = designTokens;
  const styles = useMemo(() => createDebugScreenStyles(typography), [typography]);
  const { spectrum, setProUser } = useUserSpectrum();
  const [busy, setBusy] = useState<
    'db' | 'simElastic' | 'remoteModel' | 'iaHealth' | null
  >(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rcPass1Display, setRcPass1Display] = useState<string | null>(null);
  const [rcPass2Display, setRcPass2Display] = useState<string | null>(null);
  const [localPass1Display, setLocalPass1Display] = useState(() => getActivePass1ModelId());
  const [localPass2Display, setLocalPass2Display] = useState(() => getActivePass2ModelId());
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

  /** Met à jour les libellés modèles RC vs effectifs Pass1/Pass2. */
  const syncModelLabels = useCallback(() => {
    setRcPass1Display(getResolvedPass1ModelFromRemoteConfig());
    setRcPass2Display(getResolvedPass2ModelFromRemoteConfig());
    setLocalPass1Display(getActivePass1ModelId());
    setLocalPass2Display(getActivePass2ModelId());
  }, []);

  /** Lit le cache RC ou l'override Debug persisté (AsyncStorage) pour affichage debug. */
  const refreshValidatedModelDisplay = useCallback(async () => {
    try {
      const readEntry = async (key: string): Promise<string | null> => {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { modelId?: unknown; expiresAtMs?: unknown };
        const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : '';
        const expiresAtMs = Number(parsed.expiresAtMs ?? 0);
        if (!modelId || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
        return modelId;
      };

      const debugModel = await readEntry(GEMINI_DEBUG_OVERRIDE_STORAGE_KEY);
      if (debugModel) {
        setValidatedModelDisplay(`${debugModel} (debug override Pass2)`);
        return;
      }

      setValidatedModelDisplay('None');
    } catch {
      setValidatedModelDisplay('None');
    }
  }, []);

  /** Compte intentions / tâches via `getTrankilV2IntentionTaskCounts`. */
  const refreshDbCounts = useCallback(async () => {
    const counts = await getTrankilV2IntentionTaskCounts();
    setDbCounts(counts);
  }, []);

  /** Au montage : compteurs DB + abonnements `INTENTIONS_CHANGED` et log capture Talk (`TALK_CAPTURE_DEBUG_EVENT`). */
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

  /** Rebuild destructif de la table `intentions` (outil dev uniquement). */
  const runFactoryReset = useCallback(async () => {
    setLastError(null);
    setBusy('db');
    try {
      await rebuildTrankilV2IntentionsTableForDebug();
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      void refreshDbCounts();
      setTimeout(() => {
        Alert.alert(t('debug.factoryResetSuccessTitle'), t('debug.factoryResetSuccessBody'));
      }, 500);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [refreshDbCounts, t]);

  /** `DELETE FROM intentions` — garde le schéma, vide les lignes. */
  const runClearDatabases = useCallback(async () => {
    setLastError(null);
    setBusy('db');
    try {
      await withTrankilV2Database(async (db) => {
        await db.execAsync(`DELETE FROM intentions;`);
      });
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
      void refreshDbCounts();
      console.log('[DATABASE] 🧹 Base vidée avec succès');
      showAppToast('[DATABASE] 🧹 Base vidée avec succès', 1200);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [refreshDbCounts]);

  /** Double confirmation puis `runFactoryReset`. */
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

  /** Confirmation puis vidage des intentions. */
  const onClearDb = useCallback(() => {
    Alert.alert(t('debug.clearDbConfirmTitle'), t('debug.clearDbConfirmBody'), [
      { text: t('debug.clearDbCancel'), style: 'cancel' },
      { text: t('debug.clearDbConfirm'), style: 'destructive', onPress: () => void runClearDatabases() },
    ]);
  }, [runClearDatabases, t]);

  const onSelectDesignVariant = useCallback(
    (variant: DesignVariant) => {
      void setDesignVariant(variant);
    },
    [setDesignVariant],
  );

  const onSelectTimelineLayoutMode = useCallback(
    (mode: TimelineLayoutMode) => {
      void setTimelineLayoutMode(mode);
    },
    [setTimelineLayoutMode],
  );

  const timelineLayoutLabel = useCallback(
    (mode: TimelineLayoutMode) =>
      mode === 'EMAIL_HUB' ? t('debug.timelineLayoutEmailHub') : t('debug.timelineLayoutCurrent'),
    [t],
  );

  /** Force un refresh Remote Config / shortlist modèles Gemini. */
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

  /** Lance `runGeminiModelHealthCheck`, applique le gagnant en override local. */
  const onIaHealthCheck = useCallback(async () => {
    setLastError(null);
    setBusy('iaHealth');
    try {
      const result = await runGeminiModelHealthCheck();
      await applyGeminiLocalModelOverride(result.pass2WinnerId);
      syncModelLabels();
      await refreshValidatedModelDisplay();
      Alert.alert(
        t('debug.iaHealthTitle'),
        t('debug.iaHealthBody', {
          pass1: result.pass1Id,
          pass1Ok: result.pass1Ok ? 'OK' : 'KO',
          pass2: result.pass2WinnerId,
          tested: result.pass2TestedCount,
          skipped: result.pass2SkippedCount,
          total: result.pass2CandidateCount,
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

  /** Supprime le cache « validated model » + réinit steering. */
  const onResetIaCache = useCallback(async () => {
    setIaCacheBusy(true);
    try {
      await clearGeminiValidatedModelCache();
      await ensureGeminiRemoteModelInitialized();
      syncModelLabels();
      await refreshValidatedModelDisplay();
      Alert.alert('IA', 'Cache réinitialisé');
    } finally {
      setIaCacheBusy(false);
    }
  }, [refreshValidatedModelDisplay, syncModelLabels]);

  /** Force un modèle invalide pour tester self-healing / fallback steering. */
  const onForce404Test = useCallback(async () => {
    setIaCacheBusy(true);
    try {
      await applyGeminiLocalModelOverride('gemini-unknown-model');
      syncModelLabels();
      await refreshValidatedModelDisplay();
      await askGeminiExpert('test');
      syncModelLabels();
      await refreshValidatedModelDisplay();
      Alert.alert('IA', `OK Pass2: ${getActivePass2ModelId()}`);
    } catch (e) {
      Alert.alert('IA', e instanceof Error ? e.message : String(e));
    } finally {
      setIaCacheBusy(false);
    }
  }, [refreshValidatedModelDisplay, syncModelLabels, t]);

  /** Démarre `TrafficSimulator` + `TrafficScheduler` en mode simulation (debug Sentinel). */
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

  /** Réinitialise le flag batterie Android pour retester la modale système. */
  const onResetBatteryPermissionFlag = useCallback(async () => {
    try {
      await clearBatteryPermissionRequestedFlag();
      await requestIgnoreBatteryOptimizationAndroid();
      showAppToast(t('debug.batteryPermissionResetDone'));
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  /** Simule Free / Pro côté client (`debugUserTierOverride` + `UserSpectrum`). */
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

  const rcPass1Label =
    rcPass1Display === null
      ? t('debug.rcModelUnavailable')
      : t('debug.rcModelValue', { modelId: rcPass1Display });
  const rcPass2Label =
    rcPass2Display === null
      ? t('debug.rcModelUnavailable')
      : t('debug.rcModelValue', { modelId: rcPass2Display });
  const localPass2OverridesRc =
    rcPass2Display !== null && localPass2Display !== rcPass2Display;
  const tierLabelKey =
    tierOverride === 'force_free'
      ? 'debug.simUserModeFree'
      : tierOverride === 'force_pro'
        ? 'debug.simUserModePro'
        : 'debug.simUserModeReal';
  const effectiveTierKey = spectrum.isProUser ? 'debug.simUserModePro' : 'debug.simUserModeFree';

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: designTokens.backgroundColor }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.heroTitle, { color: designTokens.textPrimary }]}>
        {t('debug.pilotTitle')}
      </Text>
      <Text style={[styles.note, { color: designTokens.textSecondary }]}>{t('debug.note')}</Text>

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
          {t('debug.rcPass1Caption')}
        </Text>
        <Text style={[styles.mono, { color: theme.colors.onSurface }]}>{rcPass1Label}</Text>
        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          {t('debug.rcPass2Caption')}
        </Text>
        <Text style={[styles.mono, { color: theme.colors.onSurface }]}>{rcPass2Label}</Text>
        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          {t('debug.localPass1Caption')}
        </Text>
        <Text style={[styles.mono, { color: theme.colors.onSurface }]}>
          {t('debug.localModelValue', { modelId: localPass1Display })}
        </Text>
        <Text style={[styles.blockTitle, { color: theme.colors.onBackground }]}>
          {t('debug.localPass2Caption')}
        </Text>
        <Text style={[styles.mono, { color: theme.colors.onSurface }]}>
          {t('debug.localModelValue', { modelId: localPass2Display })}
        </Text>
        {localPass2OverridesRc ? (
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
        {Platform.OS === 'android' ? (
          <Button
            mode="outlined"
            onPress={() => void onResetBatteryPermissionFlag()}
            disabled={busy !== null}
            style={styles.btn}
          >
            {t('debug.batteryPermissionReset')}
          </Button>
        ) : null}
        <Button mode="outlined" onPress={onRebuildDb} disabled={busy !== null} style={styles.btn}>
          {t('debug.rebuildDb')}
        </Button>
        <Pressable
          accessibilityRole="button"
          onPress={onClearDb}
          disabled={busy !== null}
          style={({ pressed }) => [
            neumorphicRaised(theme),
            styles.neoBtn,
            {
              borderWidth: 1,
              borderColor: theme.colors.outlineVariant,
              backgroundColor: theme.colors.surface,
              opacity: busy !== null ? 0.55 : pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text style={[styles.neoBtnText, { color: theme.colors.onSurface }]}>{t('debug.clearDb')}</Text>
        </Pressable>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.rebuildDbHelp')}
        </Text>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.clearDbHelp')}
        </Text>

        <View
          style={[
            designTokens.cardShadowStyle,
            styles.themeShowroomPanel,
            {
              borderRadius: designTokens.borderRadius,
              backgroundColor: designTokens.cardBackground,
              borderColor: designTokens.accentColor,
            },
          ]}
        >
          <Text style={[styles.themeShowroomTitle, { color: designTokens.textPrimary }]}>
            🎨 EXPLORATION GRAPHIQUE (TEST THÈMES)
          </Text>
          <Text style={[styles.themeShowroomHint, { color: designTokens.textSecondary }]}>
            Bascule instantanée — variante persistée localement. Rollback : « Actuel (TellYouTo) ».
          </Text>
          <View style={styles.themeVariantGrid}>
            {ALL_DESIGN_VARIANTS.map((variant) => {
              const selected = designVariant === variant;
              return (
                <Pressable
                  key={variant}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelectDesignVariant(variant)}
                  style={({ pressed }) => [
                    styles.themeVariantBtn,
                    {
                      borderRadius: designTokens.borderRadius * 0.5,
                      borderColor: selected ? designTokens.accentColor : designTokens.textSecondary,
                      backgroundColor: selected
                        ? `${designTokens.accentColor}22`
                        : designTokens.backgroundColor,
                    },
                    { opacity: pressed ? 0.88 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.themeVariantBtnLabel,
                      { color: selected ? designTokens.accentColor : designTokens.textPrimary },
                    ]}
                    numberOfLines={2}
                  >
                    {DESIGN_VARIANT_LABELS[variant]}
                  </Text>
                  <Text style={[styles.themeVariantBtnCode, { color: designTokens.textSecondary }]}>
                    {variant}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={[
            designTokens.cardShadowStyle,
            styles.themeShowroomPanel,
            {
              borderRadius: designTokens.borderRadius,
              backgroundColor: designTokens.cardBackground,
              borderColor: designTokens.accentColor,
            },
          ]}
        >
          <Text style={[styles.themeShowroomTitle, { color: designTokens.textPrimary }]}>
            {t('debug.timelineLayoutTitle')}
          </Text>
          <Text style={[styles.themeShowroomHint, { color: designTokens.textSecondary }]}>
            {t('debug.timelineLayoutHint')}
          </Text>
          <View style={styles.timelineLayoutRow}>
            {ALL_TIMELINE_LAYOUT_MODES.map((mode) => {
              const selected = timelineLayoutMode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelectTimelineLayoutMode(mode)}
                  style={({ pressed }) => [
                    styles.timelineLayoutBtn,
                    {
                      borderRadius: designTokens.borderRadius * 0.5,
                      borderColor: selected ? designTokens.accentColor : designTokens.textSecondary,
                      backgroundColor: selected
                        ? `${designTokens.accentColor}22`
                        : designTokens.backgroundColor,
                    },
                    { opacity: pressed ? 0.88 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.themeVariantBtnLabel,
                      { color: selected ? designTokens.accentColor : designTokens.textPrimary },
                    ]}
                    numberOfLines={2}
                  >
                    {timelineLayoutLabel(mode)}
                  </Text>
                  <Text style={[styles.themeVariantBtnCode, { color: designTokens.textSecondary }]}>
                    {mode}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
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

function createDebugScreenStyles(typography: ZenTypography) {
  return StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 40 },
  heroTitle: { fontSize: typography.hero, fontWeight: '800', marginBottom: 4 },
  note: { fontSize: typography.bodySmall, marginBottom: 20 },
  iaCachePanel: {
    backgroundColor: '#fde2e4',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  iaCacheRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  iaCacheLabel: { fontSize: typography.label, color: '#6b7280' },
  sectionTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  section: { marginBottom: 20 },
  btn: { alignSelf: 'flex-start' },
  btnSecond: { marginTop: 12 },
  neoBtn: {
    alignSelf: 'flex-start',
    marginTop: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  neoBtnText: { fontSize: typography.body, fontWeight: '800' },
  help: { fontSize: typography.label, marginTop: 8, maxWidth: '100%' },
  godRow: { marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btnCompact: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  err: { marginBottom: 12, fontSize: typography.bodySmall },
  blockTitle: { fontSize: typography.body, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  mono: { fontFamily: 'monospace', fontSize: typography.caption, lineHeight: 16 },
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
    fontSize: typography.bodySmall,
    fontWeight: '800',
    color: '#5b21b6',
    marginBottom: 2,
  },
  trafficMonitorLine: {
    fontSize: typography.label,
    color: '#2C3E50',
    fontFamily: 'monospace',
  },
  themeShowroomPanel: {
    marginTop: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  themeShowroomTitle: {
    fontSize: typography.bodyLarge,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  themeShowroomHint: {
    fontSize: typography.label,
    lineHeight: 17,
  },
  themeVariantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeVariantBtn: {
    width: '48%',
    minWidth: 140,
    flexGrow: 1,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  themeVariantBtnLabel: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  themeVariantBtnCode: {
    marginTop: 4,
    fontSize: typography.caption,
    fontFamily: 'monospace',
    opacity: 0.85,
  },
  timelineLayoutRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timelineLayoutBtn: {
    width: '48%',
    minWidth: 140,
    flexGrow: 1,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  });
}
