import { randomUUID } from 'expo-crypto';
import React, { useCallback, useState } from 'react';
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
import { Button, useTheme } from 'react-native-paper';

import { CalendarGranularSection } from '../components';
import { LineConnector, WhatsAppConnector } from '../api/connectors';
import { insertIntention } from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { executeFactoryResetDataPlane } from '../services/factoryReset';
import { useOnboardingReset } from '../context/OnboardingResetContext';
import { usePower } from '../context/PowerContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { ingestExternalRawMessage } from '../services/externalIntentIngest';
import { seedDemoTypicalDay } from '../services/demoTypicalDay';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { palette } from '../theme/colors';

export function DebugScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { spectrum } = useUserSpectrum();
  const power = usePower();
  const { resetProfileToOnboarding } = useOnboardingReset();
  const [busy, setBusy] = useState<
    | 'profile'
    | 'db'
    | 'sim'
    | 'simLine'
    | 'demoDay'
    | 'simWaIntent'
    | null
  >(null);
  const [lastError, setLastError] = useState<string | null>(null);

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
});
