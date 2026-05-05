import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ClipboardList, X } from 'lucide-react-native';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  DeviceEventEmitter,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, IconButton, Switch, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import {
  getProjectsAndLists,
  updateTrankilV2IntentionArchiveState,
  patchMetadata,
  updateTrankilV2IntentionTitle,
  type TrankilV2IntentionRow,
} from '../api';
import {
  buildListMetadataPatch,
  parseListScalablePayloadFromMetadataJson,
  type ListScalablePayload,
} from '../services/listIntentionModel';
import type { RootStackParamList } from '../navigation/types';

type ItemDraft = {
  uid: string;
  name: string;
  note: string;
  due_date: string;
};

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function calcProgress(payload: ListScalablePayload | null): { done: number; total: number } {
  if (!payload) return { done: 0, total: 0 };
  let total = 0;
  let done = 0;
  for (const cat of payload.categories) {
    for (const it of cat.items) {
      const name = String(it.name ?? '').trim();
      if (!name) continue;
      total += 1;
      if (it.checked) done += 1;
    }
  }
  return { done, total };
}

function readItemDraft(payload: ListScalablePayload | null, uid: string | null): ItemDraft | null {
  if (!payload || !uid) return null;
  for (const cat of payload.categories) {
    for (const it of cat.items) {
      if (it.uid !== uid) continue;
      return {
        uid,
        name: String(it.name ?? ''),
        note: String((it as unknown as Record<string, unknown>).note ?? ''),
        due_date: String((it as unknown as Record<string, unknown>).due_date ?? ''),
      };
    }
  }
  return null;
}

function upsertItemIntoPayload(payload: ListScalablePayload, next: ItemDraft): ListScalablePayload {
  return {
    ...payload,
    categories: payload.categories.map((cat) => ({
      ...cat,
      items: cat.items.map((it) =>
        it.uid === next.uid
          ? ({
              ...it,
              name: next.name,
              note: next.note,
              due_date: next.due_date || null,
            } as any)
          : it,
      ),
    })),
  };
}

function toggleChecked(payload: ListScalablePayload, uid: string): ListScalablePayload {
  return {
    ...payload,
    categories: payload.categories.map((cat) => ({
      ...cat,
      items: cat.items.map((it) => (it.uid === uid ? ({ ...it, checked: !it.checked } as any) : it)),
    })),
  };
}

export function ProjectListScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ProjectList'>>();
  const screenHeight = useMemo(() => Math.max(1, Dimensions.get('window').height), []);

  const [rows, setRows] = useState<TrankilV2IntentionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(screenHeight)).current;

  const [selected, setSelected] = useState<TrankilV2IntentionRow | null>(null);
  const [payload, setPayload] = useState<ListScalablePayload | null>(null);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [noteHeights, setNoteHeights] = useState<Record<string, number>>({});

  const savedOpacity = useRef(new Animated.Value(0)).current;
  const showSaved = useCallback(() => {
    savedOpacity.stopAnimation();
    savedOpacity.setValue(1);
    Animated.timing(savedOpacity, { toValue: 0, duration: 720, useNativeDriver: true }).start();
  }, [savedOpacity]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getProjectsAndLists();
      setRows(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => {
      void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const onHide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const openSheet = useCallback(
    (row: TrankilV2IntentionRow) => {
      setSelected(row);
      setTitleDraft(row.title);
      setTitleEditing(false);
      const p = parseListScalablePayloadFromMetadataJson(row.metadata_json);
      setPayload(p);
      setExpandedUid(null);
      setItemDraft(null);
      setSheetOpen(true);
      sheetOpacity.setValue(0);
      translateY.setValue(screenHeight);
      Animated.parallel([
        Animated.timing(sheetOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: Math.round(screenHeight * 0.05), duration: 220, useNativeDriver: true }),
      ]).start();
    },
    [screenHeight, sheetOpacity, translateY],
  );

  const closeSheet = useCallback(() => {
    if (!sheetOpen) return;
    setTitleEditing(false);
    setExpandedUid(null);
    setItemDraft(null);
    Animated.parallel([
      Animated.timing(sheetOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: screenHeight, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setSheetOpen(false);
      setSelected(null);
      setPayload(null);
    });
  }, [screenHeight, sheetOpen, sheetOpacity, translateY]);

  useEffect(() => {
    if (!sheetOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [closeSheet, sheetOpen]);

  useEffect(() => {
    const id = String(route.params?.id ?? '').trim();
    if (!id || rows.length === 0) return;
    const hit = rows.find((r) => r.id === id);
    if (hit) openSheet(hit);
  }, [openSheet, route.params?.id, rows]);

  const generating = useMemo(() => {
    if (!selected) return false;
    const root = safeParseJsonObject(selected.metadata_json);
    if (!root) return false;
    if (root.is_generating === true) return true;
    return String(root.list_enrich_status ?? '').trim() === 'pending';
  }, [selected]);

  const onArchive = useCallback(async () => {
    if (!selected) return;
    await updateTrankilV2IntentionArchiveState(selected.id, true);
    closeSheet();
  }, [closeSheet, selected]);

  const persistPayload = useCallback(
    async (next: ListScalablePayload) => {
      if (!selected) return;
      await patchMetadata(selected.id, buildListMetadataPatch(next));
      showSaved();
    },
    [selected, showSaved],
  );

  const onToggleItem = useCallback(
    async (uid: string) => {
      if (!payload) return;
      const next = toggleChecked(payload, uid);
      setPayload(next);
      await persistPayload(next);
    },
    [payload, persistPayload],
  );

  const openItem = useCallback(
    (uid: string) => {
      if (generating) return;
      setExpandedUid((prev) => (prev === uid ? null : uid));
      const next = readItemDraft(payload, uid);
      setItemDraft(next);
    },
    [generating, payload],
  );

  const commitItemDraft = useCallback(async () => {
    if (!payload || !itemDraft) return;
    const next = upsertItemIntoPayload(payload, itemDraft);
    setPayload(next);
    await persistPayload(next);
  }, [itemDraft, payload, persistPayload]);

  const commitTitle = useCallback(async () => {
    if (!selected) return;
    const nextTitle = titleDraft.trim() || selected.title;
    setTitleDraft(nextTitle);
    setTitleEditing(false);
    await updateTrankilV2IntentionTitle(selected.id, nextTitle);
    setSelected((prev) => (prev ? { ...prev, title: nextTitle } : prev));
    showSaved();
  }, [selected, showSaved, titleDraft]);

  const cardBorder = theme.colors.outlineVariant;

  const renderRow = useCallback(
    ({ item }: { item: TrankilV2IntentionRow }) => {
      const p = parseListScalablePayloadFromMetadataJson(item.metadata_json);
      const prog = calcProgress(p);
      return (
        <Pressable
          onPress={() => openSheet(item)}
          style={({ pressed }) => [
            styles.card,
            {
              borderColor: cardBorder,
              backgroundColor: theme.colors.surface,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.cardProgress, { color: theme.colors.onSurfaceVariant }]}>
            {prog.done}/{prog.total}
          </Text>
        </Pressable>
      );
    },
    [cardBorder, openSheet, theme.colors.onSurface, theme.colors.onSurfaceVariant, theme.colors.surface],
  );

  const sheetPayload = payload;
  const progress = useMemo(() => calcProgress(sheetPayload), [sheetPayload]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <IconButton icon="arrow-left" size={20} onPress={() => (navigation as any).goBack()} />
          <ClipboardList size={18} color={theme.colors.onSurface} />
          <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>Projets & Listes</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) => it.id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}

      <Modal visible={sheetOpen} transparent animationType="none" onRequestClose={closeSheet}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeSheet} />
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.outlineVariant,
                paddingBottom: Math.max(insets.bottom, 12),
                transform: [{ translateY }],
                opacity: sheetOpacity,
              },
            ]}
          >
            <KeyboardAvoidingView
              enabled={Platform.OS === 'ios'}
              behavior="padding"
              keyboardVerticalOffset={Math.max(16, insets.top)}
              style={styles.sheetInner}
            >
              <View style={styles.sheetHeader}>
                <View style={styles.sheetTitleRow}>
                  {titleEditing ? (
                    <View style={styles.inlineEditRow}>
                      <TextInput
                        value={titleDraft}
                        onChangeText={setTitleDraft}
                        onBlur={() => void commitTitle()}
                        autoFocus
                        style={[styles.titleInput, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant }]}
                      />
                      <Pressable
                        onPress={() => setTitleDraft('')}
                        style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1, padding: 6 }]}
                        accessibilityRole="button"
                        accessibilityLabel="Clear"
                      >
                        <X size={18} color={theme.colors.onSurfaceVariant} />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => !generating && setTitleEditing(true)}
                      style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
                    >
                      <Text style={[styles.sheetTitle, { color: theme.colors.onSurface }]} numberOfLines={1}>
                        {selected?.title ?? ''}
                      </Text>
                    </Pressable>
                  )}
                  <Button mode="text" onPress={() => void onArchive()} disabled={generating}>
                    Archiver
                  </Button>
                </View>

                <Animated.View style={[styles.savedPill, { opacity: savedOpacity }]}>
                  <Text style={[styles.savedText, { color: theme.colors.onSurfaceVariant }]}>Saved</Text>
                </Animated.View>

                <Text style={[styles.progressLine, { color: theme.colors.onSurfaceVariant }]}>
                  {progress.done}/{progress.total}
                </Text>
              </View>

              {generating ? (
                <View style={styles.generatingBlock}>
                  <ActivityIndicator color={theme.colors.primary} />
                  <Text style={[styles.generatingText, { color: theme.colors.onSurfaceVariant }]}>
                    L'IA prépare votre projet...
                  </Text>
                </View>
              ) : !sheetPayload ? (
                <View style={styles.generatingBlock}>
                  <Text style={[styles.generatingText, { color: theme.colors.onSurfaceVariant }]}>
                    Contenu illisible
                  </Text>
                </View>
              ) : (
                <View style={styles.listWrap}>
                  <View style={styles.multiplierRow}>
                    {sheetPayload.categories.some((c) => c.items.some((it) => Boolean(it.scalable))) ? (
                      <Button
                        mode="outlined"
                        disabled={keyboardOpen}
                        onPress={() => {
                          const next = { ...sheetPayload, multiplier: Math.max(1, sheetPayload.multiplier - 1) };
                          setPayload(next);
                          void persistPayload(next);
                        }}
                        style={styles.stepBtn}
                      >
                        -
                      </Button>
                    ) : null}
                    <Text style={[styles.multiplierText, { color: theme.colors.onSurface }]}>
                      {sheetPayload.multiplier} {sheetPayload.unitLabel}
                    </Text>
                    {sheetPayload.categories.some((c) => c.items.some((it) => Boolean(it.scalable))) ? (
                      <Button
                        mode="outlined"
                        disabled={keyboardOpen}
                        onPress={() => {
                          const next = { ...sheetPayload, multiplier: sheetPayload.multiplier + 1 };
                          setPayload(next);
                          void persistPayload(next);
                        }}
                        style={styles.stepBtn}
                      >
                        +
                      </Button>
                    ) : null}
                  </View>

                  <View style={styles.itemsScroll}>
                    <FlatList
                      data={sheetPayload.categories.flatMap((c) => c.items.map((it) => ({ cat: c.name, it })))}
                      keyExtractor={(x) => `${x.cat}:${x.it.uid}`}
                      scrollEnabled={!keyboardOpen}
                      contentContainerStyle={{ paddingBottom: 24 }}
                      renderItem={({ item }) => {
                        const it = item.it as any;
                        const isOpen = expandedUid === it.uid;
                        const name = String(it.name ?? '').trim() || '—';
                        const localDraft = isOpen && itemDraft?.uid === it.uid ? itemDraft : null;
                        return (
                          <View style={styles.itemBlock}>
                            <Pressable
                              onPress={() => openItem(it.uid)}
                              style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
                            >
                              <View style={styles.itemRow}>
                                <Switch value={Boolean(it.checked)} onValueChange={() => void onToggleItem(it.uid)} />
                                <Text style={[styles.itemTitle, { color: theme.colors.onSurface }]} numberOfLines={1}>
                                  {name}
                                </Text>
                              </View>
                            </Pressable>

                            {isOpen && itemDraft?.uid === it.uid ? (
                              <View style={styles.itemDetails}>
                                <TextInput
                                  value={localDraft?.name ?? ''}
                                  onChangeText={(v) => setItemDraft((prev) => (prev ? { ...prev, name: v } : prev))}
                                  onBlur={() => void commitItemDraft()}
                                  style={[
                                    styles.itemInput,
                                    { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant },
                                  ]}
                                />
                                <TextInput
                                  value={localDraft?.note ?? ''}
                                  onChangeText={(v) => setItemDraft((prev) => (prev ? { ...prev, note: v } : prev))}
                                  multiline
                                  onContentSizeChange={(e) => {
                                    const h = Math.max(64, Math.min(220, e.nativeEvent.contentSize.height));
                                    setNoteHeights((prev) => ({ ...prev, [it.uid]: h }));
                                  }}
                                  onBlur={() => void commitItemDraft()}
                                  style={[
                                    styles.noteInput,
                                    { color: theme.colors.onSurfaceVariant, borderColor: theme.colors.outlineVariant },
                                    noteHeights[it.uid] ? { height: noteHeights[it.uid] } : null,
                                  ]}
                                  placeholder="Note…"
                                  placeholderTextColor="rgba(100,116,139,0.72)"
                                />
                                <TextInput
                                  value={localDraft?.due_date ?? ''}
                                  onChangeText={(v) => setItemDraft((prev) => (prev ? { ...prev, due_date: v } : prev))}
                                  onBlur={() => void commitItemDraft()}
                                  style={[
                                    styles.itemInput,
                                    { color: theme.colors.onSurfaceVariant, borderColor: theme.colors.outlineVariant },
                                  ]}
                                  placeholder="Échéance (YYYY-MM-DD)…"
                                  placeholderTextColor="rgba(100,116,139,0.72)"
                                />
                              </View>
                            ) : null}
                          </View>
                        );
                      }}
                      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                    />
                  </View>
                </View>
              )}

              <View style={styles.footer}>
                <Button mode="outlined" onPress={closeSheet} style={styles.footerBtn}>
                  Fermer
                </Button>
              </View>
            </KeyboardAvoidingView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12 },
  cardTitle: { fontSize: 14, fontWeight: '900', flex: 1, minWidth: 0 },
  cardProgress: { fontSize: 12, fontWeight: '800', marginLeft: 12 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, height: '95%', overflow: 'hidden' },
  sheetInner: { flex: 1 },
  sheetHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 8 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sheetTitle: { fontSize: 18, fontWeight: '900', flex: 1, minWidth: 0 },
  inlineEditRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleInput: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, fontWeight: '800' },
  savedPill: { alignSelf: 'flex-start' },
  savedText: { fontSize: 12, fontWeight: '800' },
  progressLine: { fontSize: 12, fontWeight: '800' },
  generatingBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  generatingText: { fontSize: 13, fontWeight: '800', textAlign: 'center', paddingHorizontal: 22 },
  listWrap: { flex: 1, paddingHorizontal: 16 },
  multiplierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 12 },
  stepBtn: { borderRadius: 14 },
  multiplierText: { fontSize: 13, fontWeight: '900' },
  itemsScroll: { flex: 1 },
  itemBlock: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.08)', borderRadius: 14, padding: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemTitle: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '900' },
  itemDetails: { marginTop: 10, gap: 10 },
  itemInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontWeight: '800' },
  noteInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, fontSize: 13, fontWeight: '700', minHeight: 64 },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  footerBtn: { borderRadius: 16 },
});
