import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import { NeumorphicCard } from '../components';

export function LegalScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.lead, { color: theme.colors.onSurfaceVariant }]}>
        {t('legal.lead')}
      </Text>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('legal.privacyTitle')}
        </Text>
        <Text style={[styles.body, { color: theme.colors.onSurface }]}>
          {t('legal.privacyBody')}
        </Text>
      </NeumorphicCard>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('legal.termsTitle')}
        </Text>
        <Text style={[styles.body, { color: theme.colors.onSurface }]}>
          {t('legal.termsBody')}
        </Text>
      </NeumorphicCard>

      <View style={styles.footerSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 36 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  block: { marginBottom: 14 },
  section: { fontSize: 13, fontWeight: '700', marginBottom: 10, letterSpacing: 0.3 },
  body: { fontSize: 14, lineHeight: 22 },
  footerSpacer: { height: 8 },
});
