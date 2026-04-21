import React, { useCallback, useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { SasModal } from './components/SasModal';
import { startOneTapCapture } from './services/oneTap/pipeline';
import type { OneTapUniversalResult } from './types/oneTap';
import { I18nProvider, useTranslation } from './i18n';

function toIsoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export default function App() {
  return (
    <I18nProvider initialLocale="en">
      <AppInner />
    </I18nProvider>
  );
}

function AppInner() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [result, setResult] = useState<OneTapUniversalResult | null>(null);
  const [refining, setRefining] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const userEditedRef = useMemo(() => ({ v: false }), []);

  const start = useCallback(() => {
    const transcript = text.trim();
    if (!transcript) return;
    userEditedRef.v = false;
    setVisible(true);
    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() ?? '';
    const modelId = process.env.EXPO_PUBLIC_GEMINI_MODEL_ID?.trim() || 'gemini-2.5-flash-lite';
    const refNowIso = toIsoNoMs(new Date());
    const uiLocale = (process.env.EXPO_PUBLIC_APP_LOCALE?.trim() || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
    const handle = startOneTapCapture(transcript, {
      uiLocale,
      titleHint: transcript.slice(0, 120),
      gemini: apiKey ? { apiKey, modelId, refNowIso } : undefined,
    });
    setResult(handle.skeleton);
    setRefining(Boolean(apiKey));
    handle.refine
      .then((r) => {
        setRefining(false);
        if (!r) return;
        if (userEditedRef.v) return;
        setResult(r);
      })
      .catch(() => {
        setRefining(false);
      });
  }, [text, userEditedRef]);

  const close = useCallback(() => {
    if (busy) return;
    setVisible(false);
    setResult(null);
    setRefining(false);
  }, [busy]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('APP_TITLE')}</Text>
        <Text style={styles.subtitle}>{t('APP_SUBTITLE')}</Text>
      </View>

      <View style={styles.body}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('APP_INTENT_PLACEHOLDER')}
          placeholderTextColor="rgba(100,116,139,0.72)"
          style={styles.input}
          multiline
        />
        <Pressable style={styles.cta} onPress={start}>
          <Text style={styles.ctaText}>{t('APP_LAUNCH')}</Text>
        </Pressable>
      </View>

      {result ? (
        <SasModal
          visible={visible}
          refining={refining}
          result={result}
          transcript={text}
          busy={busy}
          onChangeResult={(next) => {
            userEditedRef.v = true;
            setResult(next);
          }}
          onUserEdited={() => {
            userEditedRef.v = true;
          }}
          onConfirm={() => {
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              close();
            }, 250);
          }}
          onDismiss={close}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10, gap: 6 },
  title: { color: '#f8fafc', fontSize: 24, fontWeight: '900' },
  subtitle: { color: 'rgba(226,232,240,0.82)', fontSize: 13, fontWeight: '700' },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 12, gap: 12 },
  input: {
    minHeight: 140,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(241,245,249,0.88)',
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  cta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#2563eb',
  },
  ctaText: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
});
