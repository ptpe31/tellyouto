import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';

import {
  DeviceEventEmitter,
} from 'react-native';
import { STRINGS } from '../constants/Strings';
import {
  INTENTIONS_CHANGED_EVENT_NAME,
  LOCAL_DB_RESET_EVENT,
  getUserStatus,
  listIntentionsDescending,
  resetLocalDatabaseSchema,
  type IntentionRow,
  type UserStatusRow,
} from '../api/localDb';

type InspectorRow = {
  key: string;
  table: 'intentions' | 'user_status';
  payload: Record<string, unknown>;
};

function normalizeIntention(row: IntentionRow): Record<string, unknown> {
  return {
    id: row.id,
    transcription_brute: row.raw_transcript ?? '',
    titre_ia: row.title,
    resume_ia: row.description,
    category: row.type,
    tags: row.semantic_tags,
    timestamp: row.created_at,
    source: row,
  };
}

function normalizeUserStatus(row: UserStatusRow): Record<string, unknown> {
  return {
    id: '1',
    category: 'user_status',
    tags: ['zen_state'],
    timestamp: Date.now(),
    source: row,
  };
}

export function RawDataInspector() {
  const theme = useTheme();
  const [rows, setRows] = useState<InspectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRows = useCallback(async () => {
    setRefreshing(true);
    try {
      const [intentions, userStatus] = await Promise.all([
        listIntentionsDescending(),
        getUserStatus(),
      ]);
      const formatted: InspectorRow[] = [
        ...intentions.map((row) => ({
          key: `intentions:${row.id}`,
          table: 'intentions' as const,
          payload: normalizeIntention(row),
        })),
        {
          key: 'user_status:1',
          table: 'user_status',
          payload: normalizeUserStatus(userStatus),
        },
      ];
      setRows(formatted);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const s1 = DeviceEventEmitter.addListener(LOCAL_DB_RESET_EVENT, () => {
      void loadRows();
    });
    const s2 = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => {
      void loadRows();
    });
    return () => {
      s1.remove();
      s2.remove();
    };
  }, [loadRows]);

  const onCopy = useCallback(async (payload: Record<string, unknown>) => {
    const text = JSON.stringify(payload, null, 2);
    await Clipboard.setStringAsync(text);
  }, []);

  const onClearDatabase = useCallback(() => {
    Alert.alert(
      STRINGS.REWARDS.CLEAR_DATABASE,
      STRINGS.REWARDS.CLEAR_DATABASE_BODY,
      [
        { text: STRINGS.COMMON.CANCEL, style: 'cancel' },
        {
          text: STRINGS.REWARDS.CLEAR_DATABASE,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLoading(true);
              await resetLocalDatabaseSchema();
              await loadRows();
            })();
          },
        },
      ],
    );
  }, [loadRows]);

  const headerInfo = useMemo(() => {
    const intentionCount = rows.filter((r) => r.table === 'intentions').length;
    return `${intentionCount} intentions · ${rows.length} lignes`;
  }, [rows]);

  return (
    <View style={styles.root}>
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnNeutral, pressed && styles.pressed]}
          onPress={() => {
            void loadRows();
          }}
        >
          <Text style={styles.btnText}>{STRINGS.COMMON.REFRESH}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.pressed]}
          onPress={onClearDatabase}
        >
          <Text style={styles.btnText}>{STRINGS.REWARDS.CLEAR_DATABASE}</Text>
        </Pressable>
      </View>
      <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>{headerInfo}</Text>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : (
        rows.map((row) => {
          const pretty = JSON.stringify(row.payload, null, 2);
          return (
            <View key={row.key} style={styles.item}>
              <View style={styles.itemHeader}>
                <Text style={[styles.tableTag, { color: theme.colors.onSurface }]}>
                  {row.table}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.copyBtn, pressed && styles.pressed]}
                  onPress={() => {
                    void onCopy(row.payload);
                  }}
                >
                  <Text style={styles.copyBtnText}>{STRINGS.COMMON.COPY_JSON}</Text>
                </Pressable>
              </View>
              <ScrollView horizontal style={styles.codeWrap} contentContainerStyle={styles.codeInner}>
                <Text style={styles.code}>{pretty}</Text>
              </ScrollView>
            </View>
          );
        })
      )}

      {!loading && !refreshing && rows.length === 0 ? (
        <Text style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>
          {STRINGS.COMMON.EMPTY_DB}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  btn: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnNeutral: { backgroundColor: '#334155' },
  btnDanger: { backgroundColor: '#b91c1c' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  pressed: { opacity: 0.84 },
  meta: { fontSize: 12, marginBottom: 10 },
  loader: { paddingVertical: 18, alignItems: 'center' },
  item: {
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    overflow: 'hidden',
  },
  itemHeader: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#e5e7eb',
  },
  tableTag: { fontWeight: '700', fontSize: 12, textTransform: 'uppercase' },
  copyBtn: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  copyBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  codeWrap: { maxHeight: 240 },
  codeInner: { padding: 10, minWidth: '100%' },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    color: '#111827',
  },
  empty: { fontSize: 13, paddingTop: 4 },
});
