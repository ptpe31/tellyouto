import React from 'react';
import { SafeAreaView, StyleSheet, Text } from 'react-native';

import { useTranslation } from '../i18n';

export function SettingsScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.text}>{t('SETTINGS_PLACEHOLDER')}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220', justifyContent: 'center', alignItems: 'center', padding: 24 },
  text: { color: 'rgba(226,232,240,0.76)', fontSize: 15, fontWeight: '700', textAlign: 'center' },
});

