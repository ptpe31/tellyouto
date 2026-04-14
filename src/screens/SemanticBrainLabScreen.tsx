import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import type { TFunction } from 'i18next';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  geminiAnalyzeIntentTranscript,
  geminiTranscribeAudioBase64,
  getGeminiApiKey,
  type GeminiLabAnalysis,
} from '../services/geminiSemanticLab';
import {
  inferLocalFrequencyLabel,
  reformulateStructuredIntent,
  type StructuredVoiceIntent,
  type VoiceIntentKind,
} from '../services/TranscriptionService';

const mono = StyleSheet.create({
  text: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 12,
    lineHeight: 17,
  },
});

function kindLabel(t: TFunction, k: VoiceIntentKind): string {
  return t(`semanticLab.kind.${k}` as const);
}

function buildSynthesisLine(
  t: TFunction,
  raw: string,
  local: StructuredVoiceIntent,
  gemini: GeminiLabAnalysis | null,
): string {
  if (!gemini) {
    return (
      t('semanticLab.synthNoGeminiHeader') +
      t('semanticLab.synthLocalOnlyLine', {
        kind: kindLabel(t, local.kind),
        freq: inferLocalFrequencyLabel(raw, local),
      })
    );
  }
  const same = local.kind === gemini.type;
  const a = `${kindLabel(t, local.kind)} [${local.kind}]`;
  const b = `${gemini.type}`;
  const locFreq = inferLocalFrequencyLabel(raw, local);
  if (same) {
    return t('semanticLab.synthAligned', {
      localLabel: a,
      geminiType: b,
      locFreq,
      gemFreq: gemini.frequency,
    });
  }
  return t('semanticLab.synthMismatch', {
    localLabel: a,
    geminiType: b,
    locFreq,
    gemFreq: gemini.frequency,
    complex: gemini.isComplexProject ? t('semanticLab.yes') : t('semanticLab.no'),
    reasoning: gemini.reasoning,
  });
}

export function SemanticBrainLabScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [rawTranscript, setRawTranscript] = useState<string | null>(null);
  const [localStructured, setLocalStructured] = useState<StructuredVoiceIntent | null>(
    null,
  );
  const [geminiJson, setGeminiJson] = useState<string | null>(null);
  const [geminiParsed, setGeminiParsed] = useState<GeminiLabAnalysis | null>(null);
  const [lastAudioUri, setLastAudioUri] = useState<string | null>(null);

  const unloadRecording = useCallback(async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        /* déjà arrêté ou déchargé */
      }
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch {
      /* ignore */
    }
  }, []);

  const onReset = useCallback(async () => {
    await unloadRecording();
    if (lastAudioUri) {
      try {
        await FileSystem.deleteAsync(lastAudioUri, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
    setLastAudioUri(null);
    setIsRecording(false);
    setBusy(false);
    setPipelineError(null);
    setRawTranscript(null);
    setLocalStructured(null);
    setGeminiJson(null);
    setGeminiParsed(null);
  }, [lastAudioUri, unloadRecording]);

  const onStartRecording = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert(t('semanticLab.alertWebUnsupportedTitle'), t('semanticLab.alertWebUnsupportedBody'));
      return;
    }
    setPipelineError(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('semanticLab.alertMicTitle'), t('semanticLab.alertMicDeniedBody'));
        return;
      }
      await unloadRecording();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('ExponentAV') || msg.includes('native module')) {
        setPipelineError(t('semanticLab.pipelineErrorExpoAvRebuild'));
      } else {
        setPipelineError(msg);
      }
      setIsRecording(false);
    }
  }, [t, unloadRecording]);

  const onStopAndRunPipeline = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec || !isRecording) {
      Alert.alert(t('semanticLab.alertRecordingTitle'), t('semanticLab.alertRecordingNoActiveBody'));
      return;
    }
    if (!getGeminiApiKey()) {
      Alert.alert(t('semanticLab.alertApiKeyTitle'), t('semanticLab.alertApiKeyBody'));
      return;
    }

    setBusy(true);
    setPipelineError(null);
    setRawTranscript(null);
    setLocalStructured(null);
    setGeminiJson(null);
    setGeminiParsed(null);

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI() ?? null;
      recordingRef.current = null;
      setIsRecording(false);
      setLastAudioUri(uri);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (!uri) {
        throw new Error(t('semanticLab.errorUriAfterStop'));
      }

      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });
      const transcript = await geminiTranscribeAudioBase64(b64, 'audio/mp4');
      setRawTranscript(transcript);

      const structured = reformulateStructuredIntent(transcript);
      setLocalStructured(structured);

      const { parsed, rawResponseText } = await geminiAnalyzeIntentTranscript(transcript);
      setGeminiParsed(parsed);
      setGeminiJson(
        JSON.stringify(
          {
            ...parsed,
            _rawModelText: rawResponseText,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPipelineError(msg);
    } finally {
      setBusy(false);
    }
  }, [isRecording, t]);

  const emptyPh = t('semanticLab.emptyPlaceholder');

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={mono.text}>{t('semanticLab.webUnsupportedMessage')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.pad,
        { paddingBottom: 24 + insets.bottom, paddingTop: 8 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[mono.text, styles.lead]}>{t('semanticLab.lead')}</Text>

      <View style={styles.row}>
        <Pressable
          style={[styles.btn, styles.btnTeal]}
          onPress={onStartRecording}
          disabled={busy || isRecording}
        >
          <Text style={styles.btnText}>{t('semanticLab.btnStart')}</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnOrange]}
          onPress={() => void onStopAndRunPipeline()}
          disabled={busy || !isRecording}
        >
          <Text style={styles.btnText}>{t('semanticLab.btnStopPipeline')}</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.btn, styles.btnMuted, { marginBottom: 16 }]}
        onPress={() => void onReset()}
        disabled={busy}
      >
        <Text style={styles.btnText}>{t('semanticLab.btnReset')}</Text>
      </Pressable>

      {busy ? (
        <View style={styles.loaderRow}>
          <ActivityIndicator size="small" color="#008080" />
          <Text style={[mono.text, { marginLeft: 10 }]}>{t('semanticLab.loaderLabel')}</Text>
        </View>
      ) : null}

      {pipelineError ? (
        <Text style={[mono.text, styles.err]}>{pipelineError}</Text>
      ) : null}

      <Text style={styles.section}>{t('semanticLab.sectionRaw')}</Text>
      <Text style={[mono.text, styles.block]} selectable>
        {rawTranscript ?? emptyPh}
      </Text>

      <Text style={styles.section}>{t('semanticLab.sectionLocal')}</Text>
      <Text style={[mono.text, styles.block]} selectable>
        {localStructured
          ? [
              t('semanticLab.localLineType', {
                kind: kindLabel(t, localStructured.kind),
                kindCode: localStructured.kind,
              }),
              t('semanticLab.localLineFrequency', {
                value: rawTranscript
                  ? inferLocalFrequencyLabel(rawTranscript, localStructured)
                  : emptyPh,
              }),
              t('semanticLab.localLineTitle', {
                value: localStructured.title || emptyPh,
              }),
              t('semanticLab.localLineTimeMarker', {
                value: localStructured.timeMarker || emptyPh,
              }),
            ].join('\n')
          : emptyPh}
      </Text>

      <Text style={styles.section}>{t('semanticLab.sectionGemini')}</Text>
      <Text style={[mono.text, styles.block]} selectable>
        {geminiJson ?? emptyPh}
      </Text>

      <Text style={styles.section}>{t('semanticLab.sectionSynth')}</Text>
      <Text style={[mono.text, styles.block]} selectable>
        {rawTranscript && localStructured
          ? buildSynthesisLine(t, rawTranscript, localStructured, geminiParsed)
          : emptyPh}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F5F5F0' },
  pad: { paddingHorizontal: 14 },
  center: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#F5F5F0' },
  lead: { marginBottom: 14, color: '#333' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  btnTeal: { backgroundColor: '#008080' },
  btnOrange: { backgroundColor: '#FF8C00' },
  btnMuted: { backgroundColor: '#6b7280', alignSelf: 'flex-start' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  loaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  err: { color: '#b91c1c', marginBottom: 12 },
  section: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 11,
    fontWeight: '700',
    color: '#008080',
    marginTop: 14,
    marginBottom: 6,
  },
  block: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    color: '#111',
  },
});
