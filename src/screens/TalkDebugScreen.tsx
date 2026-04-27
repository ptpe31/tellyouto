import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';

import { orchestrateNewIntention } from '../services/intentionsPipeline';
import { TalkCaptureMicButton } from '../components/TalkCaptureMicButton';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { getOrCreateViaUserId, withViaDb } from '../services/db/Schema';
import { Platform as RPlatform } from '../utils/rnPlatform';
import { neumorphicInset, neumorphicRaised } from '../theme/neumorphism';

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

type CoreIntentionRow = {
  id: string;
  type: string;
  title: string;
  contentRaw: string;
  createdAtMs: number;
};

export function TalkHomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [phoenixInput, setPhoenixInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<CoreIntentionRow[]>([]);

  const refresh = useCallback(async () => {
    const userId = await getOrCreateViaUserId();
    const next = await withViaDb(async (db) => {
      const r = await db.getAllAsync<Record<string, unknown>>(
        `SELECT id, type, title, content_raw, created_at_ms
           FROM core_intentions
          WHERE user_id = ?
          ORDER BY created_at_ms DESC
          LIMIT 50`,
        [userId],
      );
      return r.map((x) => ({
        id: String(x.id ?? ''),
        type: String(x.type ?? ''),
        title: String(x.title ?? ''),
        contentRaw: String(x.content_raw ?? ''),
        createdAtMs: Number(x.created_at_ms ?? 0) || 0,
      }));
    });
    setRows(next);
  }, []);

  useEffect(() => {
    void refresh();
    const sub = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => {
      void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const renderItem = useCallback(
    ({ item }: { item: CoreIntentionRow }) => {
      return (
        <View style={[styles.rowCard, neumorphicRaised(theme)]}>
          <Text style={[styles.rowType, { color: theme.colors.primary }]}>{item.type}</Text>
          <Text style={[styles.rowTitle, { color: theme.colors.onSurface }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.rowBody, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>
            {item.contentRaw}
          </Text>
        </View>
      );
    },
    [theme],
  );

  const keyExtractor = useCallback((item: CoreIntentionRow) => item.id, []);

  const onSubmitPhoenix = useCallback(async () => {
    if (busy) return;
    const raw = phoenixInput;
    const segments = splitBatchInput(raw);
    if (segments.length === 0) return;
    setBusy(true);
    try {
      if (segments.length > 1) {
        console.log(
          `${ANSI.cyan}${ANSI.bold}[BANC-DE-TEST] 🚀 Lancement d'un batch de ${segments.length} intentions.${ANSI.reset}`,
        );
      }
      for (const [idx, segment] of segments.entries()) {
        console.log(stars(`[ BANC-DE-TEST ${idx + 1}/${segments.length} ]`));
        try {
          await orchestrateNewIntention({
            source: 'TEXT',
            content: segment,
          });
          DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME);
          console.log(`${ANSI.green}${ANSI.bold}[BANC-DE-TEST] ✅ OK${ANSI.reset}`);
        } catch (e) {
          console.log(
            `${ANSI.red}${ANSI.bold}[BANC-DE-TEST] ❌ Erreur: ${e instanceof Error ? e.message : String(e)}${ANSI.reset}`,
          );
        }
      }
      if (segments.length > 1) {
        console.log(`${ANSI.yellow}${ANSI.bold}[BANC-DE-TEST] ✅ Fin du batch. Base de données à jour.${ANSI.reset}`);
      }
      setPhoenixInput('');
    } finally {
      setBusy(false);
    }
  }, [busy, phoenixInput]);

  const keyboardBehavior = useMemo(() => (RPlatform.OS === 'ios' ? 'padding' : undefined), []);

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      behavior={keyboardBehavior}
      keyboardVerticalOffset={Math.max(0, insets.top + 6)}
    >
      <View style={styles.flex}>
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[styles.listPad, { paddingTop: Math.max(insets.top, 6) + 78 }]}
          ListHeaderComponent={
            <View />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
                {t('timeline.empty')}
              </Text>
            </View>
          }
        />
        <View style={[styles.headerSafe, { paddingTop: Math.max(insets.top, 6) }]}>
          <View style={styles.phoenixRow}>
            <TextInput
              value={phoenixInput}
              onChangeText={setPhoenixInput}
              editable={!busy}
              placeholder={t('talkHome.placeholderPhoenix', { defaultValue: 'Tape ton intention ici...' })}
              placeholderTextColor="rgba(226,232,240,0.55)"
              style={styles.phoenixInput}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={() => void onSubmitPhoenix()}
            />
            <TouchableOpacity
              style={[styles.phoenixSendBtn, busy ? styles.disabled : null]}
              onPress={() => void onSubmitPhoenix()}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Text style={styles.phoenixSendText}>{t('talkHome.send', { defaultValue: 'Envoyer' })}</Text>
            </TouchableOpacity>
          </View>
          <Pressable
            style={styles.brandRow}
            onPress={() => void refresh()}
          >
            <Text style={[styles.brand, { color: theme.colors.onBackground }]}>{t('talkHome.brandName')}</Text>
          </Pressable>
        </View>

        <View style={[styles.micDock, { paddingBottom: Math.max(10, insets.bottom + 10) }]}>
          <TalkCaptureMicButton disabled={busy} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerSafe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
  },
  phoenixRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phoenixInput: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(15,23,42,0.72)',
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  phoenixSendBtn: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(94,234,212,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(94,234,212,0.28)',
  },
  phoenixSendText: { color: '#e2e8f0', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  brandRow: { paddingHorizontal: 2 },
  brand: { fontSize: 16, fontWeight: '900' },
  listPad: { paddingHorizontal: 16, paddingBottom: 180, gap: 10 },
  rowCard: { padding: 14, borderRadius: 18, gap: 6 },
  rowType: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  rowTitle: { fontSize: 14, fontWeight: '900' },
  rowBody: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  emptyWrap: { paddingHorizontal: 16, paddingTop: 14 },
  emptyText: { fontSize: 13, fontWeight: '700' },
  bottomArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    gap: 10,
  },
  micDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
