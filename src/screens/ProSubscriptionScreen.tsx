import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NeumorphicCard } from '../components';
import { useUserSpectrum } from '../context/UserSpectrumContext';

const GOLD = '#C9A227';
const GOLD_DARK = '#8B6914';

/**
 * Écran d’abonnement Pro — le paiement réel sera branché (Store / Stripe).
 */
export function ProSubscriptionScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { setProUser } = useUserSpectrum();

  const onSubscribe = async () => {
    await setProUser(true);
    navigation.goBack();
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={[
        styles.pad,
        { paddingBottom: 32 + insets.bottom, paddingTop: 12 + insets.top },
      ]}
    >
      <Text style={[styles.kicker, { color: theme.colors.primary }]}>
        {t('pro.screenKicker')}
      </Text>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        {t('pro.screenTitle')}
      </Text>
      <Text style={[styles.sub, { color: theme.colors.onSurfaceVariant }]}>
        {t('pro.screenSubtitle')}
      </Text>

      <NeumorphicCard style={styles.card}>
        <Text style={[styles.price, { color: GOLD_DARK }]}>{t('pro.modalPrice')}</Text>
        <View style={styles.bullets}>
          <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
            ✓ {t('pro.benefit1')}
          </Text>
          <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
            ✓ {t('pro.benefit2')}
          </Text>
          <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
            ✓ {t('pro.benefit3')}
          </Text>
          <Text style={[styles.bullet, { color: theme.colors.onSurface }]}>
            ✓ {t('pro.benefit4')}
          </Text>
        </View>
      </NeumorphicCard>

      <Text style={[styles.note, { color: theme.colors.outline }]}>
        {t('pro.devNote')}
      </Text>

      <Button
        mode="contained"
        style={styles.goldBtn}
        buttonColor={GOLD}
        textColor="#1a1a1a"
        labelStyle={styles.goldLabel}
        onPress={() => void onSubscribe()}
      >
        {t('pro.subscribeGold')}
      </Button>

      <Button mode="text" onPress={() => navigation.goBack()}>
        {t('pro.back')}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 20 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 8 },
  sub: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  card: { padding: 18, marginBottom: 16 },
  price: { fontSize: 24, fontWeight: '800', marginBottom: 16 },
  bullets: { gap: 10 },
  bullet: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 12, lineHeight: 17, marginBottom: 16, fontStyle: 'italic' },
  goldBtn: { marginBottom: 8, borderRadius: 12 },
  goldLabel: { fontWeight: '700', fontSize: 16 },
});
