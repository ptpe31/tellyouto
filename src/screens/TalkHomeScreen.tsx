import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Mic, UserCircle2, Waves } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { transcribeAudio } from '../services/TranscriptionService';

export function TalkHomeScreen() {
  const { t } = useTranslation();
  useTheme();
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startedAtRef = useRef<number>(0);
  const ringPulse = useRef(new Animated.Value(0)).current;
  const wavePulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isRecording) {
      ringPulse.stopAnimation();
      ringPulse.setValue(0);
      wavePulse.stopAnimation();
      wavePulse.setValue(0);
      return;
    }
    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(ringPulse, {
          toValue: 0,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    const waveLoop = Animated.loop(
      Animated.timing(wavePulse, {
        toValue: 1,
        duration: 1300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      { resetBeforeIteration: true },
    );
    ringLoop.start();
    waveLoop.start();
    return () => {
      ringLoop.stop();
      waveLoop.stop();
    };
  }, [isRecording, ringPulse, wavePulse]);

  const ensureMicrophonePermission = async (): Promise<boolean> => {
    const permission = await Audio.getPermissionsAsync();
    if (permission.granted) return true;
    const requested = await Audio.requestPermissionsAsync();
    if (requested.granted) return true;
    Alert.alert(
      t('talkHome.microphonePermissionTitle'),
      t('talkHome.microphonePermissionBody'),
    );
    return false;
  };

  const startRecording = async (): Promise<void> => {
    if (isBusy || recordingRef.current) return;
    const allowed = await ensureMicrophonePermission();
    if (!allowed) return;
    setIsBusy(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        isMeteringEnabled: false,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });
      await recording.startAsync();
      recordingRef.current = recording;
      startedAtRef.current = Date.now();
      setIsRecording(true);
    } catch (e) {
      Alert.alert(t('talkHome.recordingErrorTitle'), t('talkHome.recordingErrorStart'));
      recordingRef.current = null;
      setIsRecording(false);
    } finally {
      setIsBusy(false);
    }
  };

  const stopRecording = async (): Promise<void> => {
    const recording = recordingRef.current;
    if (!recording) return;
    setIsBusy(true);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const elapsedMs = Date.now() - startedAtRef.current;
      if (elapsedMs < 550) {
        Alert.alert(
          t('talkHome.recordingTooShortTitle'),
          t('talkHome.recordingTooShortBody'),
        );
        return;
      }
      if (!uri) {
        Alert.alert(t('talkHome.recordingErrorTitle'), t('talkHome.recordingErrorMissingFile'));
        return;
      }
      const text = await transcribeAudio(uri);
      Alert.alert(t('talkHome.transcriptionTitle'), text);
    } catch {
      Alert.alert(t('talkHome.recordingErrorTitle'), t('talkHome.recordingErrorStop'));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <LinearGradient
      colors={['#d7e6dc', '#f7f4eb']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.root}
    >
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoWrap}>
            <Waves size={18} color="#2d6f70" />
          </View>
          <Text style={styles.brandName}>
            {t('talkHome.brandName')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('talkHome.profileButton')}
          style={styles.profileBtn}
        >
          <UserCircle2 size={26} color="#9fa7a3" />
        </Pressable>
      </View>

      <View style={styles.contentFlow}>
        <View style={styles.pingCard}>
          <Text style={styles.priorityBadge}>{t('talkHome.priorityHigh')}</Text>
          <Text style={styles.question}>{t('talkHome.questionHydration')}</Text>
          <View style={styles.answerRow}>
            <Pressable style={[styles.answerBtn, styles.yesBtn]}>
              <Text style={styles.yesText}>{t('talkHome.yes')}</Text>
            </Pressable>
            <Pressable style={[styles.answerBtn, styles.noBtn]}>
              <Text style={styles.noText}>{t('talkHome.no')}</Text>
            </Pressable>
          </View>
          <Text style={styles.privacyHint}>{t('talkHome.localPrivacyHint')}</Text>
        </View>

        <View style={styles.progressCard}>
          <Text style={styles.progressLabel}>{t('talkHome.progressCurrent')}</Text>
          <Text style={styles.progressLabel}>{t('talkHome.progressNextAnchor')}</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.talkWrap}>
          {isRecording ? (
            <Text style={styles.listeningHint}>{t('talkHome.listeningNow')}</Text>
          ) : null}
          <Animated.View
            style={[
              styles.outerRing,
              {
                opacity: ringPulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.88, 1],
                }),
                borderColor: ringPulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['rgba(255,255,255,0.62)', 'rgba(235,252,248,0.94)'],
                }),
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('talkHome.holdToTalk')}
              onPressIn={() => {
                void startRecording();
              }}
              onPressOut={() => {
                void stopRecording();
              }}
              disabled={isBusy}
            >
              <LinearGradient
                colors={
                  isRecording
                    ? ['#10B981', '#059669']
                    : ['#4c73ad', '#5f8fa3', '#79a89c']
                }
                start={{ x: 0.15, y: 0.05 }}
                end={{ x: 0.95, y: 0.95 }}
                style={[
                  styles.talkButton,
                  isRecording ? styles.talkButtonRecording : null,
                ]}
              >
                <Text style={styles.holdLabel}>{t('talkHome.holdToTalk')}</Text>
                <View style={styles.micCore}>
                  <Mic size={30} color="#ffffff" />
                </View>
                {isRecording ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.waveHalo,
                      {
                        transform: [
                          {
                            scale: wavePulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.95, 1.34],
                            }),
                          },
                        ],
                        opacity: wavePulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.35, 0],
                        }),
                      },
                    ]}
                  />
                ) : null}
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 62,
    paddingBottom: 22,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  brandName: { fontSize: 34, fontWeight: '700', color: '#2e5f68' },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  contentFlow: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-around',
    paddingTop: 14,
    paddingBottom: 16,
  },
  pingCard: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#fbf8f3',
    shadowColor: '#707b75',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 7,
  },
  priorityBadge: {
    textAlign: 'center',
    color: '#c17357',
    fontWeight: '700',
    marginBottom: 8,
    fontSize: 17,
  },
  question: { textAlign: 'center', fontSize: 34, fontWeight: '600', color: '#2f4f5a' },
  answerRow: { marginTop: 16, flexDirection: 'row', gap: 12 },
  answerBtn: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesBtn: { backgroundColor: '#6fad7e' },
  noBtn: { backgroundColor: '#d9d8d5' },
  yesText: { color: '#f7fff7', fontWeight: '700', fontSize: 24 },
  noText: { color: '#6e7174', fontWeight: '700', fontSize: 24 },
  privacyHint: {
    marginTop: 12,
    textAlign: 'center',
    color: '#77807a',
    fontSize: 13,
    fontWeight: '500',
  },
  progressCard: {
    marginTop: 8,
    alignSelf: 'center',
    width: '80%',
    borderRadius: 14,
    backgroundColor: '#f8f8f6',
    paddingHorizontal: 12,
    paddingVertical: 9,
    shadowColor: '#8f8f8f',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 7,
    elevation: 3,
  },
  progressLabel: { textAlign: 'center', color: '#707572', fontSize: 9, marginBottom: 2 },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#e5e4df',
    overflow: 'hidden',
  },
  progressFill: { width: '38%', height: '100%', backgroundColor: '#78ad92' },
  talkWrap: {
    marginTop: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    width: 312,
    height: 312,
    borderRadius: 156,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(214, 227, 223, 0.56)',
    borderWidth: 14,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  talkButton: {
    width: 248,
    height: 248,
    borderRadius: 124,
    alignItems: 'center',
    justifyContent: 'center',
  },
  talkButtonRecording: {
    opacity: 0.96,
  },
  holdLabel: {
    color: '#eff8f8',
    fontSize: 21,
    letterSpacing: 2.2,
    fontWeight: '700',
    marginBottom: 26,
  },
  micCore: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 255, 251, 0.22)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  waveHalo: {
    position: 'absolute',
    width: 248,
    height: 248,
    borderRadius: 124,
    borderWidth: 4,
    borderColor: 'rgba(219, 255, 246, 0.8)',
  },
  listeningHint: {
    marginTop: 12,
    color: '#3b6b60',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
