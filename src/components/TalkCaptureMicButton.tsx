import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'react-native-paper';
import NetInfo from '@react-native-community/netinfo';

import { VOICE_MEMO_LIGHT_RECORDING_OPTIONS } from '../audio/talkMemoRecording';
import { neumorphicInset, neumorphicRaised } from '../theme/neumorphism';
import { alertNativeModuleMissing, isLikelyMissingNativeModuleError } from '../utils/nativeModuleErrorAlert';
import { resolveSpeechLangForSession } from '../utils/speechLocale';
import { Platform as RPlatform } from '../utils/rnPlatform';
import { useOptionalIntentionContext } from '../context/IntentionContext';

export type TalkCaptureEndPayload = {
  transcript: string;
  audioUri: string | null;
};

export type TalkCaptureMicButtonProps = {
  /** Exécuté juste avant de lancer micro + STT ; retour `false` annule le démarrage. */
  beforeStart?: () => Promise<boolean>;
  onCaptureStart?: () => void;
  onCaptureEnd?: (payload: TalkCaptureEndPayload) => void | Promise<void>;
  onCaptureCancel?: () => void | Promise<void>;
  disabled?: boolean;
  /** Variante compacte pour barre basse (Timeline). */
  compact?: boolean;
};

export function TalkCaptureMicButton({
  beforeStart,
  onCaptureStart,
  onCaptureEnd,
  onCaptureCancel,
  disabled,
  compact,
}: TalkCaptureMicButtonProps) {
  const intentionFlow = useOptionalIntentionContext();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [phase, setPhase] = useState<'idle' | 'recording'>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rawTranscript, setRawTranscript] = useState('');
  const [meteringDb, setMeteringDb] = useState(-100);
  const recRef = useRef<Audio.Recording | null>(null);
  const liveScrollRef = useRef<ScrollView | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? '';
    if (text.trim().length > 0) {
      setRawTranscript(text);
    }
  });

  const waveHeights = useMemo(() => {
    const norm = Math.max(0, Math.min(1, (meteringDb + 58) / 52));
    return Array.from({ length: 9 }).map((_, i) => {
      const phase = (i / 9) * Math.PI * 2;
      const w = 0.45 + 0.55 * Math.sin(phase + norm * 3.5);
      return isRecording ? 8 + norm * w * 22 : 8;
    });
  }, [isRecording, meteringDb]);

  const resetInternal = useCallback(() => {
    recRef.current = null;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* ignore */
    }
    setIsPaused(false);
    setIsRecording(false);
    setPhase('idle');
    setRawTranscript('');
    setMeteringDb(-100);
  }, []);

  const ensureMicrophoneReady = useCallback(async (): Promise<boolean> => {
    const audioPerm = await Audio.requestPermissionsAsync();
    if (!audioPerm.granted) {
      Alert.alert(
        t('talkHome.microphonePermissionTitle'),
        t('talkHome.microphonePermissionDeniedBody'),
        [
          { text: t('channelSwitch.cancel'), style: 'cancel' },
          { text: t('ally.openSettings'), onPress: () => void Linking.openSettings() },
        ],
      );
      return false;
    }
    try {
      let speechPerm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!speechPerm.granted) {
        speechPerm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      }
      if (!speechPerm.granted) {
        Alert.alert(
          t('talkHome.microphonePermissionTitle'),
          t('talkHome.microphonePermissionDeniedBody'),
          [
            { text: t('channelSwitch.cancel'), style: 'cancel' },
            { text: t('ally.openSettings'), onPress: () => void Linking.openSettings() },
          ],
        );
        return false;
      }
    } catch {
      /* ignore */
    }
    return true;
  }, [t]);

  const startRecording = useCallback(async () => {
    if (isRecording || disabled) return;
    if (beforeStart) {
      const ok = await beforeStart();
      if (!ok) return;
    }
    setRawTranscript('');
    setMeteringDb(-100);
    try {
      const ready = await ensureMicrophoneReady();
      if (!ready) return;
      onCaptureStart?.();
      intentionFlow?.startCapture();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        VOICE_MEMO_LIGHT_RECORDING_OPTIONS,
        (status) => {
          if (typeof status.metering === 'number' && Number.isFinite(status.metering)) {
            setMeteringDb(status.metering);
          }
        },
        80,
      );
      recRef.current = recording;
      await ExpoSpeechRecognitionModule.start({
        lang: resolveSpeechLangForSession(i18n.language),
        interimResults: true,
        continuous: true,
      });
      setIsRecording(true);
      setIsPaused(false);
      setPhase('recording');
      if (RPlatform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      resetInternal();
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomeSpeech', e);
      } else {
        Alert.alert(t('talkDebug.captureTitle'), e instanceof Error ? e.message : String(e));
      }
    }
  }, [
    beforeStart,
    disabled,
    ensureMicrophoneReady,
    i18n.language,
    isRecording,
    intentionFlow,
    onCaptureStart,
    resetInternal,
    t,
  ]);

  const stopRecording = useCallback(async () => {
    if (!isRecording) return;
    let uri: string | null = null;
    let transcript = '';
    try {
      ExpoSpeechRecognitionModule.stop();
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        await rec.stopAndUnloadAsync();
        uri = rec.getURI() ?? null;
      }
      transcript = rawTranscript;
    } catch (e) {
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomeSpeech', e);
      } else {
        Alert.alert(t('talkDebug.captureTitle'), e instanceof Error ? e.message : String(e));
      }
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      const cleaned = String(transcript || '').trim();
      const net = await NetInfo.fetch();
      const online = net.isConnected === true && net.isInternetReachable === true;
      if (cleaned) {
        setRawTranscript(
          online ? `${cleaned}... Audio en cours de traitement` : `${cleaned} ⚠️ Audio enregistré (traitement ultérieur)`,
        );
      }
      if (intentionFlow) {
        await intentionFlow.submitCapturePayload({ transcript: cleaned, audioUri: uri });
      }
      await onCaptureEnd?.({ transcript, audioUri: uri });
      resetInternal();
      if (!intentionFlow && RPlatform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  }, [intentionFlow, isRecording, onCaptureEnd, rawTranscript, resetInternal, t]);

  const cancelRecording = useCallback(async () => {
    try {
      ExpoSpeechRecognitionModule.stop();
      const rec = recRef.current;
      if (rec) {
        await rec.stopAndUnloadAsync();
      }
    } catch {
      /* ignore */
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      resetInternal();
      await onCaptureCancel?.();
      intentionFlow?.cancelCapture();
    }
  }, [intentionFlow, onCaptureCancel, resetInternal]);

  const togglePause = useCallback(async () => {
    if (!isRecording) return;
    const rec = recRef.current;
    if (!rec) return;
    try {
      if (isPaused) {
        await rec.startAsync();
        await ExpoSpeechRecognitionModule.start({
          lang: resolveSpeechLangForSession(i18n.language),
          interimResults: true,
          continuous: true,
        });
        setIsPaused(false);
      } else {
        ExpoSpeechRecognitionModule.stop();
        await rec.pauseAsync();
        setIsPaused(true);
      }
    } catch (e) {
      if (isLikelyMissingNativeModuleError(e)) {
        alertNativeModuleMissing('nativeModule.contextTalkHomeSpeech', e);
      } else {
        Alert.alert(t('talkDebug.captureTitle'), e instanceof Error ? e.message : String(e));
      }
    }
  }, [i18n.language, isPaused, isRecording, t]);

  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        /* ignore */
      }
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        void rec.stopAndUnloadAsync();
      }
    };
  }, []);

  if (phase === 'idle') {
    return (
      <View style={[styles.idleWrap, compact && styles.idleWrapCompact]}>
        <Pressable
          onPress={() => void startRecording()}
          disabled={disabled}
          style={({ pressed }) => [
            neumorphicRaised(theme),
            styles.micOuter,
            compact ? styles.micOuterCompact : null,
            { opacity: disabled ? 0.45 : pressed ? 0.9 : 1 },
          ]}
        >
          <View style={[neumorphicInset(theme), styles.micInner]}>
            <Mic size={compact ? 22 : 26} color={theme.colors.primary} />
          </View>
        </Pressable>
        {compact ? null : (
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>{t('talkCapture.hintTap')}</Text>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.recordingCard, neumorphicInset(theme), compact && styles.recordingCardCompact]}>
      <View style={styles.waveRow}>
        {waveHeights.map((h, idx) => (
          <View key={`bar-${idx}`} style={[styles.waveBar, { height: isPaused ? 8 : h }]} />
        ))}
      </View>
      <View style={[styles.liveTranscriptWrap, compact && styles.liveTranscriptWrapCompact]}>
        <ScrollView
          ref={(ref) => {
            liveScrollRef.current = ref;
          }}
          style={styles.liveTranscriptScroll}
          contentContainerStyle={styles.liveTranscriptContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            liveScrollRef.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={styles.liveTranscript}>
            {rawTranscript.trim() ? rawTranscript : t('talkHome.listeningNow')}
          </Text>
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={['#111827', 'rgba(17,24,39,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.transcriptFadeTop}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(17,24,39,0)', '#111827']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.transcriptFadeBottom}
        />
      </View>
      <View style={styles.ctrlRow}>
        <Pressable style={styles.ctrlBtn} onPress={() => void cancelRecording()} disabled={disabled}>
          <Trash2 size={18} color="#fff" />
        </Pressable>
        <Pressable style={styles.ctrlBtn} onPress={() => void togglePause()} disabled={disabled}>
          {isPaused ? <Play size={18} color="#fff" /> : <Pause size={18} color="#fff" />}
        </Pressable>
        <Pressable style={styles.ctrlBtn} onPress={() => void stopRecording()} disabled={disabled}>
          <SendHorizontal size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  idleWrap: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  idleWrapCompact: { gap: 4 },
  micOuter: {
    borderRadius: 999,
    padding: 10,
  },
  micOuterCompact: { padding: 8 },
  micInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: 12, textAlign: 'center' },
  recordingCard: {
    borderRadius: 20,
    padding: 14,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  recordingCardCompact: { padding: 10, maxWidth: 340 },
  waveRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4, height: 36 },
  waveBar: { width: 5, borderRadius: 3, backgroundColor: 'rgba(0,128,128,0.55)' },
  liveTranscriptWrap: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 72,
    maxHeight: 120,
    backgroundColor: '#111827',
  },
  liveTranscriptWrapCompact: {
    minHeight: 56,
    maxHeight: 88,
  },
  liveTranscriptScroll: { flex: 1 },
  liveTranscriptContent: { paddingHorizontal: 10, paddingVertical: 8 },
  liveTranscript: { color: '#f9fafb', fontSize: 14, lineHeight: 20 },
  transcriptFadeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 18 },
  transcriptFadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 22 },
  ctrlRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 },
  ctrlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
