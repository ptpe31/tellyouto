import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import { NeumorphicCard } from './NeumorphicCard';
import type { SpectrumAxis } from '../services/dayStats';

type Props = {
  sessionCount: number;
  clarityPercent: number;
  dominant: SpectrumAxis | null;
  isLowPower: boolean;
  energyScore: number;
};

export function AgentInsight({
  sessionCount,
  clarityPercent,
  dominant,
  isLowPower,
  energyScore,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (sessionCount === 0) {
    return (
      <NeumorphicCard style={styles.card}>
        <Text style={[styles.body, { color: theme.colors.onSurface }]}>
          {t('stats.insightEmpty')}
        </Text>
      </NeumorphicCard>
    );
  }

  const axisLabel = dominant
    ? t(`stats.axis.${dominant}`)
    : t('stats.axis.structure');

  return (
    <NeumorphicCard style={styles.card}>
      <Text style={[styles.kicker, { color: theme.colors.primary }]}>
        {t('stats.insightKicker')}
      </Text>
      <Text style={[styles.body, { color: theme.colors.onSurface }]}>
        {t('stats.insightLead', { axis: axisLabel })}
      </Text>
      <Text style={[styles.body, { color: theme.colors.onSurface, marginTop: 10 }]}>
        {t('stats.insightClarity', { score: clarityPercent })}
      </Text>
      {sessionCount <= 2 && (
        <Text style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
          {t('stats.insightShort')}
        </Text>
      )}
      <Text
        style={[
          styles.body,
          {
            color: theme.colors.onSurface,
            marginTop: sessionCount <= 2 ? 10 : 10,
          },
        ]}
      >
        {isLowPower || energyScore < 0.35
          ? t('stats.insightEnergyLow')
          : t('stats.insightEnergyOk')}
      </Text>
    </NeumorphicCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 4 },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  body: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 13, lineHeight: 20, marginTop: 8, fontStyle: 'italic' },
});
