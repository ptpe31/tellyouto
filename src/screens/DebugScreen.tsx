import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';

import { resetLocalDatabaseSchema } from '../api/localDb';
import { useOnboardingReset } from '../context/OnboardingResetContext';
import { usePower } from '../context/PowerContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';

export function DebugScreen() {
  const theme = useTheme();
  const { spectrum } = useUserSpectrum();
  const power = usePower();
  const { resetProfileToOnboarding } = useOnboardingReset();

  const [busy, setBusy] = useState<'profile' | 'db' | null>(null);
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

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        Debug
      </Text>
      <Text style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
        Outil interne — pas de polish UI.
      </Text>

      <View style={styles.section}>
        <Button
          mode="contained"
          onPress={onResetProfile}
          disabled={busy !== null}
          style={styles.btn}
        >
          Réinitialiser le profil
        </Button>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          Efface onboarding_complete et user_spectrum (AsyncStorage), puis
          retour à l’onboarding des 5 situations.
        </Text>
      </View>

      <View style={styles.section}>
        <Button
          mode="outlined"
          onPress={onRebuildDb}
          disabled={busy !== null}
          style={styles.btn}
        >
          Reconstruire la base de données
        </Button>
        <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
          DROP des tables SQLite puis CREATE (localDb). Les écrans qui lisent
          la DB se rafraîchissent via événement (ex. Radar).
        </Text>
      </View>

      {busy !== null && (
        <View style={styles.row}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={{ color: theme.colors.onSurface, marginLeft: 8 }}>
            {busy === 'profile' ? 'Réinitialisation profil…' : 'SQLite…'}
          </Text>
        </View>
      )}

      {lastError !== null && (
        <Text style={[styles.err, { color: theme.colors.error }]} selectable>
          {lastError}
        </Text>
      )}

      <Text style={[styles.blockTitle, { color: theme.colors.primary }]}>
        UserSpectrumContext (brut)
      </Text>
      <Text
        style={[styles.mono, { color: theme.colors.onSurface }]}
        selectable
      >
        {JSON.stringify(spectrum, null, 2)}
      </Text>

      <Text style={[styles.blockTitle, { color: theme.colors.primary }]}>
        PowerContext (brut)
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
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  note: { fontSize: 13, marginBottom: 20 },
  section: { marginBottom: 20 },
  btn: { alignSelf: 'flex-start' },
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
