import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from 'react-native-paper';

import { orchestrateNewIntention } from '../services/intentionsPipeline';

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  white: '\u001b[37m',
};

function stars(label: string): string {
  return `${ANSI.bold}${ANSI.white}**************** ${label} ****************${ANSI.reset}`;
}

function splitBatchInput(raw: string): string[] {
  const s = String(raw ?? '');
  if (!s.includes('//')) return [s];
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = i + 1 < s.length ? s[i + 1] : '';
    if (ch === '/' && next === '/') {
      const prev = i > 0 ? s[i - 1] : '';
      const isUrl = prev === ':';
      const before = i > 0 ? s[i - 1] : '';
      const after = i + 2 < s.length ? s[i + 2] : '';
      const beforeOk = before === '' || /\s/.test(before);
      const afterOk = after === '' || /\s/.test(after);
      if (!isUrl && (beforeOk || afterOk)) {
        out.push(buf);
        buf = '';
        i++;
        continue;
      }
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

export function TalkHomeScreen() {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const dueAtMs = dueAt ? new Date(dueAt).getTime() : null;
      const segments = splitBatchInput(note);
      if (segments.length > 1) {
        console.log(
          `${ANSI.cyan}${ANSI.bold}[BANC-DE-TEST] 🚀 Lancement d'un batch de ${segments.length} intentions.${ANSI.reset}`
        );
      }
      for (const [idx, segment] of segments.entries()) {
        console.log(stars(`[ BANC-DE-TEST ${idx + 1}/${segments.length} ]`));
        try {
          await orchestrateNewIntention({
            source: 'TEXT',
            content: segment,
            title: title || t('talk.debugFallbackTitle'),
            dueAtMs,
          });
          console.log(`${ANSI.green}${ANSI.bold}[BANC-DE-TEST] ✅ OK${ANSI.reset}`);
        } catch (e) {
          console.log(
            `${ANSI.red}${ANSI.bold}[BANC-DE-TEST] ❌ Erreur: ${e instanceof Error ? e.message : String(e)}${ANSI.reset}`
          );
        }
      }
      if (segments.length > 1) {
        console.log(`${ANSI.yellow}${ANSI.bold}[BANC-DE-TEST] ✅ Fin du batch. Base de données à jour.${ANSI.reset}`);
      }
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
