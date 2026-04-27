import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { randomUUID } from 'expo-crypto';
import { Button } from 'react-native-paper';

import { withViaDb, getOrCreateViaUserId } from '../services/db/Schema';

export function TalkHomeScreen() {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const userId = await getOrCreateViaUserId();
      const now = Date.now();
      const dueAtMs = dueAt ? new Date(dueAt).getTime() : null;
      await withViaDb(async (db) => {
        await db.runAsync(
          `INSERT INTO core_intentions (
            id, user_id, type, title, content_raw, due_at_ms, status, metadata_json, created_at_ms, updated_at_ms, is_synced
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', '{}', ?, ?, 0)`,
          [randomUUID(), userId, 'NOTE', title || t('talk.debugFallbackTitle'), note, dueAtMs, now, now]
        );
      });
      setTitle('');
      setNote('');
      setDueAt('');
    } finally {
      setBusy(false);
    }
  }, [dueAt, note, t, title]);

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Text style={styles.h1}>{t('talk.title')}</Text>
      <Text style={styles.hint}>{t('talk.helper')}</Text>
      <View style={styles.block}>
        <Text style={styles.label}>{t('talk.titleLabel')}</Text>
        <TextInput value={title} onChangeText={setTitle} style={styles.input} />
        <Text style={styles.label}>{t('talk.noteLabel')}</Text>
        <TextInput value={note} onChangeText={setNote} style={[styles.input, styles.multiline]} multiline />
        <Text style={styles.label}>{t('talk.dueLabel')}</Text>
        <TextInput value={dueAt} onChangeText={setDueAt} style={styles.input} placeholder="2026-05-03 09:00" />
        <Button mode="contained" onPress={save} loading={busy} disabled={busy}>
          {t('talk.saveCta')}
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40, gap: 10 },
  h1: { fontSize: 22, fontWeight: '900', color: '#0f172a' },
  hint: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  block: { gap: 10, marginTop: 8 },
  label: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: '#0f172a',
    fontSize: 14,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
