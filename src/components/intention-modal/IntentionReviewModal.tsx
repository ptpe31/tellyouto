import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { IntentionDraft } from '../../services/intention/IntentionStateMachine';
import { IntentCardBirthday } from './IntentCard_Birthday';
import { IntentCardHabit } from './IntentCard_Habit';
import { IntentCardNote } from './IntentCard_Note';
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
              if (draft.kind === 'TRIP') {
                return <IntentCardTrip key={`trip-${index}`} draft={draft} onChange={(next) => onChangeDraft(index, next)} />;
              }
              if (draft.kind === 'HABIT') {
                return <IntentCardHabit key={`habit-${index}`} draft={draft} onChange={(next) => onChangeDraft(index, next)} />;
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
              return <IntentCardNote key={`note-${index}`} draft={draft} onChange={(next) => onChangeDraft(index, next)} />;
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
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0' },
  confirmBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#008080' },
  cancelText: { fontWeight: '600', color: '#0f172a' },
  confirmText: { fontWeight: '700', color: '#fff' },
});
