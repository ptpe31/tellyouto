import * as WebBrowser from 'expo-web-browser';
import { useNavigation } from '@react-navigation/native';
import * as Google from 'expo-auth-session/providers/google';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NeumorphicCard } from '../components';
import {
  ensureFirebaseAnonymousAuth,
  getFirebaseAuth,
} from '../api/firebase';
import {
  linkAnonymousWithApple,
  linkAnonymousWithGoogleIdToken,
} from '../api/accountLinking';
import { useUserSpectrum } from '../context/UserSpectrumContext';

WebBrowser.maybeCompleteAuthSession();

const GOLD = '#C9A227';
const GOLD_DARK = '#8B6914';

/**
 * Abonnement Pro — liaison Google / Apple requise tant que le compte Firebase est anonyme
 * (entitlements sur `users/{uid}` portables entre appareils).
 */
export function ProSubscriptionScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { setProUser } = useUserSpectrum();
  const [linkBusy, setLinkBusy] = useState(false);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  const runAfterGoogleLink = useCallback(async () => {
    await setProUser(true);
    navigation.goBack();
  }, [navigation, setProUser]);

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params?.id_token;
    if (!idToken || typeof idToken !== 'string') return;
    void (async () => {
      setLinkBusy(true);
      try {
        await ensureFirebaseAnonymousAuth();
        await linkAnonymousWithGoogleIdToken(idToken);
        await runAfterGoogleLink();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(t('pro.linkErrorTitle'), msg);
      } finally {
        setLinkBusy(false);
      }
    })();
  }, [response, runAfterGoogleLink, t]);

  const onAppleLink = async () => {
    setLinkBusy(true);
    try {
      await ensureFirebaseAnonymousAuth();
      await linkAnonymousWithApple();
      await runAfterGoogleLink();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t('pro.linkErrorTitle'), msg);
    } finally {
      setLinkBusy(false);
    }
  };

  const onSubscribe = async () => {
    const anon = getFirebaseAuth()?.currentUser?.isAnonymous === true;
    if (anon) {
      Alert.alert(t('pro.linkRequiredTitle'), t('pro.linkRequiredBody'), [
        {
          text: t('pro.linkGoogle'),
          onPress: () => {
            if (!webClientId || !request) {
              Alert.alert(
                t('pro.configureGoogleTitle'),
                t('pro.configureGoogleBody'),
              );
              return;
            }
            void promptAsync();
          },
        },
        ...(Platform.OS === 'ios'
          ? [
              {
                text: t('pro.linkApple'),
                onPress: () => void onAppleLink(),
              },
            ]
          : []),
        { text: t('pro.linkLater'), style: 'cancel' },
      ]);
      return;
    }
    await setProUser(true);
    navigation.goBack();
  };

  const googleConfigured = Boolean(webClientId && request);

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

      {!googleConfigured ? (
        <Text style={[styles.warn, { color: theme.colors.error }]}>
          {t('pro.googleMissingEnv')}
        </Text>
      ) : null}

      {linkBusy ? (
        <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
      ) : null}

      <Button
        mode="contained"
        style={styles.goldBtn}
        buttonColor={GOLD}
        textColor="#1a1a1a"
        labelStyle={styles.goldLabel}
        disabled={linkBusy}
        onPress={() => void onSubscribe()}
      >
        {t('pro.subscribeGold')}
      </Button>

      {googleConfigured ? (
        <Button
          mode="outlined"
          style={styles.secondary}
          disabled={linkBusy}
          onPress={() => void promptAsync()}
        >
          {t('pro.linkGoogleOnly')}
        </Button>
      ) : null}

      {Platform.OS === 'ios' ? (
        <Button
          mode="outlined"
          style={styles.secondary}
          disabled={linkBusy}
          onPress={() => void onAppleLink()}
        >
          {t('pro.linkAppleOnly')}
        </Button>
      ) : null}

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
  warn: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  spinner: { marginVertical: 12 },
  goldBtn: { marginBottom: 8, borderRadius: 12 },
  goldLabel: { fontWeight: '700', fontSize: 16 },
  secondary: { marginBottom: 6 },
});
