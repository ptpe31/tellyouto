import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { SasModal } from '../components/SasModal';
import { UnifiedMicCapture } from '../components/UnifiedMicCapture';
import { useTranslation } from '../i18n';
import {
  insertPhoenixIntentionDraft,
  listPhoenixIntentions,
  updatePhoenixIntention,
  type PhoenixIntentionRow,
} from '../services/storage/intentionsDb';
import { startOneTapCapture } from '../services/oneTap/pipeline';
import type { OneTapUniversalResult } from '../types/oneTap';

function toIsoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function newId(): string {
  return `phoenix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function TimelineScreen() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PhoenixIntentionRow[]>([]);
  const [result, setResult] = useState<OneTapUniversalResult | null>(null);
  const [refining, setRefining] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const userEditedRef = useMemo(() => ({ v: false }), []);

  const load = useCallback(async () => {
    setRows(await listPhoenixIntentions({ limit: 100 }));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const close = useCallback(() => {
    if (busy) return;
    setVisible(false);
    setResult(null);
    setRefining(false);
    setDraftId(null);
    setTranscript('');
  }, [busy]);

  const onCaptureEnd = useCallback(
    async ({ transcript: raw, audioUri }: { transcript: string; audioUri: string | null }) => {
      void audioUri;
      const t0 = raw.trim();
      if (!t0) return;
      userEditedRef.v = false;

      const id = newId();
      setDraftId(id);
      setTranscript(t0);
      setVisible(true);

      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() ?? '';
      const modelId = process.env.EXPO_PUBLIC_GEMINI_MODEL_ID?.trim() || 'gemini-2.5-flash-lite';
      const refNowIso = toIsoNoMs(new Date());
      const handle = startOneTapCapture(t0, {
        uiLocale: 'en',
        titleHint: t0.slice(0, 120),
        gemini: apiKey ? { apiKey, modelId, refNowIso } : undefined,
      });

      setResult(handle.skeleton);
      setRefining(Boolean(apiKey));

      await insertPhoenixIntentionDraft({
        id,
        transcript: t0,
        title: handle.skeleton.title,
        predictedType: handle.skeleton.predictedType,
        status: 'DRAFT',
        payloadJson: JSON.stringify(handle.skeleton),
      });
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        return;
      }
      await load();

      handle.refine
        .then(async (r) => {
          setRefining(false);
          if (!r) return;
          if (userEditedRef.v) return;
          setResult(r);
          await updatePhoenixIntention(id, {
            title: r.title,
            predictedType: r.predictedType,
            payloadJson: JSON.stringify(r),
          });
          await load();
        })
        .catch(() => {
          setRefining(false);
        });
    },
    [load, userEditedRef],
  );

  const onConfirm = useCallback(() => {
    if (busy) return;
    if (!draftId || !result) return;
    setBusy(true);
    void (async () => {
      try {
        await updatePhoenixIntention(draftId, {
          status: 'VALIDATED',
          title: result.title,
          predictedType: result.predictedType,
          payloadJson: JSON.stringify(result),
        });
        await load();
      } finally {
        setBusy(false);
        close();
      }
    })();
  }, [busy, close, draftId, load, result]);

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={rows}
        keyExtractor={(x) => x.id}
        contentContainerStyle={rows.length === 0 ? styles.empty : styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.sub}>{new Date(item.created_at).toLocaleString()}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>{t('TIMELINE_EMPTY')}</Text>}
      />
      <View style={styles.micDock}>
        <UnifiedMicCapture onCaptureEnd={onCaptureEnd} />
      </View>
      {result ? (
        <SasModal
          visible={visible}
          refining={refining}
          result={result}
          transcript={transcript}
          busy={busy}
          onChangeResult={(next) => {
            userEditedRef.v = true;
            setResult(next);
          }}
          onUserEdited={() => {
            userEditedRef.v = true;
          }}
          onConfirm={onConfirm}
          onDismiss={close}
          counterLabel={null}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  list: { padding: 16, gap: 10, paddingBottom: 120 },
  empty: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: 'rgba(226,232,240,0.76)', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  card: { backgroundColor: 'rgba(15,23,42,0.65)', borderRadius: 16, padding: 14, gap: 4 },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '900' },
  sub: { color: 'rgba(226,232,240,0.62)', fontSize: 12, fontWeight: '700' },
  micDock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, alignItems: 'center' },
});
