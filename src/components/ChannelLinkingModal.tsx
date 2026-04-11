import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Portal, useTheme } from 'react-native-paper';

import { TelegramLogoMark } from './TelegramLogoMark';

export type ChannelLinkingVariant = 'telegram' | 'other';

type Props = {
  visible: boolean;
  variant: ChannelLinkingVariant;
  /** Utilisé uniquement si variant === 'other' */
  channelName: string;
  onDismiss: () => void;
  onContinue: () => void;
};

/**
 * Avant ouverture messager — message rassurant, sans jargon technique.
 */
export function ChannelLinkingModal({
  visible,
  variant,
  channelName,
  onDismiss,
  onContinue,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isTelegram = variant === 'telegram';

  const title = isTelegram
    ? t('channels.modal.title')
    : t('channels.modal.otherTitle', { channelName });
  const body = isTelegram
    ? t('channels.modal.body')
    : t('channels.modal.otherBody', { channelName });

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={onDismiss}
        style={{ backgroundColor: theme.colors.surface, borderRadius: 20 }}
      >
        {isTelegram ? (
          <View style={styles.iconWrap}>
            <TelegramLogoMark size={64} />
          </View>
        ) : null}
        <Dialog.Title
          style={[styles.title, { color: theme.colors.primary }]}
        >
          {title}
        </Dialog.Title>
        <Dialog.Content>
          <Text style={[styles.body, { color: theme.colors.onSurface }]}>
            {body}
          </Text>
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss}>{t('channelSwitch.cancel')}</Button>
          <Button mode="contained" onPress={onContinue}>
            {t('channels.modal.button')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', paddingTop: 8, marginBottom: 4 },
  title: { textAlign: 'center', fontSize: 18 },
  body: { lineHeight: 24, fontSize: 15 },
  actions: { flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 },
});
