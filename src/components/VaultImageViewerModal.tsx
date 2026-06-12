import React from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { IconButton, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

type Props = {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
};

/** Visionneuse plein écran pour une image du TalknDone-Vault. */
export function VaultImageViewerModal({ visible, imageUri, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (!imageUri) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.92)' }]}>
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
          <IconButton
            icon="close"
            iconColor={theme.colors.onSurface}
            containerColor="rgba(255,255,255,0.12)"
            onPress={onClose}
            accessibilityLabel={t('common.close', { defaultValue: 'Fermer' })}
          />
        </View>
        <Pressable style={styles.imageWrap} onPress={onClose} accessibilityRole="imagebutton">
          <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  header: {
    alignItems: 'flex-end',
    paddingHorizontal: 8,
  },
  imageWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
