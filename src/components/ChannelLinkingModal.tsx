import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Portal, useTheme } from 'react-native-paper';

type Props = {
  visible: boolean;
  channelName: string;
  onDismiss: () => void;
  onContinue: () => void;
};

/**
 * Étapes de liaison avant d’ouvrir l’app messager (Telegram, WhatsApp, etc.).
 */
export function ChannelLinkingModal({
  visible,
  channelName,
  onDismiss,
  onContinue,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={onDismiss}
        style={{ backgroundColor: theme.colors.surface }}
      >
        <Dialog.Title style={{ color: theme.colors.primary }}>
          {t('channels.modal.title', { channelName })}
        </Dialog.Title>
        <Dialog.Content>
          <Text style={[styles.step, { color: theme.colors.onSurface }]}>
            {t('channels.modal.step1')}
          </Text>
          <Text style={[styles.step, { color: theme.colors.onSurface }]}>
            {t('channels.modal.step2')}
          </Text>
          <Text style={[styles.step, { color: theme.colors.onSurface }]}>
            {t('channels.modal.step3')}
          </Text>
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss}>{t('channelSwitch.cancel')}</Button>
          <Button mode="contained" onPress={onContinue}>
            {t('onboarding.firstName.continue')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  step: { lineHeight: 22, marginBottom: 8 },
  actions: { flexWrap: 'wrap', gap: 8 },
});
