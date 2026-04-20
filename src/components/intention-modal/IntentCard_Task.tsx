import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { IntentionDraftTask } from '../../services/intention/IntentionStateMachine';

type Props = {
  draft: IntentionDraftTask;
  onChange: (next: IntentionDraftTask) => void;
};

export function IntentCardTask({ draft, onChange }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Tache</Text>
      <TextInput
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        placeholder="Titre"
        style={styles.input}
      />
      <TextInput
        value={draft.time}
        onChangeText={(time) => onChange({ ...draft, time })}
        placeholder="Heure (ISO ou HH:mm)"
        style={styles.input}
      />
      <TextInput
        multiline
        value={draft.notes}
        onChangeText={(notes) => onChange({ ...draft, notes })}
        placeholder="Notes"
        style={styles.inputMultiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  inputMultiline: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
