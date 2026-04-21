import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react-native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '../i18n';

export type UnifiedMicCaptureEndPayload = {
  transcript: string;
  audioUri: string | null;
};

export type UnifiedMicCaptureProps = {
  onCaptureEnd?: (payload: UnifiedMicCaptureEndPayload) => void | Promise<void>;
};

export function UnifiedMicCapture({ onCaptureEnd }: UnifiedMicCaptureProps) {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rawTranscript, setRawTranscript] = useState('');
  const recRef = useRef<Audio.Recording | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? '';
    if (text.trim().length > 0) setRawTranscript(text);
  });

  const ensureMicrophoneReady = useCallback(async (): Promise<boolean> => {
    const audioPerm = await Audio.requestPermissionsAsync();
    if (!audioPerm.granted) {
      Alert.alert(t('MIC_PERMISSION_TITLE'), t('MIC_PERMISSION_BODY'), [
        { text: t('COMMON_CANCEL'), style: 'cancel' },
        { text: t('OPEN_SETTINGS'), onPress: () => void Linking.openSettings() },
      ]);
      return false;
    }
    try {
      let speechPerm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!speechPerm.granted) {
        speechPerm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      }
      if (!speechPerm.granted) {
        Alert.alert(t('MIC_PERMISSION_TITLE'), t('MIC_PERMISSION_BODY'), [
          { text: t('COMMON_CANCEL'), style: 'cancel' },
          { text: t('OPEN_SETTINGS'), onPress: () => void Linking.openSettings() },
        ]);
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }, [t]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    setRawTranscript('');
    const ok = await ensureMicrophoneReady();
    if (!ok) return;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        {
          android: { extension: '.m4a', outputFormat: 2, audioEncoder: 3, sampleRate: 44100, numberOfChannels: 1, bitRate: 128000 },
          ios: { extension: '.m4a', audioQuality: 127, sampleRate: 44100, numberOfChannels: 1, bitRate: 128000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
          web: {},
        } as any,
      );
      recRef.current = recording;
      await ExpoSpeechRecognitionModule.start({ lang: 'en', interimResults: true, continuous: true });
      setIsRecording(true);
      setIsPaused(false);
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        return;
      }
    } catch (e) {
      setIsRecording(false);
      setIsPaused(false);
      recRef.current = null;
      Alert.alert(t('MIC_ERROR_TITLE'), e instanceof Error ? e.message : String(e));
    }
  }, [ensureMicrophoneReady, isRecording, t]);

  const stopRecording = useCallback(async () => {
    if (!isRecording) return;
    let uri: string | null = null;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      return;
    }
    try {
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        await rec.stopAndUnloadAsync();
        uri = rec.getURI() ?? null;
      }
    } catch {
      return;
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      const payload = { transcript: rawTranscript, audioUri: uri };
      await onCaptureEnd?.(payload);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        return;
      }
    }
  }, [isRecording, onCaptureEnd, rawTranscript]);

  const cancelRecording = useCallback(async () => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      return;
    }
    try {
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        await rec.stopAndUnloadAsync();
      }
    } catch {
      return;
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      setRawTranscript('');
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        return;
      }
    }
  }, []);

  const togglePause = useCallback(async () => {
    if (!isRecording) return;
    const rec = recRef.current;
    if (!rec) return;
    try {
      if (isPaused) {
        await rec.startAsync();
        await ExpoSpeechRecognitionModule.start({ lang: 'en', interimResults: true, continuous: true });
        setIsPaused(false);
      } else {
        ExpoSpeechRecognitionModule.stop();
        await rec.pauseAsync();
        setIsPaused(true);
      }
    } catch {
      return;
    }
  }, [isPaused, isRecording]);

  const micLabel = useMemo(() => {
    const trimmed = rawTranscript.trim();
    if (!isRecording) return t('MIC_HINT_IDLE');
    if (isPaused) return t('MIC_HINT_PAUSED');
    return trimmed.length ? trimmed.slice(0, 120) : t('MIC_HINT_LISTENING');
  }, [isPaused, isRecording, rawTranscript, t]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>{micLabel}</Text>
      <View style={styles.row}>
        {!isRecording ? (
          <Pressable style={styles.primaryBtn} onPress={() => void startRecording()}>
            <Mic size={22} color="#0f172a" />
          </Pressable>
        ) : (
          <>
            <Pressable style={styles.secondaryBtn} onPress={() => void cancelRecording()}>
              <Trash2 size={20} color="#0f172a" />
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => void togglePause()}>
              {isPaused ? <Play size={20} color="#0f172a" /> : <Pause size={20} color="#0f172a" />}
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={() => void stopRecording()}>
              <SendHorizontal size={20} color="#0f172a" />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 520, alignItems: 'center', gap: 16 },
  hint: { color: 'rgba(226,232,240,0.8)', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  primaryBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,250,252,0.92)',
  },
  secondaryBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(226,232,240,0.82)',
  },
});

