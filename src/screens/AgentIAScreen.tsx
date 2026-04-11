import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import { NeumorphicCard } from '../components';
import type { AgentStackParamList } from '../navigation/AgentStack';
import { useAlly } from '../context/AllyContext';
import { useLanguage } from '../context/LanguageContext';
import { usePower } from '../context/PowerContext';

export function AgentIAScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<AgentStackParamList>>();
  const { energyScore, isLowPower, agentEnergySeconds } = usePower();
  const { voice, tone } = useAlly();
  const { interactionLanguage } = useLanguage();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>
          {t('tabs.agent')}
        </Text>
        <Pressable
          onPress={() => navigation.navigate('AgentSettings')}
          style={({ pressed }) => [
            styles.gear,
            { opacity: pressed ? 0.75 : 1, borderColor: theme.colors.outline },
          ]}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
            {t('ally.openSettings')}
          </Text>
        </Pressable>
      </View>

      <NeumorphicCard>
        <Text style={{ color: theme.colors.onSurface }}>
          {t('agent.energyLine', {
            pct: (energyScore * 100).toFixed(0),
            low: isLowPower ? t('agent.yes') : t('agent.no'),
          })}
        </Text>
        <Text style={[styles.subLine, { color: theme.colors.onSurfaceVariant }]}>
          {t('agent.agentPool', { seconds: agentEnergySeconds })}
        </Text>
      </NeumorphicCard>

      <NeumorphicCard>
        <Text style={{ color: theme.colors.onSurface }}>
          {t('agent.allyPreview', {
            voice: t(`ally.voice.${voice}`),
            tone: t(`ally.tone.${tone}`),
            lang: t(`ally.lang.${interactionLanguage}`),
          })}
        </Text>
      </NeumorphicCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '600', flex: 1 },
  gear: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  subLine: { marginTop: 8, fontSize: 14 },
});
