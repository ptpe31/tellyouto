import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from 'react-native-paper';
import { NeumorphicSurface } from '../components';
import {
  buildAppDeepLink,
  getAppLinkForConnector,
} from '../services/connectorLinks';

export function MessagingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const links: { key: string; url: string; label: string }[] = [
    {
      key: 'radar',
      url: getAppLinkForConnector('radar'),
      label: t('connector.deepLinkRadar'),
    },
    {
      key: 'timeline',
      url: getAppLinkForConnector('timeline'),
      label: t('connector.deepLinkTimeline'),
    },
    {
      key: 'recharge',
      url: getAppLinkForConnector('recharge'),
      label: t('connector.deepLinkRecharge'),
    },
  ];

  const onCopy = async (key: string, url: string) => {
    await Clipboard.setStringAsync(url);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        {t('tabs.messaging')}
      </Text>
      <Text style={[styles.lead, { color: theme.colors.onSurfaceVariant }]}>
        {t('messaging.lead')}
      </Text>
      <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        {t('connector.copyLinkHint')}
      </Text>

      <NeumorphicSurface style={styles.card}>
        <Text style={[styles.mono, { color: theme.colors.onSurface }]}>
          {buildAppDeepLink('radar')}
        </Text>
      </NeumorphicSurface>

      {links.map((row) => (
        <View key={row.key} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.linkLabel, { color: theme.colors.onSurface }]}>
              {row.label}
            </Text>
            <Text
              style={[styles.monoSmall, { color: theme.colors.onSurfaceVariant }]}
              numberOfLines={2}
              selectable
            >
              {row.url}
            </Text>
          </View>
          <Button
            mode="outlined"
            compact
            onPress={() => void onCopy(row.key, row.url)}
          >
            {copiedKey === row.key
              ? t('onboarding.privateChannel.copied')
              : t('messaging.copyLink')}
          </Button>
        </View>
      ))}

      <Pressable
        onPress={async () => {
          const sample = links.map((l) => `${l.label}: ${l.url}`).join('\n');
          await Clipboard.setStringAsync(sample);
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 8 })}
      >
        <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>
          {t('messaging.copyAll')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 4 },
  lead: { fontSize: 15, lineHeight: 22 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  card: { padding: 12, marginBottom: 8 },
  mono: { fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  linkLabel: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  monoSmall: { fontSize: 12, lineHeight: 16 },
});
