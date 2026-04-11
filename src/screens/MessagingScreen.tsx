import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { NeumorphicSurface } from '../components';

export function MessagingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        {t('tabs.messaging')}
      </Text>
      <NeumorphicSurface>
        <Text style={{ color: theme.colors.onSurface }}>
          Messagerie — connecteurs à brancher
        </Text>
      </NeumorphicSurface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
});
