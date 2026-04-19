import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Menu, Button as PaperButton } from 'react-native-paper';

import type { OneTapPredictedType, OneTapUniversalResult } from '../services/oneTapUniversalCapture';
import { ONE_TAP_PREDICTED_TYPES, mergeOneTapDataOnTypeChange } from '../services/oneTapUniversalCapture';

export type OneTapConfirmModalProps = {
  visible: boolean;
  draft: OneTapUniversalResult | null;
  transcript: string;
  busy: boolean;
  onChangeDraft: (next: OneTapUniversalResult) => void;
  onChangeTranscript: (text: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

export function OneTapConfirmModal({
  visible,
  draft,
  transcript,
  busy,
  onChangeDraft,
  onChangeTranscript,
  onConfirm,
  onDismiss,
}: OneTapConfirmModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  const typeLabels = useMemo(
    () =>
      ONE_TAP_PREDICTED_TYPES.reduce(
        (acc, k) => {
          acc[k] = t(`talkDebug.oneTapType.${k}`);
          return acc;
        },
        {} as Record<OneTapPredictedType, string>,
      ),
    [t],
  );

  if (!draft) return null;

  const applyType = (next: OneTapPredictedType) => {
    if (next === draft.predictedType) {
      setMenuOpen(false);
      return;
    }
    const nextData = mergeOneTapDataOnTypeChange(draft.predictedType, next, draft.data, draft.title);
    onChangeDraft({
      ...draft,
      predictedType: next,
      data: nextData,
    });
    setMenuOpen(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('talkDebug.oneTapModalTitle')}</Text>

          <Menu
            visible={menuOpen}
            onDismiss={() => setMenuOpen(false)}
            anchor={
              <PaperButton mode="outlined" onPress={() => setMenuOpen(true)} disabled={busy}>
                {typeLabels[draft.predictedType]}
              </PaperButton>
            }
          >
            {ONE_TAP_PREDICTED_TYPES.map((opt) => (
              <Menu.Item key={opt} onPress={() => applyType(opt)} title={typeLabels[opt]} />
            ))}
          </Menu>

          <Text style={styles.label}>{t('talkDebug.crystallizedTitleEditable')}</Text>
          <TextInput
            value={draft.title}
            onChangeText={(title) => onChangeDraft({ ...draft, title })}
            style={styles.input}
            editable={!busy}
          />

          <Text style={styles.label}>{t('talkDebug.oneTapCategoryTag')}</Text>
          <TextInput
            value={draft.categoryTag}
            onChangeText={(categoryTag) => onChangeDraft({ ...draft, categoryTag })}
            style={styles.input}
            editable={!busy}
          />

          <Text style={styles.label}>{t('talkDebug.oneTapTranscriptLabel')}</Text>
          <TextInput
            value={transcript}
            onChangeText={onChangeTranscript}
            style={[styles.input, styles.multiline]}
            multiline
            editable={!busy}
          />

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onDismiss} disabled={busy}>
              <Text style={styles.btnGhostText}>{t('common.later')}</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onConfirm} disabled={busy}>
              <Text style={styles.btnPrimaryText}>{t('talkDebug.oneTapConfirm')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    maxHeight: '92%',
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  btnGhost: { backgroundColor: '#e2e8f0' },
  btnGhostText: { fontWeight: '700', color: '#0f172a' },
  btnPrimary: { backgroundColor: '#008080' },
  btnPrimaryText: { fontWeight: '800', color: '#fff' },
});
