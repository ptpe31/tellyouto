import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  theme: MD3Theme;
  title: string;
  htmlBody: string;
  translate: (key: string) => string;
  onClose: () => void;
};

function wrapHtmlDocument(body: string): string {
  const safe = String(body || '').trim();
  return `<!DOCTYPE html>
<html lang="und">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
  <style>
    body { margin:0; padding:16px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#f1f5f9; color:#0f172a; font-size:15px; line-height:1.45; }
    h1,h2,h3 { color:#0f172a; }
    a { color:#0d9488; }
  </style>
</head>
<body>${safe}</body>
</html>`;
}

export function DailyRoadmapReportModal({ visible, theme, title, htmlBody, translate: t, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [sharing, setSharing] = useState(false);
  const source = useMemo(() => ({ html: wrapHtmlDocument(htmlBody) }), [htmlBody]);

  const onSharePdf = useCallback(async () => {
    if (!htmlBody.trim()) return;
    if (Platform.OS === 'web') return;
    setSharing(true);
    try {
      const doc = wrapHtmlDocument(htmlBody);
      const { uri } = await Print.printToFileAsync({ html: doc, base64: false });
      const can = await Sharing.isAvailableAsync();
      if (can) {
        await Sharing.shareAsync(uri, { UTI: 'com.adobe.pdf', mimeType: 'application/pdf', dialogTitle: title });
      }
    } catch {
      /* toast possible from parent */
    } finally {
      setSharing(false);
    }
  }, [htmlBody, title]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.headerBtnText, { color: theme.colors.primary }]}>{t('timeline.roadmap.close')}</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.colors.onBackground }]} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={() => void onSharePdf()}
            disabled={sharing}
            style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.75 : 1 }]}
          >
            {sharing ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Text style={[styles.headerBtnText, { color: theme.colors.primary }]}>{t('timeline.roadmap.sharePrint')}</Text>
            )}
          </Pressable>
        </View>
        <WebView
          originWhitelist={['*']}
          source={source}
          style={styles.web}
          setSupportMultipleWindows={false}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  headerBtn: { minWidth: 72, paddingVertical: 6, alignItems: 'center' },
  headerBtnText: { fontSize: 14, fontWeight: '800' },
  web: { flex: 1, backgroundColor: '#f1f5f9' },
});
