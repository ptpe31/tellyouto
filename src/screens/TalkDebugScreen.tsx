import { randomUUID } from 'expo-crypto';
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  ensureRoutineIntentionInstancesForHorizon,
  insertIntention,
  insertRoutine,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../api/localDb';
import {
  consumeTrankilV2IntentCredit,
  getTrankilV2UserStats,
} from '../api/trankilV2Db';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { runManualIaRechargeVideo } from '../services/AdManager';
import { atomizeProject } from '../services/GeminiExpert';

function newId(): string {
  try {
    return randomUUID();
  } catch {
    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function TalkDebugScreen() {
  const { spectrum } = useUserSpectrum();
  const [captureStep, setCaptureStep] = useState<'idle' | 'recording' | 'deciding'>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rawTranscript, setRawTranscript] = useState('');
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waveTick, setWaveTick] = useState(0);
  const recRef = useRef<Audio.Recording | null>(null);
  const waveformTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveScrollRef = useRef<ScrollView | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? '';
    if (text.trim().length > 0) setRawTranscript(text);
  });

  const waveHeights = useMemo(() => {
    return Array.from({ length: 9 }).map((_, i) => {
      const base = 8 + ((waveTick + i * 7) % 20);
      return isRecording ? base : 8;
    });
  }, [isRecording, waveTick]);

  const hardResetToIdle = useCallback(() => {
    if (waveformTimer.current) clearInterval(waveformTimer.current);
    waveformTimer.current = null;
    recRef.current = null;
    setIsPaused(false);
    setIsRecording(false);
    setCaptureStep('idle');
    setRawTranscript('');
    setAudioUri(null);
  }, []);

  const startCapture = useCallback(async () => {
    if (isRecording || busy) return;
    setRawTranscript('');
    setAudioUri(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Micro', 'Permission micro refusee.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recRef.current = recording;
      await ExpoSpeechRecognitionModule.start({
        lang: spectrum.locale?.trim() || 'fr-FR',
        interimResults: true,
        continuous: true,
      });
      setIsRecording(true);
      setIsPaused(false);
      setCaptureStep('recording');
      waveformTimer.current = setInterval(() => setWaveTick((v) => v + 1), 180);
    } catch (e) {
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    }
  }, [busy, isRecording, spectrum.locale]);

  const stopCapture = useCallback(async () => {
    if (captureStep !== 'recording' || !isRecording) return;
    try {
      ExpoSpeechRecognitionModule.stop();
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        await rec.stopAndUnloadAsync();
        setAudioUri(rec.getURI() ?? null);
      }
    } catch (e) {
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    } finally {
      if (waveformTimer.current) clearInterval(waveformTimer.current);
      waveformTimer.current = null;
      setIsRecording(false);
      setIsPaused(false);
      setCaptureStep('deciding');
    }
  }, [captureStep, isRecording]);

  const cancelCapture = useCallback(async () => {
    try {
      ExpoSpeechRecognitionModule.stop();
      const rec = recRef.current;
      if (rec) {
        await rec.stopAndUnloadAsync();
      }
    } catch {
      // Best effort cancel.
    } finally {
      hardResetToIdle();
    }
  }, [hardResetToIdle]);

  const togglePauseCapture = useCallback(async () => {
    if (captureStep !== 'recording') return;
    const rec = recRef.current;
    if (!rec || !isRecording) return;
    try {
      if (isPaused) {
        await rec.startAsync();
        await ExpoSpeechRecognitionModule.start({
          lang: spectrum.locale?.trim() || 'fr-FR',
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
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    }
  }, [captureStep, isPaused, isRecording, spectrum.locale]);

  const saveIntention = useCallback(
    async (kind: 'note' | 'task', title: string, description: string) => {
      const now = Date.now();
      await insertIntention({
        id: newId(),
        title,
        description,
        status: 'pending',
        priority: kind === 'task' ? 70 : 40,
        weights: {
          structure: spectrum.structure,
          momentum: spectrum.momentum,
          zen: spectrum.zen,
          stats: spectrum.stats,
        },
        platform_type: 'none',
        platform_user_id: spectrum.platform_user_id?.trim() || '',
        created_at: now,
        estimated_duration: kind === 'task' ? 25 : 10,
        raw_transcript: rawTranscript || null,
        type: kind,
      });
    },
    [rawTranscript, spectrum],
  );

  const onChooseAction = useCallback(
    async (action: 'note' | 'task' | 'habit' | 'project' | 'audio' | 'cancel') => {
      if (action === 'cancel') {
        hardResetToIdle();
        return;
      }
      setBusy(true);
      try {
        if (action === 'note') {
          await saveIntention('note', rawTranscript.trim() || 'Note brute', '');
        } else if (action === 'task') {
          await saveIntention('task', rawTranscript.trim() || 'Tache rapide', '');
        } else if (action === 'habit') {
          const routineId = newId();
          const now = new Date();
          await insertRoutine({
            id: routineId,
            title: rawTranscript.trim() || 'Routine',
            description: '',
            weekday: now.getDay(),
            start_minutes: now.getHours() * 60 + now.getMinutes() + 60,
            duration_min: 20,
            weights: {
              structure: spectrum.structure,
              momentum: spectrum.momentum,
              zen: spectrum.zen,
              stats: spectrum.stats,
            },
            priority: 60,
            platform_type: 'none',
            platform_user_id: spectrum.platform_user_id?.trim() || '',
            created_at: Date.now(),
          });
          await ensureRoutineIntentionInstancesForHorizon(
            routineId,
            spectrum.platform_user_id?.trim() || '',
          );
        } else if (action === 'project') {
          const stats = await getTrankilV2UserStats();
          if (stats.ia_credits <= 0) {
            Alert.alert(
              'Recharge IA',
              "Plus de credits IA. Regarde une video pour +5 credits.",
              [
                { text: 'Plus tard', style: 'cancel' },
                {
                  text: 'Regarder une video',
                  onPress: () => {
                    void (async () => {
                      const recharge = await runManualIaRechargeVideo();
                      if (!recharge.ok) {
                        const msg =
                          recharge.reason === 'daily_limit_reached'
                            ? "Limite de recharge quotidienne atteinte. Laisse ton IA reposer jusqu'a demain !"
                            : recharge.reason === 'recharge_cooldown'
                              ? 'Patiente 60 secondes entre deux recharges video.'
                              : 'Recharge indisponible pour le moment.';
                        Alert.alert('Recharge IA', msg);
                      } else {
                        Alert.alert('Recharge IA', '+5 credits IA ajoutes.');
                      }
                    })();
                  },
                },
              ],
            );
            return;
          }
          await consumeTrankilV2IntentCredit();
          const plan = await atomizeProject(rawTranscript.trim());
          const parentId = newId();
          await insertIntention({
            id: parentId,
            title: plan.projectTitle?.trim() || 'Projet',
            description: '',
            status: 'pending',
            priority: 80,
            weights: {
              structure: spectrum.structure,
              momentum: spectrum.momentum,
              zen: spectrum.zen,
              stats: spectrum.stats,
            },
            platform_type: 'none',
            platform_user_id: spectrum.platform_user_id?.trim() || '',
            created_at: Date.now(),
            estimated_duration: 60,
            raw_transcript: rawTranscript || null,
            type: 'project',
          });
          for (const task of plan.tasks ?? []) {
            await insertIntention({
              id: newId(),
              title: task.t?.trim() || 'Etape',
              description: '',
              status: 'pending',
              priority: 65,
              weights: {
                structure: spectrum.structure,
                momentum: spectrum.momentum,
                zen: spectrum.zen,
                stats: spectrum.stats,
              },
              platform_type: 'none',
              platform_user_id: spectrum.platform_user_id?.trim() || '',
              created_at: Date.now(),
              estimated_duration: 25,
              raw_transcript: rawTranscript || null,
              type: 'task',
              parent_id: parentId,
            });
          }
        } else if (action === 'audio') {
          await saveIntention(
            'note',
            rawTranscript.trim() || 'Memo audio',
            audioUri ? `audio://${audioUri}` : '',
          );
        }
        DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
        Alert.alert('Talk Debug', 'Action executee avec succes.');
        hardResetToIdle();
      } catch (e) {
        Alert.alert('Talk Debug', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [audioUri, hardResetToIdle, rawTranscript, saveIntention, spectrum],
  );

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Talk Debug - Post-Choix</Text>
      {captureStep === 'idle' ? (
        <View style={styles.stepIdleWrap}>
          <Pressable
            onPress={() => void startCapture()}
            disabled={busy}
            style={[styles.micBtn, busy ? styles.disabled : null]}
          >
            <Mic size={24} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {captureStep === 'recording' ? (
        <View style={styles.stepRecordingWrap}>
          <View style={styles.waveRow}>
            {waveHeights.map((h, idx) => (
              <View key={`bar-${idx}`} style={[styles.waveBar, { height: isPaused ? 8 : h }]} />
            ))}
          </View>
          <View style={styles.liveTranscriptWrap}>
            <ScrollView
              ref={(ref) => {
                liveScrollRef.current = ref;
              }}
              style={styles.liveTranscriptScroll}
              contentContainerStyle={styles.liveTranscriptContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => {
                if (captureStep === 'recording') {
                  liveScrollRef.current?.scrollToEnd({ animated: true });
                }
              }}
            >
              <Text style={styles.liveTranscript}>
                {rawTranscript.trim() ? rawTranscript : "Je t'ecoute..."}
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
          <View style={styles.pilotRow}>
            <Pressable style={styles.ctrlBtn} onPress={() => void cancelCapture()} disabled={busy}>
              <Trash2 size={18} color="#fff" />
            </Pressable>
            <Pressable style={styles.ctrlBtn} onPress={() => void togglePauseCapture()} disabled={busy}>
              {isPaused ? <Play size={18} color="#fff" /> : <Pause size={18} color="#fff" />}
            </Pressable>
            <Pressable style={styles.ctrlBtn} onPress={() => void stopCapture()} disabled={busy}>
              <SendHorizontal size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {captureStep === 'deciding' ? (
        <View style={styles.stepDecisionWrap}>
          <Text style={styles.transcript}>{rawTranscript || '(Transcription vide)'}</Text>
          <View style={styles.fanMenu}>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('project')} disabled={busy}>
              <Text style={styles.fanBtnText}>🚀 Projet (-1 credit IA)</Text>
            </Pressable>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('task')} disabled={busy}>
              <Text style={styles.fanBtnText}>⚡ Tache</Text>
            </Pressable>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('note')} disabled={busy}>
              <Text style={styles.fanBtnText}>📝 Note</Text>
            </Pressable>
            <Pressable style={styles.fanBtn} onPress={() => void onChooseAction('habit')} disabled={busy}>
              <Text style={styles.fanBtnText}>🔄 Habitude</Text>
            </Pressable>
            <Pressable style={[styles.fanBtn, styles.cancelBtn]} onPress={() => void onChooseAction('cancel')} disabled={busy}>
              <Text style={styles.fanBtnText}>🗑️ Annuler</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827', padding: 20, justifyContent: 'space-between' },
  title: { color: '#e5e7eb', fontSize: 18, fontWeight: '700', marginTop: 12 },
  stepIdleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepRecordingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 },
  stepDecisionWrap: { flex: 1, justifyContent: 'space-between', paddingVertical: 12 },
  waveRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 20 },
  waveBar: { width: 8, backgroundColor: '#22d3ee', borderRadius: 999 },
  transcript: { color: '#cbd5e1', fontSize: 16, textAlign: 'center', paddingHorizontal: 8 },
  liveTranscriptWrap: {
    width: '100%',
    maxHeight: 120,
    minHeight: 56,
    position: 'relative',
    justifyContent: 'center',
  },
  liveTranscriptScroll: {
    width: '100%',
  },
  liveTranscriptContent: {
    paddingVertical: 14,
  },
  liveTranscript: {
    color: '#BDC3C7',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 10,
    lineHeight: 22,
  },
  transcriptFadeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  transcriptFadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  micBtn: {
    alignSelf: 'center',
    marginBottom: 30,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: '#008080',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pilotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f766e',
  },
  disabled: { opacity: 0.5 },
  fanMenu: {
    gap: 10,
    paddingTop: 14,
    paddingBottom: 10,
  },
  fanBtn: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  fanBtnText: {
    color: '#0f172a',
    fontWeight: '700',
    textAlign: 'center',
  },
  cancelBtn: { backgroundColor: '#fee2e2' },
});
