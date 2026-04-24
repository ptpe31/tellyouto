import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { IntentionDraftBirthday } from '../../services/intention/IntentionStateMachine';

type Props = {
  draft: IntentionDraftBirthday;
  onChange: (next: IntentionDraftBirthday) => void;
};

const AUTO_TASKS = ['Acheter un cadeau', 'Preparer gateau pour 8 personnes'];

export function IntentCardBirthday({ draft, onChange }: Props) {
  const addTask = (task: string) => {
    if (draft.specialTasks.includes(task)) return;
    onChange({ ...draft, specialTasks: [...draft.specialTasks, task] });
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Anniversaire</Text>
      <TextInput
        value={draft.personName}
        onChangeText={(personName) => onChange({ ...draft, personName })}
        placeholder="Personne"
        style={styles.input}
      />
      <TextInput
        value={draft.date}
        onChangeText={(date) => onChange({ ...draft, date })}
        placeholder="Date (ISO)"
        style={styles.input}
      />
      <View style={styles.taskRow}>
        {AUTO_TASKS.map((task) => (
          <Pressable key={task} style={styles.taskChip} onPress={() => addTask(task)}>
            <Text style={styles.taskChipText}>{task}</Text>
          </Pressable>
        ))}
      </View>
      {draft.specialTasks.map((task) => (
        <Text key={task} style={styles.taskLine}>
          - {task}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: '#fff', padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  taskRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  taskChip: { borderRadius: 999, backgroundColor: '#ffedd5', paddingHorizontal: 10, paddingVertical: 8 },
  taskChipText: { color: '#9a3412', fontWeight: '600' },
  taskLine: { color: '#334155', fontSize: 13 },
});
