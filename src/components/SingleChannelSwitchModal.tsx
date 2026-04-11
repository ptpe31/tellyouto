import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Portal, useTheme } from 'react-native-paper';

type Props = {
  visible: boolean;
  targetChannelName: string;
  onDismiss: () => void;
  onConfirm: () => void;
};

/**
 * Confirmation avant de remplacer le canal privé actif par un autre.
 */
export function SingleChannelSwitchModal({
  visible,
  targetChannelName,
  onDismiss,
  onConfirm,
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
          {t('channelSwitch.title')}
        </Dialog.Title>
        <Dialog.Content>
          <Text style={{ color: theme.colors.onSurface, lineHeight: 22 }}>
            {t('channelSwitch.message', { channelName: targetChannelName })}
          </Text>
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss}>{t('channelSwitch.cancel')}</Button>
          <Button mode="contained" onPress={onConfirm}>
            {t('channelSwitch.confirm')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  actions: { flexWrap: 'wrap', gap: 8 },
});
