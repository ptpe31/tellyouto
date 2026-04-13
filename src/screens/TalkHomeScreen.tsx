import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import * as Localization from 'expo-localization';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Mic, Pencil, UserCircle2, Waves } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  DeviceEventEmitter,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import {
  ensureRoutineIntentionInstancesForHorizon,
  insertIntention,
  insertRoutine,
  INTENTIONS_CHANGED_EVENT_NAME,
  listIntentionsDescending,
  type IntentionRow,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import { useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  analyzeNewIntentionSemantics,
  computeRailAnchorAndFixedStartForNewIntention,
  estimateDurationMinutes,
  extractClockMinutesFromText,
  inferStructuralRoutinePlan,
  previewManualIntentionOverlapsHardRoutine,
  type BusyInterval,
} from '../services/agentLogic';
import {
  deleteAudioCacheFile,
  finalizeIntentWithCloudSemanticGraph,
  reformulateStructuredIntent,
  transcribeAudio,
  type VoiceIntentKind,
} from '../services/TranscriptionService';
import {
  alertNativeModuleMissing,
  isLikelyMissingNativeModuleError,
} from '../utils/nativeModuleErrorAlert';

type VoiceConfirmState = {
  audioUri: string;
  rawTranscript: string;
  kind: VoiceIntentKind;
  editedTitle: string;
  editedTime: string;
  isEditing: boolean;
};

function newTalkEntityId(): string {
  try {
    return randomUUID();
  } catch {
    return `tlk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export function TalkHomeScreen() {
  const { t } = useTranslation();
  useTheme();
  const { spectrum } = useUserSpectrum();
  const { interactionLanguage } = useLanguage();
  const { connectEnabled, busyIntervals } = useCalendarIntegration();

  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState<VoiceConfirmState | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startedAtRef = useRef<number>(0);
  const ringPulse = useRef(new Animated.Value(0)).current;
  const wavePulse = useRef(new Animated.Value(0)).current;

  const resetVoiceConfirm = useCallback(() => {
    setVoiceConfirm(null);
  }, []);

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
    if (isBusy || recordingRef.current || voiceConfirm) return;
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
    } catch {
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
    let audioUri: string | null = null;
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
      audioUri = uri;
      const transcript = await transcribeAudio(uri);
      if (!transcript.trim()) {
        Alert.alert(
          t('talkHome.transcriptionUnclearTitle'),
          t('talkHome.transcriptionUnclearBody'),
        );
        await deleteAudioCacheFile(uri);
        return;
      }
      const draft = reformulateStructuredIntent(transcript);
      const title = draft.title.trim() || transcript.trim();
      setVoiceConfirm({
        audioUri: uri,
        rawTranscript: transcript.trim(),
        kind: draft.kind,
        editedTitle: title,
        editedTime: draft.timeMarker,
        isEditing: false,
      });
    } catch {
      Alert.alert(t('talkHome.recordingErrorTitle'), t('talkHome.recordingErrorStop'));
    } finally {
      setIsBusy(false);
    }
  };

  const onCancelVoice = useCallback(async () => {
    if (!voiceConfirm) return;
    const uri = voiceConfirm.audioUri;
    resetVoiceConfirm();
    await deleteAudioCacheFile(uri);
  }, [voiceConfirm, resetVoiceConfirm]);

  const onProcessVoice = useCallback(async () => {
    if (!voiceConfirm) return;
    const trimmedTitle = voiceConfirm.editedTitle.trim();
    if (!trimmedTitle) {
      Alert.alert(t('talkHome.titleRequiredTitle'), t('talkHome.titleRequiredBody'));
      return;
    }
    const desc = voiceConfirm.editedTime.trim();
    const rawTranscript = voiceConfirm.rawTranscript;
    const kind = voiceConfirm.kind;
    const audioUri = voiceConfirm.audioUri;
    setIsBusy(true);
    try {
      const graph = await finalizeIntentWithCloudSemanticGraph(
        {
          kind,
          title: trimmedTitle,
          timeMarker: desc,
          rawTranscript,
        },
        { audioUri },
      );

      const now = new Date();
      const systemLocale =
        Localization.getLocales()[0]?.languageTag ??
        Intl.DateTimeFormat().resolvedOptions().locale;
      const timeExtractOpts = {
        systemLocale,
        aiLanguage: spectrum.locale?.trim() || interactionLanguage,
        now,
      };
      const uid = spectrum.platform_user_id?.trim() || '';
      const pending = (await listIntentionsDescending()).filter((r) => r.status !== 'done');
      const busyForAgent: BusyInterval[] = connectEnabled ? busyIntervals : [];

      const overlap = previewManualIntentionOverlapsHardRoutine(
        pending,
        trimmedTitle,
        desc,
        spectrum,
        now,
        busyForAgent,
        uid,
        timeExtractOpts,
      );
      if (overlap.overlaps) {
        Alert.alert(
          t('radar.hardRoutineConflictTitle'),
          t('radar.hardRoutineConflictBody', { name: overlap.blockingTitle ?? '—' }),
        );
        throw new Error('HARD_ROUTINE_OVERLAP');
      }

      const {
        priority,
        isLateNight: is_late_night,
        isHardConstraint,
      } = analyzeNewIntentionSemantics(trimmedTitle, desc, spectrum, now, {
        systemLocale,
        aiLanguage: interactionLanguage,
      });
      const estimated_duration = estimateDurationMinutes(trimmedTitle, desc, spectrum);

      const persistToLocalDb = async () => {
        const id = newTalkEntityId();
        const weights = {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        };
        const titlePinnedMinutes = extractClockMinutesFromText(
          `${trimmedTitle}\n${desc}`,
          timeExtractOpts,
        );
        const isTitleTimePinned = titlePinnedMinutes != null;
        const candidate: IntentionRow = {
          id,
          title: trimmedTitle,
          description: desc,
          status: 'pending',
          priority,
          weights,
          platform_type: 'none',
          platform_user_id: uid,
          created_at: Date.now(),
          synced: 0,
          estimated_duration,
          actual_duration: null,
          completed_at: null,
          user_forced_urgent: false,
          is_late_night,
          alarm_enabled: false,
          is_flexible: isTitleTimePinned ? false : true,
          is_micro_habit: kind === 'habit',
          is_hard_constraint: isHardConstraint,
          routine_id: null,
          anchor_date_ymd: null,
          fixed_start_minutes: titlePinnedMinutes,
          raw_transcript: rawTranscript,
          energy_score: null,
          local_notification_id: null,
          recurrence_rrule: null,
          type: kind,
          parent_id: null,
          semantic_cluster_id: graph.semantic_cluster_id,
          semantic_tags: graph.semantic_tags,
          sentiment_score: graph.sentiment_score,
          ping_history: [],
        };
        const { anchor_date_ymd, fixed_start_minutes } =
          computeRailAnchorAndFixedStartForNewIntention({
            pendingOthers: pending,
            candidate,
            spectrum: weights,
            now,
            busyIntervals: busyForAgent,
            systemLocale,
            aiLanguage: interactionLanguage,
          });

        const insertRadarPendingIntention = async () => {
          await insertIntention({
            id,
            title: trimmedTitle,
            description: desc,
            status: 'pending',
            priority,
            weights,
            platform_type: 'none',
            platform_user_id: uid,
            created_at: Date.now(),
            estimated_duration,
            user_forced_urgent: false,
            is_late_night,
            alarm_enabled: false,
            is_flexible: isTitleTimePinned ? false : true,
            is_micro_habit: kind === 'habit',
            is_hard_constraint: isHardConstraint,
            anchor_date_ymd,
            fixed_start_minutes,
            raw_transcript: rawTranscript,
            type: kind,
            semantic_cluster_id: graph.semantic_cluster_id,
            semantic_tags: graph.semantic_tags,
            sentiment_score: graph.sentiment_score,
          });
        };

        if (isHardConstraint) {
          const plan = inferStructuralRoutinePlan(
            trimmedTitle,
            desc,
            spectrum,
            now,
            timeExtractOpts,
          );
          if (plan) {
            const routineId = newTalkEntityId();
            await insertRoutine({
              id: routineId,
              title: trimmedTitle,
              description: desc,
              weekday: plan.weekday,
              start_minutes: plan.startMinutes,
              duration_min: plan.durationMin,
              weights,
              priority,
              platform_type: 'none',
              platform_user_id: uid,
              created_at: Date.now(),
            });
            await ensureRoutineIntentionInstancesForHorizon(routineId, uid);
          } else {
            await insertRadarPendingIntention();
          }
        } else {
          await insertRadarPendingIntention();
        }
      };

      await persistToLocalDb();
      resetVoiceConfirm();
      void syncPendingIntentions();
      DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'HARD_ROUTINE_OVERLAP') {
        if (isLikelyMissingNativeModuleError(e)) {
          alertNativeModuleMissing('TalkHome · intention vocale (SQLite)', e);
        } else {
          Alert.alert(t('talkHome.voicePersistErrorTitle'), t('talkHome.voicePersistErrorBody'));
        }
      }
    } finally {
      await deleteAudioCacheFile(audioUri);
      setIsBusy(false);
    }
  }, [
    voiceConfirm,
    spectrum,
    interactionLanguage,
    connectEnabled,
    busyIntervals,
    t,
    resetVoiceConfirm,
  ]);

  const intentTypeLabel = (k: VoiceIntentKind) =>
    t(`talkHome.intentType.${k}` as const);

  const renderPingCard = () => (
    <>
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
    </>
  );

  const renderConfirmCard = () => {
    if (!voiceConfirm) return null;
    const { editedTitle, editedTime, isEditing, kind } = voiceConfirm;
    const timeDisplay = editedTime.trim() ? editedTime.trim() : t('talkHome.timeUnspecified');

    return (
      <>
        <View style={styles.confirmHeaderRow}>
          <Text style={styles.confirmIntro}>{t('talkHome.confirmIntro')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('talkHome.editIntentA11y')}
            style={styles.editIconBtn}
            onPress={() => {
              setVoiceConfirm((prev) =>
                prev ? { ...prev, isEditing: !prev.isEditing } : prev,
              );
            }}
          >
            <Pencil size={20} color="#2d6f70" />
          </Pressable>
        </View>

        <View style={styles.typeRow}>
          <Text style={styles.confirmMetaLabel}>{t('talkHome.confirmTypePrefix')}</Text>
          <Text style={styles.typeValue}>{intentTypeLabel(kind)}</Text>
        </View>

        <Text style={styles.confirmBlockLabel}>{t('talkHome.confirmActionLabel')}</Text>
        {isEditing ? (
          <TextInput
            value={editedTitle}
            onChangeText={(v) => {
              setVoiceConfirm((prev) => (prev ? { ...prev, editedTitle: v } : prev));
            }}
            style={styles.editTitleInput}
            multiline
            placeholderTextColor="#8a9390"
          />
        ) : (
          <View style={styles.titleHeroWrap}>
            <Text style={styles.titleHero}>{editedTitle.trim() || '—'}</Text>
          </View>
        )}

        <View style={styles.timeSection}>
          <Text style={styles.confirmBlockLabel}>{t('talkHome.confirmMomentLabel')}</Text>
          {isEditing ? (
            <TextInput
              value={editedTime}
              onChangeText={(v) => {
                setVoiceConfirm((prev) => (prev ? { ...prev, editedTime: v } : prev));
              }}
              style={styles.editTimeInput}
              placeholder={t('talkHome.timeUnspecified')}
              placeholderTextColor="#8a9390"
            />
          ) : (
            <View style={styles.timeValueWrap}>
              <Text style={styles.timeValue}>{timeDisplay}</Text>
            </View>
          )}
        </View>

        <View style={styles.voiceActionRow}>
          <Pressable
            style={[styles.voiceActionBtn, styles.voiceCancelBtn]}
            onPress={() => {
              void onCancelVoice();
            }}
            disabled={isBusy}
          >
            <Text style={styles.voiceCancelText}>{t('talkHome.voiceCancel')}</Text>
          </Pressable>
          <Pressable
            style={[styles.voiceActionBtn, styles.voiceProcessBtn]}
            onPress={() => {
              void onProcessVoice();
            }}
            disabled={isBusy}
          >
            <Text style={styles.voiceProcessText}>{t('talkHome.voiceProcess')}</Text>
          </Pressable>
        </View>
      </>
    );
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
          {voiceConfirm ? renderConfirmCard() : renderPingCard()}
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
              disabled={isBusy || voiceConfirm !== null}
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
  confirmHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  confirmIntro: {
    flex: 1,
    color: '#3d524d',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  editIconBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  confirmMetaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6e7a75',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  typeValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f766e',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    overflow: 'hidden',
  },
  confirmBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7a8680',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  titleHeroWrap: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.12)',
  },
  titleHero: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1e3d42',
    lineHeight: 28,
  },
  editTitleInput: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#1e3d42',
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.2)',
    minHeight: 56,
    textAlignVertical: 'top',
  },
  timeSection: {
    marginBottom: 14,
  },
  timeValueWrap: {
    backgroundColor: 'rgba(245, 248, 246, 0.95)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#008080',
  },
  timeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2a4a52',
  },
  editTimeInput: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#2a4a52',
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.25)',
  },
  voiceActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  voiceActionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceCancelBtn: {
    backgroundColor: '#e8e7e4',
  },
  voiceCancelText: {
    color: '#5c5f62',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  voiceProcessBtn: {
    backgroundColor: '#008080',
  },
  voiceProcessText: {
    color: '#f5fffe',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
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
