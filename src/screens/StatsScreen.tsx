import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import { NeumorphicCard } from '../components';
import { RawDataInspector } from '../components/RawDataInspector';

export function StatsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <NeumorphicCard style={styles.heroCard}>
        <Text style={[styles.screenTitle, { color: theme.colors.onBackground }]}>
          {t('stats.screenTitle')}
        </Text>
        <Text
          style={[styles.screenSub, { color: theme.colors.onSurfaceVariant }]}
        >
          Laboratoire de visualisation des donnees IA locales.
        </Text>
      </NeumorphicCard>

      <NeumorphicCard style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          Section A · Visualisation
        </Text>
        <View style={styles.placeholderBox}>
          <Text style={[styles.placeholderText, { color: theme.colors.onSurfaceVariant }]}>
            Statistiques Zen a venir
          </Text>
        </View>
      </NeumorphicCard>

      <NeumorphicCard style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          Section B · Explorateur SQLite
        </Text>
        <RawDataInspector />
      </NeumorphicCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 40 },
  heroCard: { marginBottom: 16, paddingVertical: 14 },
  screenTitle: { fontSize: 24, fontWeight: '700', marginBottom: 6 },
  screenSub: { fontSize: 14, lineHeight: 20 },
  sectionCard: { marginBottom: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  placeholderBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9ca3af',
    borderRadius: 12,
    minHeight: 110,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  placeholderText: { fontSize: 14, fontWeight: '600' },
});
