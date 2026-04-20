import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { IntentionDraftHabit } from '../../services/intention/IntentionStateMachine';

type Props = {
  draft: IntentionDraftHabit;
  onChange: (next: IntentionDraftHabit) => void;
};

export function IntentCardHabit({ draft, onChange }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Habitude</Text>
      <TextInput
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        placeholder="Titre"
        style={styles.input}
      />
      <TextInput
        value={draft.time}
        onChangeText={(time) => onChange({ ...draft, time })}
        placeholder="Heure (HH:mm)"
        style={styles.input}
      />
      <Pressable
        style={styles.routineBtn}
        onPress={() => onChange({ ...draft, frequency: draft.frequency === 'daily' ? 'weekly' : 'daily' })}
      >
        <Text style={styles.routineText}>Transformer en routine ({draft.frequency})</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  routineBtn: { borderRadius: 10, backgroundColor: '#e0f2fe', paddingVertical: 10, paddingHorizontal: 12 },
  routineText: { color: '#0c4a6e', fontWeight: '600' },
});
