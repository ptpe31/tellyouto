import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from 'react-native-paper';

import { LineConnector, WhatsAppConnector } from '../api/connectors';
import { resetLocalDatabaseSchema } from '../api/localDb';
import { useOnboardingReset } from '../context/OnboardingResetContext';
import { usePower } from '../context/PowerContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { ingestExternalRawMessage } from '../services/externalIntentIngest';
import { palette } from '../theme/colors';

export function DebugScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { spectrum } = useUserSpectrum();
  const power = usePower();
  const { resetProfileToOnboarding } = useOnboardingReset();

  const [busy, setBusy] = useState<
    'profile' | 'db' | 'sim' | 'simLine' | null
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

  const onRebuildDb = useCallback(async () => {
    setLastError(null);
    setBusy('db');
    try {
      await resetLocalDatabaseSchema();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

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
