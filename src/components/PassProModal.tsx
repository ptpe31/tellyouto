import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Portal, useTheme } from 'react-native-paper';
import { useUserSpectrum } from '../context/UserSpectrumContext';

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

/**
 * Invitation à passer Pro lorsqu’un canal premium est sélectionné sans abonnement.
 */
export function PassProModal({ visible, onDismiss }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { setProUser } = useUserSpectrum();

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={onDismiss}
        style={{ backgroundColor: theme.colors.surface, maxHeight: '88%' }}
      >
        <Dialog.Title style={{ color: theme.colors.primary }}>
          {t('pro.modalTitle')}
        </Dialog.Title>
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView>
            <Text style={[styles.price, { color: theme.colors.secondary }]}>
              {t('pro.modalPrice')}
            </Text>
            <Text style={[styles.lead, { color: theme.colors.onSurfaceVariant }]}>
              {t('pro.modalLead')}
            </Text>
            <View style={styles.bullets}>
              <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
                {t('pro.benefit1')}
              </Text>
              <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
                {t('pro.benefit2')}
              </Text>
              <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
                {t('pro.benefit3')}
              </Text>
              <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
                {t('pro.benefit4')}
              </Text>
            </View>
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss}>{t('pro.modalLater')}</Button>
          <Button
            mode="contained"
            onPress={() => {
              void (async () => {
                await setProUser(true);
                onDismiss();
              })();
            }}
          >
            {t('pro.modalCta')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  scrollArea: { paddingHorizontal: 0 },
  price: { fontSize: 22, fontWeight: '800', marginBottom: 10 },
  lead: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  bullets: { gap: 8 },
  bullet: { fontSize: 14, lineHeight: 20, paddingLeft: 4 },
  actions: { flexWrap: 'wrap', gap: 8 },
});
