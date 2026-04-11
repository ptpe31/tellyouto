import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { NeumorphicCard } from '../components';
import { usePower } from '../context/PowerContext';

export function AgentIAScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { energyScore, isLowPower } = usePower();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        {t('tabs.agent')}
      </Text>
      <NeumorphicCard>
        <Text style={{ color: theme.colors.onSurface }}>
          Énergie disponible : {(energyScore * 100).toFixed(0)}% · Low power :{' '}
          {isLowPower ? 'oui' : 'non'}
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
