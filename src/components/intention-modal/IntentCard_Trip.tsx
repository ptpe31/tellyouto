import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { IntentionDraftTrip } from '../../services/intention/IntentionStateMachine';

type Props = {
  draft: IntentionDraftTrip;
  onChange: (next: IntentionDraftTrip) => void;
};

export function IntentCardTrip({ draft, onChange }: Props) {
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
      <Text style={styles.meta}>Buffer securite: {draft.safetyBuffer}s</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  meta: { fontSize: 12, color: '#334155' },
});
