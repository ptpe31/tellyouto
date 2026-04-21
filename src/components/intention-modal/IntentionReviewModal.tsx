import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { Cloud, Ellipsis, FileAudio2, FileText, Hourglass, MapPin, X } from 'lucide-react-native';
import type { IntentionDraft } from '../../services/intention/IntentionStateMachine';
import { IntentCardBirthday } from './IntentCard_Birthday';
import { IntentCardHabit } from './IntentCard_Habit';
import { IntentCardNote } from './IntentCard_Note';
import { IntentCardTask } from './IntentCard_Task';
import { IntentCardTimer } from './IntentCard_Timer';
import { IntentCardTrip } from './IntentCard_Trip';

type Props = {
  visible: boolean;
  busy: boolean;
  drafts: IntentionDraft[];
  transcript: string;
  audioUri: string | null;
  offlineNotice?: boolean;
  onChangeDraft: (index: number, next: IntentionDraft) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

type MorphType = 'TRIP' | 'TASK' | 'HABIT' | 'NOTE';
const MORPH_OPTIONS: MorphType[] = ['TRIP', 'TASK', 'HABIT', 'NOTE'];

const KNOWN_DESTINATIONS: Record<string, string> = {
  travail: 'Travail',
  bureau: 'Travail',
  maison: 'Maison',
  home: 'Maison',
  mamie: 'Chez Mamie',
};

function guessDestinationFromText(text: string): string {
  const normalized = text.toLowerCase();
  for (const key of Object.keys(KNOWN_DESTINATIONS)) {
    if (normalized.includes(key)) return KNOWN_DESTINATIONS[key];
  }
  return text.trim() || 'Destination';
}

function extractTimeHint(text: string): string {
  const m = text.match(/\b(\d{1,2}:\d{2})\b/);
  if (!m) return '';
  const [h, min] = m[1].split(':');
  const dt = new Date();
  dt.setHours(Math.max(0, Math.min(23, Number(h))), Math.max(0, Math.min(59, Number(min))), 0, 0);
  return dt.toISOString();
}

function convertDraftKind(draft: IntentionDraft, target: MorphType): IntentionDraft {
  if (target === 'TRIP') {
    if (draft.kind === 'TRIP') return draft;
    if (draft.kind === 'TASK') {
      return {
        kind: 'TRIP',
        destination: guessDestinationFromText(draft.title),
        arrivalTime: draft.time || extractTimeHint(draft.notes || draft.title) || new Date(Date.now() + 3600_000).toISOString(),
        safetyBuffer: 300,
        elasticJumpEnabled: true,
      };
    }
    if (draft.kind === 'HABIT') {
      return {
        kind: 'TRIP',
        destination: guessDestinationFromText(draft.title),
        arrivalTime: extractTimeHint(draft.time) || new Date(Date.now() + 3600_000).toISOString(),
        safetyBuffer: 300,
        elasticJumpEnabled: true,
      };
    }
    if (draft.kind === 'NOTE') {
      return {
        kind: 'TRIP',
        destination: guessDestinationFromText(draft.content),
        arrivalTime: extractTimeHint(draft.content) || new Date(Date.now() + 3600_000).toISOString(),
        safetyBuffer: 300,
        elasticJumpEnabled: true,
      };
    }
    return {
      kind: 'TRIP',
      destination: 'Destination',
      arrivalTime: new Date(Date.now() + 3600_000).toISOString(),
      safetyBuffer: 300,
      elasticJumpEnabled: true,
    };
  }
  if (target === 'TASK') {
    if (draft.kind === 'TASK') return draft;
    if (draft.kind === 'TRIP') {
      return {
        kind: 'TASK',
        title: draft.destination || 'Tache',
        time: draft.arrivalTime,
        notes: '',
      };
    }
    if (draft.kind === 'HABIT') {
      return { kind: 'TASK', title: draft.title, time: draft.time, notes: '' };
    }
    if (draft.kind === 'NOTE') {
      return { kind: 'TASK', title: draft.content.slice(0, 80) || 'Tache', time: '', notes: draft.content };
    }
    return { kind: 'TASK', title: 'Tache', time: '', notes: '' };
  }
  if (target === 'HABIT') {
    if (draft.kind === 'HABIT') return draft;
    if (draft.kind === 'TASK') {
      return { kind: 'HABIT', title: draft.title, time: draft.time || '08:00', frequency: 'daily' };
    }
    if (draft.kind === 'TRIP') {
      return { kind: 'HABIT', title: `Depart ${draft.destination}`, time: '08:00', frequency: 'daily' };
    }
    if (draft.kind === 'NOTE') {
      return { kind: 'HABIT', title: draft.content.slice(0, 80) || 'Routine', time: '08:00', frequency: 'daily' };
    }
    return { kind: 'HABIT', title: 'Routine', time: '08:00', frequency: 'daily' };
  }
  if (draft.kind === 'NOTE') return draft;
  if (draft.kind === 'TASK') return { kind: 'NOTE', content: [draft.title, draft.notes].filter(Boolean).join(' - ') };
  if (draft.kind === 'TRIP') return { kind: 'NOTE', content: `Trajet vers ${draft.destination} a ${draft.arrivalTime}` };
  if (draft.kind === 'HABIT') return { kind: 'NOTE', content: `${draft.title} (${draft.frequency})` };
  return { kind: 'NOTE', content: '' };
}

function getPastelColorFromText(text: string): string {
  const source = String(text || '').trim() || 'intention';
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const sat = 25 + (hash % 16);
  const light = 85 + (hash % 11);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function getDraftTitle(draft: IntentionDraft): string {
  if (draft.kind === 'TASK' || draft.kind === 'HABIT') return draft.title;
  if (draft.kind === 'TRIP') return draft.destination;
  if (draft.kind === 'NOTE') return draft.title?.trim() || draft.content.slice(0, 80);
  if (draft.kind === 'TIMER') return draft.label;
  if (draft.kind === 'BIRTHDAY') return draft.personName;
  return '';
}

function getDraftTimeLabel(draft: IntentionDraft): string | null {
  if (draft.kind === 'TASK') return draft.time || null;
  if (draft.kind === 'HABIT') return draft.time || null;
  if (draft.kind === 'TRIP') return draft.arrivalTime || null;
  if (draft.kind === 'TIMER') return `${draft.durationSec}s`;
  if (draft.kind === 'BIRTHDAY') return draft.date || null;
  return null;
}

function getDraftPlaceLabel(draft: IntentionDraft): string | null {
  if (draft.kind === 'TRIP') return draft.destination || null;
  if (draft.kind === 'TASK') return guessDestinationFromText(draft.title);
  return null;
}

function isLogisticsEligible(draft: IntentionDraft): boolean {
  return draft.kind === 'TRIP' || draft.kind === 'TASK' || draft.kind === 'HABIT';
}

function toMorphType(kind: IntentionDraft['kind']): MorphType | null {
  if (kind === 'TRIP' || kind === 'TASK' || kind === 'HABIT' || kind === 'NOTE') return kind;
  return null;
}

function kindI18nKey(kind: IntentionDraft['kind']): string {
  if (kind === 'TRIP') return 'intentionModal.kind.trip';
  if (kind === 'TASK') return 'intentionModal.kind.task';
  if (kind === 'HABIT') return 'intentionModal.kind.habit';
  if (kind === 'NOTE') return 'intentionModal.kind.note';
  if (kind === 'TIMER') return 'intentionModal.kind.timer';
  return 'intentionModal.kind.birthday';
}

export function IntentionReviewModal({
  visible,
  busy,
  drafts,
  transcript,
  audioUri,
  offlineNotice = false,
  onChangeDraft,
  onConfirm,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const cardAnim = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [showDelete, setShowDelete] = useState<Record<string, boolean>>({});
  const [logisticsEnabled, setLogisticsEnabled] = useState<Record<number, boolean>>({});
  const [locationDraft, setLocationDraft] = useState<Record<number, string>>({});
  const colorLockRef = useRef<Record<string, string>>({});
  const soundRef = useRef<Audio.Sound | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);

  const stableColors = useMemo(
    () =>
      drafts.map((d, i) => {
        const key = `${i}:${getDraftTitle(d).trim().toLowerCase()}`;
        if (!colorLockRef.current[key]) {
          colorLockRef.current[key] = getPastelColorFromText(getDraftTitle(d));
        }
        return colorLockRef.current[key];
      }),
    [drafts],
  );

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);
  useEffect(() => {
    if (!visible) return;
    cardAnim.setValue(0);
    Animated.timing(cardAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [cardAnim, visible]);

  useEffect(() => {
    const unload = async () => {
      if (!soundRef.current) return;
      try {
        await soundRef.current.unloadAsync();
      } catch {
        /* ignore */
      }
      soundRef.current = null;
      setAudioPlaying(false);
      setAudioProgress(0);
    };
    if (!visible) {
      void unload();
    }
    return () => {
      void unload();
    };
  }, [visible]);

  const toggleExpand = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleDeleteBadge = (index: number, target: 'transcript' | 'audio') => {
    const key = `${index}:${target}`;
    setShowDelete((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAudioPlayback = async () => {
    if (!audioUri) return;
    if (!soundRef.current) {
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true, progressUpdateIntervalMillis: 300 },
        (status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;
          setAudioPlaying(status.isPlaying);
          const next = status.durationMillis
            ? Math.min(1, status.positionMillis / status.durationMillis)
            : 0;
          setAudioProgress(next);
        },
      );
      soundRef.current = sound;
      return;
    }
    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) await soundRef.current.pauseAsync();
    else await soundRef.current.playAsync();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.sheet,
            {
              opacity: cardAnim,
              transform: [
                {
                  translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.title}>{t('intentionModal.title')}</Text>
          {offlineNotice ? (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerText}>{t('capture.offlineAudioCapturedTitle')}</Text>
            </View>
          ) : null}
          <ScrollView contentContainerStyle={styles.stack}>
            {drafts.map((draft, index) => {
              const selectedMorph = toMorphType(draft.kind);
              const cardTitle = getDraftTitle(draft).trim() || t('intentionModal.untitled');
              const timeLabel = getDraftTimeLabel(draft);
              const placeLabel = getDraftPlaceLabel(draft);
              const isExpanded = Boolean(expanded[index]);
              const isAudioMemo = draft.kind === 'NOTE' && draft.isAudioMemo === true;
              const pendingCloud = draft.kind === 'NOTE' && draft.isPendingAnalysis === true;
              const onMorph = (target: MorphType) => {
                if (target === selectedMorph || !selectedMorph) return;
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                onChangeDraft(index, convertDraftKind(draft, target));
              };
              if (draft.kind === 'TRIP' || draft.kind === 'TASK' || draft.kind === 'HABIT' || draft.kind === 'NOTE') {
                return (
                  <View key={`morph-${index}`} style={styles.cardShell}>
                    <View style={[styles.intentHead, { backgroundColor: stableColors[index] }]}>
                      <View style={styles.intentTitleRow}>
                        <Text style={styles.intentTitle}>{cardTitle}</Text>
                        {pendingCloud ? (
                          <View style={styles.pendingCloudWrap}>
                            <Cloud size={15} color="#475569" style={styles.pendingCloudIcon} />
                            <Hourglass size={10} color="#64748b" style={styles.pendingCloudBadge} />
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.expandRow}>
                        <Pressable
                          style={styles.expandBtn}
                          onPress={() => toggleExpand(index)}
                          accessibilityRole="button"
                        >
                          <Ellipsis size={15} color="#475569" />
                        </Pressable>
                      </View>
                    </View>
                    {isExpanded ? (
                      <View style={[styles.expandPanel, { backgroundColor: stableColors[index] }]}>
                        <Text style={styles.expandTranscript}>{transcript || t('intentionModal.noTranscript')}</Text>
                        <View style={styles.metaRow}>
                          {!isAudioMemo ? (
                            <View style={styles.metaPill}>
                              <Text style={styles.metaText}>{t('intentionModal.categoryLeisure')}</Text>
                            </View>
                          ) : null}
                          <View style={styles.metaPill}>
                            <Text style={styles.metaText}>
                              {isAudioMemo ? t('intentionModal.audioMemoType') : t(kindI18nKey(draft.kind))}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.fileRow}>
                          <Pressable
                            style={styles.fileIconWrap}
                            onLongPress={() => toggleDeleteBadge(index, 'transcript')}
                          >
                            {showDelete[`${index}:transcript`] ? (
                              <Pressable style={styles.deleteBadge}>
                                <X size={11} color="#0f172a" />
                              </Pressable>
                            ) : null}
                            <FileText size={20} color="#64748b" />
                          </Pressable>
                          {audioUri ? (
                            <Pressable
                              style={styles.fileIconWrap}
                              onLongPress={() => toggleDeleteBadge(index, 'audio')}
                            >
                              {showDelete[`${index}:audio`] ? (
                                <Pressable style={styles.deleteBadge}>
                                  <X size={11} color="#0f172a" />
                                </Pressable>
                              ) : null}
                              <FileAudio2 size={20} color="#64748b" />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : null}

                    {isAudioMemo && audioUri ? (
                      <View style={styles.audioPlayerCard}>
                        <Pressable style={styles.audioPlayBtn} onPress={() => void toggleAudioPlayback()}>
                          <Text style={styles.audioPlayText}>
                            {audioPlaying ? t('intentionModal.pause') : t('intentionModal.play')}
                          </Text>
                        </Pressable>
                        <View style={styles.audioTrack}>
                          <View style={[styles.audioTrackProgress, { width: `${Math.max(2, Math.round(audioProgress * 100))}%` }]} />
                        </View>
                      </View>
                    ) : null}

                    {!isAudioMemo && timeLabel ? (
                      <View style={styles.infoPill}>
                        <Text style={styles.infoPillText}>{timeLabel}</Text>
                      </View>
                    ) : null}
                    {!isAudioMemo && placeLabel ? (
                      <View style={styles.infoPill}>
                        <MapPin size={15} color="#64748b" />
                        <Text style={styles.infoPillText}>{locationDraft[index] || placeLabel}</Text>
                      </View>
                    ) : null}
                    {!isAudioMemo && isLogisticsEligible(draft) ? (
                      <View style={styles.logisticsRow}>
                        <Pressable
                          style={[styles.toggleTrack, logisticsEnabled[index] ? styles.toggleTrackOn : null]}
                          onPress={() => setLogisticsEnabled((prev) => ({ ...prev, [index]: !prev[index] }))}
                        >
                          <View style={[styles.toggleThumb, logisticsEnabled[index] ? styles.toggleThumbOn : null]} />
                        </Pressable>
                        <Text style={styles.logisticsText}>{t('intentionModal.logisticsToggle')}</Text>
                      </View>
                    ) : null}
                    {!isAudioMemo && logisticsEnabled[index] ? (
                      <TextInput
                        value={locationDraft[index] ?? placeLabel ?? ''}
                        onChangeText={(v) => setLocationDraft((prev) => ({ ...prev, [index]: v }))}
                        placeholder={t('intentionModal.wherePlaceholder')}
                        style={styles.addressInput}
                      />
                    ) : null}

                    {!isAudioMemo ? <View style={styles.typeRow}>
                      {MORPH_OPTIONS.map((opt) => (
                        <Pressable
                          key={`${index}-${opt}`}
                          style={[styles.typeChip, selectedMorph === opt ? styles.typeChipActive : null]}
                          onPress={() => onMorph(opt)}
                        >
                          <Text style={[styles.typeChipText, selectedMorph === opt ? styles.typeChipTextActive : null]}>
                            {opt === 'TRIP'
                              ? t('intentionModal.kind.trip')
                              : opt === 'TASK'
                                ? t('intentionModal.kind.task')
                                : opt === 'HABIT'
                                  ? t('intentionModal.kind.habit')
                                  : t('intentionModal.kind.note')}
                          </Text>
                        </Pressable>
                      ))}
                    </View> : null}
                    {draft.kind === 'TRIP' ? <IntentCardTrip draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
                    {draft.kind === 'TASK' ? <IntentCardTask draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
                    {draft.kind === 'HABIT' ? <IntentCardHabit draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
                    {draft.kind === 'NOTE' && !isAudioMemo ? <IntentCardNote draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
                  </View>
                );
              }
              if (draft.kind === 'TIMER') {
                return <IntentCardTimer key={`timer-${index}`} draft={draft} onChange={(next) => onChangeDraft(index, next)} />;
              }
              if (draft.kind === 'BIRTHDAY') {
                return (
                  <IntentCardBirthday
                    key={`birthday-${index}`}
                    draft={draft}
                    onChange={(next) => onChangeDraft(index, next)}
                  />
                );
              }
              return null;
            })}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onDismiss} disabled={busy}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.confirmBtn} onPress={onConfirm} disabled={busy}>
              <Text style={styles.confirmText}>
                {drafts.some((d) => d.kind === 'NOTE' && d.isAudioMemo) ? t('intentionModal.saveNote') : t('intentionModal.save')}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#f8faf8', borderRadius: 20, maxHeight: '84%', padding: 16, gap: 12 },
  title: { fontSize: 19, fontWeight: '800', color: '#0f172a' },
  stack: { gap: 10, paddingBottom: 4 },
  offlineBanner: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(148,163,184,0.2)',
  },
  offlineBannerText: { color: '#334155', fontSize: 12, fontWeight: '600' },
  cardShell: {
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    padding: 10,
  },
  intentHead: { borderRadius: 14, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  intentTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  intentTitle: { fontSize: 32, lineHeight: 36, fontWeight: '800', color: '#0f172a' },
  pendingCloudWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', opacity: 0.52 },
  pendingCloudIcon: {},
  pendingCloudBadge: { position: 'absolute', right: -1, bottom: -1 },
  expandRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  expandBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  expandPanel: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, gap: 10 },
  expandTranscript: { fontSize: 12, color: '#334155' },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaPill: { borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.5)', paddingVertical: 6, paddingHorizontal: 10 },
  metaText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  fileRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  fileIconWrap: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  deleteBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  infoPill: {
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.16)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoPillText: { color: '#334155', fontWeight: '600' },
  audioPlayerCard: {
    borderRadius: 14,
    backgroundColor: 'rgba(148,163,184,0.12)',
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 10,
  },
  audioPlayBtn: {
    borderRadius: 999,
    backgroundColor: '#0f172a',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  audioPlayText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  audioTrack: {
    width: '100%',
    height: 3,
    borderRadius: 99,
    backgroundColor: 'rgba(100,116,139,0.3)',
    overflow: 'hidden',
  },
  audioTrackProgress: {
    height: 3,
    borderRadius: 99,
    backgroundColor: '#0f172a',
  },
  logisticsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#cbd5e1',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackOn: { backgroundColor: '#34d399' },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  logisticsText: { color: '#475569', fontWeight: '600' },
  addressInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0f172a',
  },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  typeChip: { borderRadius: 999, backgroundColor: 'rgba(148,163,184,0.22)', paddingHorizontal: 10, paddingVertical: 8 },
  typeChipActive: { backgroundColor: '#008080' },
  typeChipText: { color: '#0f172a', fontWeight: '600' },
  typeChipTextActive: { color: '#fff' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0' },
  confirmBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#008080' },
  cancelText: { fontWeight: '600', color: '#0f172a' },
  confirmText: { fontWeight: '700', color: '#fff' },
});
