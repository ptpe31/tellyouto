import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';

import { SasModal } from '../components/SasModal';
import { UnifiedMicCapture } from '../components/UnifiedMicCapture';
import { useTranslation } from '../i18n';
import { insertPhoenixIntentionDraft, updatePhoenixIntention, type PhoenixIntentionStatus } from '../services/storage/intentionsDb';
import { startOneTapCapture } from '../services/oneTap/pipeline';
import type { OneTapUniversalResult } from '../types/oneTap';

function toIsoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function newId(): string {
  return `phoenix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function HomeScreen() {
  const { t } = useTranslation();
  const [result, setResult] = useState<OneTapUniversalResult | null>(null);
  const [refining, setRefining] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const userEditedRef = useMemo(() => ({ v: false }), []);

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
        })
        .catch(() => {
          setRefining(false);
        });
    },
    [userEditedRef],
  );

  const onConfirm = useCallback(() => {
    if (busy) return;
    if (!draftId || !result) return;
    setBusy(true);
    const status: PhoenixIntentionStatus = 'VALIDATED';
    void (async () => {
      try {
        await updatePhoenixIntention(draftId, {
          status,
          title: result.title,
          predictedType: result.predictedType,
          payloadJson: JSON.stringify(result),
        });
      } finally {
        setBusy(false);
        close();
      }
    })();
  }, [busy, close, draftId, result]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
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
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
});
