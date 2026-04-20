import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { IntentionDraftTrip } from '../../services/intention/IntentionStateMachine';

type Props = {
  draft: IntentionDraftTrip;
  onChange: (next: IntentionDraftTrip) => void;
};

export function IntentCardTrip({ draft, onChange }: Props) {
  const [showAddressChoices, setShowAddressChoices] = useState(false);
  const favoriteDestinations = ['Maison', 'Travail', 'Mamie', 'Salle de sport'];

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Trajet</Text>
      <TextInput
        value={draft.destination}
        onChangeText={(destination) => onChange({ ...draft, destination })}
        placeholder="Destination"
        style={styles.input}
      />
      <TextInput
        value={draft.arrivalTime}
        onChangeText={(arrivalTime) => onChange({ ...draft, arrivalTime })}
        placeholder="Arrivee (ISO)"
        style={styles.input}
      />
      <Pressable style={styles.verifyBtn} onPress={() => setShowAddressChoices((v) => !v)}>
        <Text style={styles.verifyBtnText}>Verifier l'adresse</Text>
      </Pressable>
      {showAddressChoices ? (
        <View style={styles.favoritesRow}>
          {favoriteDestinations.map((item) => (
            <Pressable key={item} style={styles.favoriteChip} onPress={() => onChange({ ...draft, destination: item })}>
              <Text style={styles.favoriteChipText}>{item}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleChip, draft.elasticJumpEnabled !== false ? styles.toggleChipActive : null]}
          onPress={() => onChange({ ...draft, elasticJumpEnabled: !(draft.elasticJumpEnabled !== false) })}
        >
          <Text style={styles.toggleText}>Saut Elastique</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleChip, draft.safetyBuffer === 300 ? styles.toggleChipActive : null]}
          onPress={() => onChange({ ...draft, safetyBuffer: draft.safetyBuffer === 300 ? 0 : 300 })}
        >
          <Text style={styles.toggleText}>Buffer 5 min</Text>
        </Pressable>
      </View>
      <Text style={styles.meta}>
        Surveillance: {draft.elasticJumpEnabled !== false ? 'active' : 'off'} · Buffer: {draft.safetyBuffer}s
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  verifyBtn: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: '#cffafe', paddingHorizontal: 10, paddingVertical: 8 },
  verifyBtnText: { color: '#155e75', fontWeight: '600' },
  favoritesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  favoriteChip: { borderRadius: 999, backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 8 },
  favoriteChipText: { color: '#334155', fontWeight: '600' },
  toggleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  toggleChip: { borderRadius: 999, backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 8 },
  toggleChipActive: { backgroundColor: '#99f6e4' },
  toggleText: { color: '#0f172a', fontWeight: '600' },
  meta: { fontSize: 12, color: '#334155' },
});
