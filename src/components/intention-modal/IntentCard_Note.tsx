import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { IntentionDraftNote } from '../../services/intention/IntentionStateMachine';

type Props = {
  draft: IntentionDraftNote;
  onChange: (next: IntentionDraftNote) => void;
};

export function IntentCardNote({ draft, onChange }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Note</Text>
      <TextInput
        multiline
        value={draft.content}
        onChangeText={(content) => onChange({ ...draft, content })}
        placeholder="Contenu"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 84,
    textAlignVertical: 'top',
  },
});
