import React, { useEffect, useRef } from 'react';
import {
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
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

export function IntentionReviewModal({
  visible,
  busy,
  drafts,
  onChangeDraft,
  onConfirm,
  onDismiss,
}: Props) {
  const cardAnim = useRef(new Animated.Value(0)).current;
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
          <Text style={styles.title}>Catalogue des intentions</Text>
          <ScrollView contentContainerStyle={styles.stack}>
            {drafts.map((draft, index) => {
              const selectedMorph: MorphType =
                draft.kind === 'TRIP' || draft.kind === 'TASK' || draft.kind === 'HABIT' || draft.kind === 'NOTE'
                  ? draft.kind
                  : 'NOTE';
              const onMorph = (target: MorphType) => {
                if (target === selectedMorph) return;
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                onChangeDraft(index, convertDraftKind(draft, target));
              };
              if (draft.kind === 'TRIP' || draft.kind === 'TASK' || draft.kind === 'HABIT' || draft.kind === 'NOTE') {
                return (
                  <View key={`morph-${index}`} style={styles.cardShell}>
                    <View style={styles.typeRow}>
                      {MORPH_OPTIONS.map((opt) => (
                        <Pressable
                          key={`${index}-${opt}`}
                          style={[styles.typeChip, selectedMorph === opt ? styles.typeChipActive : null]}
                          onPress={() => onMorph(opt)}
                        >
                          <Text style={[styles.typeChipText, selectedMorph === opt ? styles.typeChipTextActive : null]}>
                            {opt === 'TRIP' ? 'Trajet' : opt === 'TASK' ? 'Tache' : opt === 'HABIT' ? 'Habitude' : 'Memo'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {draft.kind === 'TRIP' ? <IntentCardTrip draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
                    {draft.kind === 'TASK' ? <IntentCardTask draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
                    {draft.kind === 'HABIT' ? <IntentCardHabit draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
                    {draft.kind === 'NOTE' ? <IntentCardNote draft={draft} onChange={(next) => onChangeDraft(index, next)} /> : null}
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
              <Text style={styles.cancelText}>Annuler</Text>
            </Pressable>
            <Pressable style={styles.confirmBtn} onPress={onConfirm} disabled={busy}>
              <Text style={styles.confirmText}>C'est exactement ca</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#f5f5f0', borderRadius: 20, maxHeight: '84%', padding: 16, gap: 12 },
  title: { fontSize: 19, fontWeight: '800', color: '#0f172a' },
  stack: { gap: 10, paddingBottom: 4 },
  cardShell: { gap: 8 },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeChip: { borderRadius: 999, backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 8 },
  typeChipActive: { backgroundColor: '#008080' },
  typeChipText: { color: '#0f172a', fontWeight: '600' },
  typeChipTextActive: { color: '#fff' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0' },
  confirmBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#008080' },
  cancelText: { fontWeight: '600', color: '#0f172a' },
  confirmText: { fontWeight: '700', color: '#fff' },
});
