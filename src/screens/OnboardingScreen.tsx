import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import { type AppLanguage, useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { resolveSpeechLangForSession } from '../utils/speechLocale';

const LANGS: AppLanguage[] = ['fr', 'en', 'es', 'de', 'it', 'ja', 'zh'];

type OnboardingScreenProps = {
  onComplete: () => Promise<void>;
};

function normalizeSystemToAppLanguage(tag: string | null): AppLanguage {
  const base = String(tag || 'en')
    .split(/[-_]/)[0]
    ?.toLowerCase();
  if (base === 'fr' || base === 'en' || base === 'es' || base === 'de' || base === 'it' || base === 'ja' || base === 'zh') {
    return base;
  }
  return 'en';
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { language, setLanguage, interactionLanguage, setInteractionLanguage, systemLanguageTag } =
    useLanguage();
  const { setLocale, persist } = useUserSpectrum();
  const [saving, setSaving] = useState(false);

  const defaultLang = useMemo(
    () => normalizeSystemToAppLanguage(systemLanguageTag),
    [systemLanguageTag],
  );
  const selectedLanguage = interactionLanguage || defaultLang;

  const onSelectAudioLanguage = (next: AppLanguage) => {
    void (async () => {
      await setInteractionLanguage(next);
      setLocale(resolveSpeechLangForSession(next));
      if (next !== language) {
        Alert.alert(
          t('onboarding.language.syncTitle'),
          t('onboarding.language.syncBody', { lang: t(`ally.lang.${next}`) }),
          [
            { text: t('onboarding.language.syncNo'), style: 'cancel' },
            {
              text: t('onboarding.language.syncYes'),
              onPress: () => {
                void setLanguage(next);
              },
            },
          ],
        );
      }
    })();
  };

  const onContinue = () => {
    if (saving) return;
    setSaving(true);
    void (async () => {
      try {
        await setInteractionLanguage(selectedLanguage);
        setLocale(resolveSpeechLangForSession(selectedLanguage));
        await persist();
        await AsyncStorage.setItem('@tellyouto/onboarding_audio_language', selectedLanguage);
        await onComplete();
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        {t('onboarding.language.question')}
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
        {t('onboarding.language.systemDetected', { lang: t(`ally.lang.${defaultLang}`) })}
      </Text>
      <View style={styles.grid}>
        {LANGS.map((lng) => {
          const selected = lng === selectedLanguage;
          return (
            <Pressable
              key={lng}
              style={[
                styles.langBtn,
                {
                  borderColor: selected ? theme.colors.primary : theme.colors.outlineVariant,
                  backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surface,
                },
              ]}
              onPress={() => onSelectAudioLanguage(lng)}
            >
              <Text
                style={[
                  styles.langText,
                  { color: selected ? theme.colors.onPrimaryContainer : theme.colors.onSurface },
                ]}
              >
                {t(`ally.lang.${lng}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        style={[
          styles.continueBtn,
          { backgroundColor: saving ? theme.colors.surfaceDisabled : theme.colors.primary },
        ]}
        onPress={onContinue}
        disabled={saving}
      >
        <Text style={[styles.continueText, { color: theme.colors.onPrimary }]}>
          {t('onboarding.firstName.continue')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 72,
    paddingBottom: 32,
  },
  title: {
    fontSize: 27,
    fontWeight: '800',
    lineHeight: 35,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  grid: {
    marginTop: 28,
    gap: 10,
  },
  langBtn: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  langText: {
    fontSize: 15,
    fontWeight: '700',
  },
  continueBtn: {
    marginTop: 'auto',
    borderRadius: 14,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    fontSize: 15,
    fontWeight: '800',
  },
});
