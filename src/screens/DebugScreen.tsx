import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Switch, useTheme } from 'react-native-paper';
import { collection, getDocs, limit, query } from 'firebase/firestore';

import { CalendarGranularSection } from '../components';
import { LineConnector, WhatsAppConnector } from '../api/connectors';
import {
  deleteAllIntentions,
  insertIntention,
  intentionRowToDebugSnapshot,
  listIntentionsDescending,
  LOCAL_DB_RESET_EVENT,
} from '../api/localDb';
import { ensureFirebaseAnonymousAuth, getFirestoreDb } from '../api/firebase';
import { getOrCreateDeviceId, syncPendingIntentions } from '../api/syncService';
import {
  DEBUG_LAST_RAIL_INBOX_PURGE_MS,
  DEBUG_LAST_TRANSIT_INTENTION_PURGE_MS,
} from '../config/transitPurgeKeys';
import { executeFactoryResetDataPlane } from '../services/factoryReset';
import { useOnboardingReset } from '../context/OnboardingResetContext';
import { usePower } from '../context/PowerContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { ingestExternalRawMessage } from '../services/externalIntentIngest';
import { seedDemoTypicalDay } from '../services/demoTypicalDay';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { scheduleDebugAgentDirectAlarmIn10Minutes } from '../services/alarmManager';
import { palette } from '../theme/colors';

export function DebugScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { spectrum, setProUser } = useUserSpectrum();
  const power = usePower();
  const { resetProfileToOnboarding } = useOnboardingReset();
  const [busy, setBusy] = useState<
    | 'profile'
    | 'db'
    | 'sim'
    | 'simLine'
    | 'demoDay'
    | 'simWaIntent'
    | 'purgeIntentions'
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

  useEffect(() => {
    void refreshRawIntentions();
    void refreshSyncPurge();
    const subIntentions = DeviceEventEmitter.addListener(
      INTENTIONS_CHANGED_EVENT,
      () => {
        void refreshRawIntentions();
        void refreshSyncPurge();
      },
    );
    const subReset = DeviceEventEmitter.addListener(
      LOCAL_DB_RESET_EVENT,
      () => void refreshRawIntentions(),
    );
    return () => {
      subIntentions.remove();
      subReset.remove();
    };
  }, [refreshRawIntentions, refreshSyncPurge]);

  const onResetProfile = useCallback(async () => {
    setLastError(null);
    setBusy('profile');
    try {
      await resetProfileToOnboarding();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [resetProfileToOnboarding]);

  const runFactoryReset = useCallback(async () => {
    setLastError(null);
    setBusy('db');
    try {
      const { health } = await executeFactoryResetDataPlane();
      await resetProfileToOnboarding();
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
  }, [resetProfileToOnboarding, t]);

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
    spectrum.platform_user_id?.trim() || 'tellyouto_local_sim';

  const onSimWhatsApp = useCallback(async () => {
    setLastError(null);
    setBusy('sim');
    try {
      const res = await ingestExternalRawMessage({
        raw: t('debug.simSampleRaw'),
        connector: WhatsAppConnector,
        externalUserId: externalSenderId,
        spectrum,
      });
      if (!res.ok && res.error === 'user_id_mismatch') {
        setLastError(t('debug.simErrorUser'));
      }
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
        title: 'Test WhatsApp',
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
        raw_transcript: 'Test WhatsApp (simulation debug)',
        energy_score: 0.72,
      });
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT);
      void syncPendingIntentions();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [spectrum]);

  const onSimLine = useCallback(async () => {
    setLastError(null);
    setBusy('simLine');
    try {
      const res = await ingestExternalRawMessage({
        raw: t('debug.simLineRaw'),
        connector: LineConnector,
        externalUserId: externalSenderId,
        spectrum,
      });
      if (!res.ok && res.error === 'user_id_mismatch') {
        setLastError(t('debug.simErrorUser'));
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [externalSenderId, spectrum, t]);

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
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('debug.calendarSection')}
        </Text>
        <CalendarGranularSection />
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
          onPress={onSimWhatsApp}
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
        <Button
          mode="outlined"
          onPress={onSimLine}
          disabled={busy !== null}
          style={[styles.btn, styles.btnSecond]}
        >
          {t('debug.simLine')}
        </Button>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.simLineHelp')}
        </Text>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  err: { marginBottom: 12, fontSize: 13 },
  blockTitle: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  mono: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  rawJson: { marginTop: 10 },
});
