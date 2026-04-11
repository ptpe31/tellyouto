import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from 'react-native-paper';

import { TelegramLogoMark } from './TelegramLogoMark';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** Si true, affiche la pastille Telegram (canal Telegram). */
  showTelegramMark?: boolean;
};

/**
 * Confirmation immédiate après lancement de la liaison (avant retour webhook).
 */
export function LinkLaunchedModal({
  visible,
  onDismiss,
  showTelegramMark = true,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.colors.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          {showTelegramMark ? (
            <View style={styles.iconRow}>
              <TelegramLogoMark size={64} />
            </View>
          ) : null}
          <Text style={[styles.body, { color: theme.colors.onSurface }]}>
            {t('channels.linkLaunched.message')}
          </Text>
          <Button mode="contained" style={styles.btn} onPress={onDismiss}>
            {t('channels.linkLaunched.button')}
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    borderRadius: 20,
    padding: 24,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  iconRow: { alignItems: 'center', marginBottom: 16 },
  body: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 20,
  },
  btn: { marginTop: 4 },
});
