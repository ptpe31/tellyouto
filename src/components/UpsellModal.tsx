import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

type UpsellModalProps = {
  visible: boolean;
  price: string;
  busy?: boolean;
  onClose: () => void;
  onWatchVideo: () => void;
  onGoUnlimited: () => void;
};

export function UpsellModal({
  visible,
  price,
  busy = false,
  onClose,
  onWatchVideo,
  onGoUnlimited,
}: UpsellModalProps) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('paywall.noCreditsTitle')}</Text>
          <Text style={styles.body}>{t('paywall.noCreditsBody')}</Text>

          <Pressable style={[styles.btn, styles.btnSecondary, busy ? styles.disabled : null]} onPress={onWatchVideo} disabled={busy}>
            <Text style={styles.btnSecondaryText}>{t('paywall.watchVideoCta')}</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnPrimary, busy ? styles.disabled : null]} onPress={onGoUnlimited} disabled={busy}>
            <Text style={styles.btnPrimaryText}>
              {t('paywall.unlimited_price', { price })}
            </Text>
          </Pressable>

          <Pressable style={styles.closeBtn} onPress={onClose} disabled={busy}>
            <Text style={styles.closeText}>{t('common.later')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    padding: 14,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  body: { fontSize: 14, color: '#334155', lineHeight: 20 },
  btn: {
    minHeight: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  btnSecondary: {
    backgroundColor: '#e2e8f0',
  },
  btnSecondaryText: { color: '#0f172a', fontSize: 14, fontWeight: '700' },
  btnPrimary: {
    backgroundColor: '#0b5b8f',
  },
  btnPrimaryText: { color: '#eff6ff', fontSize: 14, fontWeight: '800' },
  closeBtn: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  closeText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
