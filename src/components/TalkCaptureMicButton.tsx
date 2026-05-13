import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Check, Lock, Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Dimensions, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'react-native-paper';
import NetInfo from '@react-native-community/netinfo';

import { VOICE_MEMO_LIGHT_RECORDING_OPTIONS } from '../audio/talkMemoRecording';
import { VoiceMeteringWaveform } from '../components/VoiceMeteringWaveform';
import { neumorphicInset, neumorphicRaised } from '../theme/neumorphism';
import { cleanTranscriptText } from '../services/smartTitle';
import { alertNativeModuleMissing, isLikelyMissingNativeModuleError } from '../utils/nativeModuleErrorAlert';
import { resolveSpeechLangForSession } from '../utils/speechLocale';
import { Platform as RPlatform } from '../utils/rnPlatform';
import { useOptionalIntentionContext } from '../context/IntentionContext';
import { VERBOSE_DEBUG } from '../config/verboseDebug';
import { logCaptureFlow } from '../utils/captureFlowLog';

/**
 * Bouton micro + STT : enregistrement mémo, dictée, validation ; si `IntentionProvider` est monté,
 * déclenche `startCapture` + `submitCapturePayload` (spec **Micro as Bulk(1)**). Utilisé par Talk et Timeline.
 *
 * @module TalkCaptureMicButton
 */

function newMicTraceId(): string {
  const rnd = Math.random().toString(16).slice(2, 8);
  return `mic_${Date.now()}_${rnd}`;
}

function previewForMicLog(value: string, maxLen: number): string {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

export type TalkCaptureEndPayload = {
  transcript: string;
  audioUri: string | null;
  lang: string;
};

export type TalkCaptureMicButtonProps = {
  /** Exécuté juste avant de lancer micro + STT ; retour `false` annule le démarrage. */
  beforeStart?: () => Promise<boolean>;
  onCaptureStart?: () => void;
  onCaptureEnd?: (payload: TalkCaptureEndPayload) => void | Promise<void>;
  onCaptureCancel?: () => void | Promise<void>;
  onPeekStart?: () => void;
  onValidated?: () => void;
  onTranscriptChange?: (text: string) => void;
  disabled?: boolean;
  /** Variante compacte pour barre basse (Timeline). */
  compact?: boolean;
  variant?: 'timeline' | 'talkDebug';
  locked?: boolean;
  lockedHintText?: string;
  waveformA11yLabel?: string;
  onLockedPress?: () => void;
};

/** Barre de capture vocale (variante Talk compacte ou Timeline). */
export function TalkCaptureMicButton({
  beforeStart,
  onCaptureStart,
  onCaptureEnd,
  onCaptureCancel,
  onPeekStart,
  onValidated,
  onTranscriptChange,
  disabled,
  compact,
  variant = 'timeline',
  locked,
  lockedHintText,
  waveformA11yLabel,
  onLockedPress,
}: TalkCaptureMicButtonProps) {
  const intentionFlow = useOptionalIntentionContext();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [phase, setPhase] = useState<'idle' | 'recording' | 'success'>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rawTranscript, setRawTranscript] = useState('');
  const [successLabel, setSuccessLabel] = useState('');
  const [successTone, setSuccessTone] = useState<'online' | 'offline'>('online');
  const [meteringDb, setMeteringDb] = useState(-100);
  const recRef = useRef<Audio.Recording | null>(null);
  const liveScrollRef = useRef<ScrollView | null>(null);
  const sttLangRef = useRef<string>(resolveSpeechLangForSession(i18n.language));
  const micTraceIdRef = useRef<string>('');
  const sttLogGateRef = useRef<{ lastLen: number; firedStart: boolean }>({ lastLen: 0, firedStart: false });
  const successScale = useRef(new Animated.Value(0.8)).current;
  const successOpacity = useRef(new Animated.Value(1)).current;

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? '';
    if (text.trim().length > 0) {
      setRawTranscript(text);
      onTranscriptChange?.(text);
      if (__DEV__ && VERBOSE_DEBUG && micTraceIdRef.current) {
        const nextLen = text.trim().length;
        const gate = sttLogGateRef.current;
        const delta = nextLen - gate.lastLen;
        if (!gate.firedStart || delta >= 24) {
          gate.firedStart = true;
          gate.lastLen = nextLen;
          console.log(`[MIC] 🗣️ STT (${nextLen}c) | TRACE: ${micTraceIdRef.current} | "${previewForMicLog(text, 140)}"`);
        }
      }
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
    micTraceIdRef.current = '';
    sttLogGateRef.current = { lastLen: 0, firedStart: false };
    setIsPaused(false);
    setIsRecording(false);
    setPhase('idle');
    setRawTranscript('');
    setSuccessLabel('');
    setSuccessTone('online');
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
    if (locked) {
      onLockedPress?.();
      return;
    }
    if (isRecording || disabled) return;
    if (beforeStart) {
      const ok = await beforeStart();
      if (!ok) return;
    }
    setRawTranscript('');
    setMeteringDb(-100);
    micTraceIdRef.current = newMicTraceId();
    sttLogGateRef.current = { lastLen: 0, firedStart: false };
    try {
      const ready = await ensureMicrophoneReady();
      if (!ready) return;
      onCaptureStart?.();
      intentionFlow?.startCapture();
      if (__DEV__ && VERBOSE_DEBUG) {
        const now = new Date();
        console.log(`************************************************************`);
        console.log(`🎙️  MICRO CAPTURE START | ${now.toLocaleString('fr-FR')} | TRACE: ${micTraceIdRef.current}`);
        console.log(`************************************************************`);
        console.log(`[MIC] 🔐 PERMS OK | STT_LANG=${resolveSpeechLangForSession(i18n.language)} | VARIANT=${variant}`);
      }
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
      const speechLang = resolveSpeechLangForSession(i18n.language);
      sttLangRef.current = speechLang;
      await ExpoSpeechRecognitionModule.start({
        lang: speechLang,
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
    locked,
    intentionFlow,
    onLockedPress,
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
      const cleaned = cleanTranscriptText(String(transcript || '')).trim();
      if (__DEV__ && VERBOSE_DEBUG) {
        const now = new Date();
        console.log(`********** ${now.toLocaleString('fr-FR')} **********`);
        console.log(`********* MICRO CAPTURE STOP *********`);
        console.log(`[MIC] 🧩 RAW (${String(transcript || '').trim().length}c) → CLEAN (${cleaned.length}c) | TRACE: ${micTraceIdRef.current || '—'}`);
        console.log(`[MIC] ✨ CLEAN: "${previewForMicLog(cleaned, 240)}"`);
        console.log(`[MIC] 🎧 AUDIO_URI: ${uri ? 'yes' : 'no'} | INTENTION_CTX: ${intentionFlow ? 'yes' : 'no'}`);
      }
      if (!cleaned) {
        resetInternal();
        Alert.alert(
          t('talkDebug.captureTitle', { defaultValue: 'Capture' }),
          t('talkDebug.oneTapEmptyTranscript', { defaultValue: 'Aucun texte détecté.' }),
        );
        return;
      }
      const net = await NetInfo.fetch();
      const online = net.isConnected === true && net.isInternetReachable === true;
      if (__DEV__ && VERBOSE_DEBUG) {
        console.log(
          `[MIC] 🛰️ NETINFO: isConnected=${String(net.isConnected)} | isInternetReachable=${String(net.isInternetReachable)} | online=${String(online)}`,
        );
      }
      setPhase('success');
      setSuccessTone(online ? 'online' : 'offline');
      setSuccessLabel(
        online
          ? t('talkCapture.savedTimeline', { defaultValue: 'Intention enregistrée dans Timeline' })
          : t('talkCapture.savedOfflinePending', {
              defaultValue: 'Indisponibilité réseau : intention enregistrée pour traitement ultérieur',
            }),
      );
      if (intentionFlow) {
        logCaptureFlow(micTraceIdRef.current?.trim() || undefined, 'mic_submit_invoke', {
          transcriptLen: cleaned.length,
          hasAudio: Boolean(uri),
        });
        void intentionFlow
          .submitCapturePayload({ transcript: cleaned, audioUri: uri, lang: sttLangRef.current, traceId: micTraceIdRef.current })
          .catch((e) => {
            if (__DEV__ && VERBOSE_DEBUG) {
              console.log(`[MIC] ❌ submitCapturePayload failed | TRACE: ${micTraceIdRef.current} | ${e instanceof Error ? e.message : String(e)}`);
            }
          });
      }
      if (__DEV__ && VERBOSE_DEBUG) {
        console.log(`[MIC] 📤 SUBMITTED → intentionFlow | TRACE: ${micTraceIdRef.current || '—'}`);
      }
      await onCaptureEnd?.({ transcript: cleaned, audioUri: uri, lang: sttLangRef.current });
      if (RPlatform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  }, [intentionFlow, isRecording, onCaptureEnd, rawTranscript, resetInternal, t]);

  useEffect(() => {
    if (phase !== 'success') return;
    successScale.setValue(0.8);
    successOpacity.setValue(1);
    let cancelled = false;
    const part1 = Animated.sequence([
      Animated.timing(successScale, { toValue: 1.1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(successScale, { toValue: 1.0, duration: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    const part2 = Animated.sequence([
      Animated.delay(1200),
      Animated.timing(successOpacity, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    part1.start(({ finished }) => {
      if (!finished || cancelled) return;
      onPeekStart?.();
      part2.start(({ finished }) => {
        if (!finished || cancelled) return;
        onValidated?.();
        resetInternal();
      });
    });
    return () => {
      cancelled = true;
      part1.stop();
      part2.stop();
    };
  }, [onPeekStart, onValidated, phase, resetInternal, successOpacity, successScale]);

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

  const isTalkDebug = variant === 'talkDebug';

  if (isTalkDebug) {
    const canvasH = Math.round(Dimensions.get('window').height * 0.4);
    const accent = successTone === 'offline' ? '#FFB300' : '#4CAF50';
    if (phase === 'idle') {
      return (
        <View style={tdStyles.micShell}>
          {locked && lockedHintText ? (
            <Pressable style={tdStyles.micHintPress} onPress={onLockedPress} disabled={!onLockedPress}>
              <Text style={tdStyles.micHintText}>{lockedHintText}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => void startRecording()}
            disabled={disabled && !locked}
            style={[tdStyles.micBtn, locked ? tdStyles.micBtnLocked : null, disabled && !locked ? tdStyles.disabled : null]}
          >
            <Mic size={24} color={locked ? '#e2e8f0' : '#fff'} />
            {locked ? (
              <View style={tdStyles.micLockBadge}>
                <Lock size={14} color="#fff" />
              </View>
            ) : null}
          </Pressable>
        </View>
      );
    }

    if (phase === 'success') {
      return (
        <View style={tdStyles.captureTranscriptShell}>
          <View style={[tdStyles.validationCanvas, { height: canvasH }]}>
            <Animated.View style={{ transform: [{ scale: successScale }], opacity: successOpacity, alignItems: 'center' }}>
              <Check size={140} color={accent} />
              <Text style={tdStyles.validationText}>{successLabel}</Text>
            </Animated.View>
          </View>
        </View>
      );
    }

    return (
      <>
        <View style={tdStyles.captureTranscriptShell}>
          <ScrollView
            ref={(ref) => {
              liveScrollRef.current = ref;
            }}
            style={tdStyles.captureTranscriptScroll}
            contentContainerStyle={tdStyles.liveTranscriptContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              liveScrollRef.current?.scrollToEnd({ animated: true });
            }}
          >
            <Text style={tdStyles.liveTranscript}>{rawTranscript.trim() ? rawTranscript : ' '}</Text>
          </ScrollView>
          {!isPaused ? (
            <VoiceMeteringWaveform meteringDb={meteringDb} accessibilityLabel={waveformA11yLabel} />
          ) : null}
          <LinearGradient
            pointerEvents="none"
            colors={['#111827', 'rgba(17,24,39,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={tdStyles.transcriptFadeTop}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(17,24,39,0)', '#111827']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={tdStyles.transcriptFadeBottom}
          />
        </View>
        <View style={tdStyles.pilotRowDocked}>
          <Pressable style={tdStyles.ctrlBtn} onPress={() => void cancelRecording()} disabled={disabled}>
            <Trash2 size={18} color="#fff" />
          </Pressable>
          <Pressable style={tdStyles.ctrlBtn} onPress={() => void togglePause()} disabled={disabled}>
            {isPaused ? <Play size={18} color="#fff" /> : <Pause size={18} color="#fff" />}
          </Pressable>
          <Pressable style={[tdStyles.micBtn, tdStyles.ctrlBtnPrimary, disabled ? tdStyles.disabled : null]} onPress={() => void stopRecording()} disabled={disabled}>
            <SendHorizontal size={22} color="#fff" />
          </Pressable>
        </View>
      </>
    );
  }

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

  if (phase === 'success') {
    const canvasH = Math.round(Dimensions.get('window').height * 0.4);
    const accent = successTone === 'offline' ? '#FFB300' : '#4CAF50';
    return (
      <View style={[styles.recordingCard, neumorphicInset(theme), compact && styles.recordingCardCompact]}>
        <View style={styles.waveRow}>
          {waveHeights.map((h, idx) => (
            <View key={`bar-${idx}`} style={[styles.waveBar, { height: isPaused ? 8 : h }]} />
          ))}
        </View>
        <View style={[styles.liveTranscriptWrap, { minHeight: canvasH, maxHeight: canvasH }]}>
          <View style={styles.successCanvas}>
            <Animated.View style={{ transform: [{ scale: successScale }], opacity: successOpacity, alignItems: 'center' }}>
              <Check size={140} color={accent} />
              <Text style={styles.successText}>{successLabel}</Text>
            </Animated.View>
          </View>
        </View>
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
  successCanvas: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  successText: { marginTop: 20, fontSize: 18, fontWeight: '600', textAlign: 'center', lineHeight: 24, color: '#E3F2FD' },
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

const tdStyles = StyleSheet.create({
  captureTranscriptShell: { width: '100%', position: 'relative', marginBottom: 14 },
  captureTranscriptScroll: { width: '100%' },
  liveTranscriptContent: { paddingHorizontal: 10, paddingVertical: 8 },
  liveTranscript: { color: '#BDC3C7', fontSize: 16, textAlign: 'center', paddingHorizontal: 10, lineHeight: 22 },
  transcriptFadeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 16 },
  transcriptFadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 16 },
  pilotRowDocked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginTop: 4 },
  ctrlBtn: { width: 52, height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f766e' },
  ctrlBtnPrimary: { width: 72, height: 72, borderRadius: 999, backgroundColor: '#008080' },
  micShell: { alignSelf: 'center', width: '100%', alignItems: 'center', gap: 10, marginBottom: 8 },
  micBtn: {
    alignSelf: 'center',
    marginBottom: 8,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: '#008080',
    justifyContent: 'center',
    alignItems: 'center',
  },
  micHintPress: { maxWidth: 320, paddingHorizontal: 14, paddingVertical: 8 },
  micHintText: { color: 'rgba(226, 232, 240, 0.92)', fontSize: 12, lineHeight: 16, textAlign: 'center', fontWeight: '700' },
  micBtnLocked: { backgroundColor: '#475569' },
  micLockBadge: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  validationCanvas: { width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#111827' },
  validationText: { marginTop: 20, fontSize: 18, fontWeight: '600', textAlign: 'center', lineHeight: 24, color: '#E3F2FD' },
});
