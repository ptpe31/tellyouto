import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Portal, useTheme } from 'react-native-paper';

import { NeumorphicCard } from './NeumorphicCard';

type Props = {
  visible: boolean;
  onInstall: () => void;
  onDismiss: () => void;
};

/**
 * Invitation à installer Telegram lorsque le schéma natif n’est pas disponible.
 */
export function TelegramMissingDialog({
  visible,
  onInstall,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!visible) return null;

  return (
    <Portal>
      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <NeumorphicCard
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
        >
          <Text style={[styles.title, { color: theme.colors.primary }]}>
            {t('linking.telegramMissingTitle')}
          </Text>
          <Text style={[styles.body, { color: theme.colors.onSurface }]}>
            {t('linking.telegramMissingBody')}
          </Text>
          <View style={styles.actions}>
            <Button mode="text" onPress={onDismiss}>
              {t('linking.telegramMissingLater')}
            </Button>
            <Button mode="contained" onPress={onInstall}>
              {t('linking.telegramMissingInstall')}
            </Button>
          </View>
        </NeumorphicCard>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 100,
  },
  card: {
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
});
