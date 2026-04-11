import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { NeumorphicCard } from '../components';
import { useUserSpectrum } from '../context/UserSpectrumContext';

export function StatsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { spectrum } = useUserSpectrum();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        {t('tabs.stats')}
      </Text>
      <NeumorphicCard>
        <Text style={{ color: theme.colors.onSurface }}>
          Plateforme : {spectrum.platform_type} · id :{' '}
          {spectrum.platform_user_id || '—'}
        </Text>
      </NeumorphicCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
});
