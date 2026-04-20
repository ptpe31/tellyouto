import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import {
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type AppLanguage, useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import type { AppTabParamList } from '../navigation/types';
import { resolveSpeechLangForSession } from '../utils/speechLocale';

const LANGS: AppLanguage[] = [
  'fr',
  'en',
  'es',
  'de',
  'it',
  'ja',
  'zh',
  'ar',
  'ko',
  'nl',
  'sv',
];

export type LanguageSelectionScreenProps = {
  onComplete: () => Promise<void>;
};

function normalizeSystemToAppLanguage(tag: string | null): AppLanguage {
  const base = String(tag || 'en')
    .split(/[-_]/)[0]
    ?.toLowerCase();
  if (
    base === 'fr' ||
    base === 'en' ||
    base === 'es' ||
    base === 'de' ||
    base === 'it' ||
    base === 'ja' ||
    base === 'zh' ||
    base === 'ar' ||
    base === 'ko' ||
    base === 'nl' ||
    base === 'sv'
  ) {
    return base;
  }
  return 'en';
}

function flagForLanguage(lang: AppLanguage): string {
  if (lang === 'fr') return '🇫🇷';
  if (lang === 'en') return '🇬🇧';
  if (lang === 'es') return '🇪🇸';
  if (lang === 'de') return '🇩🇪';
  if (lang === 'it') return '🇮🇹';
  if (lang === 'ja') return '🇯🇵';
  if (lang === 'zh') return '🇨🇳';
  if (lang === 'ar') return '🇸🇦';
  if (lang === 'ko') return '🇰🇷';
  if (lang === 'nl') return '🇳🇱';
  return '🇸🇪';
}

function resolvePostOnboardingTab(): keyof AppTabParamList {
  return 'TalkHome';
}

export function LanguageSelectionScreen({ onComplete }: LanguageSelectionScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { language, setLanguage, interactionLanguage, setInteractionLanguage, systemLanguageTag } =
    useLanguage();
  const { setLocale, persist } = useUserSpectrum();
  const [saving, setSaving] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

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
        await setLanguage(next);
      }
      setPickerVisible(false);
    })();
  };

  const navigateToTalkExperience = useCallback(() => {
    const tab = resolvePostOnboardingTab();
    const run = () => {
      if (!rootNavigationRef.isReady()) return;
      rootNavigationRef.dispatch(
        CommonActions.navigate({
          name: 'App',
          params: {
            screen: 'Tabs',
            params: { screen: tab },
          },
        } as never),
      );
    };
    InteractionManager.runAfterInteractions(() => {
      setTimeout(run, 150);
    });
  }, []);

  const handleContinue = useCallback(() => {
    if (saving) return;
    setSaving(true);
    void (async () => {
      try {
        const langToUse = interactionLanguage ?? defaultLang;
        await setInteractionLanguage(langToUse);
        setLocale(resolveSpeechLangForSession(langToUse));
        if (langToUse !== language) {
          await setLanguage(langToUse);
        }
        await persist();
        await AsyncStorage.setItem('@tellyouto/onboarding_audio_language', langToUse);
        await onComplete();
        navigateToTalkExperience();
      } finally {
        setSaving(false);
      }
    })();
  }, [
    defaultLang,
    interactionLanguage,
    language,
    navigateToTalkExperience,
    onComplete,
    persist,
    setInteractionLanguage,
    setLanguage,
    setLocale,
  ]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom + 120, 140) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>
          {t('languageSelection.title', { defaultValue: t('onboarding.language.question') })}
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          {t('languageSelection.subtitle', {
            defaultValue: t('onboarding.language.systemDetected', {
              lang: t(`ally.lang.${defaultLang}`),
            }),
            lang: t(`ally.lang.${defaultLang}`),
          })}
        </Text>

        <Pressable
          style={[
            styles.dropdownTrigger,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.outlineVariant,
              shadowColor: '#000',
            },
          ]}
          onPress={() => setPickerVisible(true)}
        >
          <View style={styles.dropdownLeft}>
            <Text style={styles.flagText}>{flagForLanguage(selectedLanguage)}</Text>
            <Text style={[styles.dropdownValue, { color: theme.colors.onSurface }]}>
              {t(`ally.lang.${selectedLanguage}`)}
            </Text>
          </View>
          <Text style={[styles.dropdownChevron, { color: theme.colors.onSurfaceVariant }]}>▾</Text>
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.bottomActionWrap,
          {
            paddingBottom: Math.max(insets.bottom, 12),
            backgroundColor: theme.colors.background,
            borderTopColor: theme.colors.outlineVariant,
          },
        ]}
      >
        <Pressable
          style={[
            styles.continueBtn,
            {
              backgroundColor: saving ? theme.colors.surfaceDisabled : theme.colors.primary,
              shadowColor: '#000',
            },
          ]}
          onPress={handleContinue}
          disabled={saving}
        >
          <Text style={[styles.continueText, { color: theme.colors.onPrimary }]}>
            {t('common.continue')}
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>
              {t('languageSelection.pick', { defaultValue: t('onboarding.language.question') })}
            </Text>
            <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent}>
              {LANGS.map((lng) => {
                const selected = lng === selectedLanguage;
                return (
                  <Pressable
                    key={lng}
                    style={[
                      styles.langRow,
                      {
                        backgroundColor: selected
                          ? theme.colors.primaryContainer
                          : theme.colors.surface,
                        borderColor: selected
                          ? theme.colors.primary
                          : theme.colors.outlineVariant,
                      },
                    ]}
                    onPress={() => onSelectAudioLanguage(lng)}
                  >
                    <Text style={styles.flagText}>{flagForLanguage(lng)}</Text>
                    <Text
                      style={[
                        styles.langLabel,
                        {
                          color: selected
                            ? theme.colors.onPrimaryContainer
                            : theme.colors.onSurface,
                        },
                      ]}
                    >
                      {t(`ally.lang.${lng}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={[styles.closeBtn, { borderColor: theme.colors.outlineVariant }]}
              onPress={() => setPickerVisible(false)}
            >
              <Text style={[styles.closeText, { color: theme.colors.onSurfaceVariant }]}>
                {t('common.later')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
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
  dropdownTrigger: {
    marginTop: 26,
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 58,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  dropdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flagText: {
    fontSize: 20,
  },
  dropdownValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  dropdownChevron: {
    fontSize: 18,
    fontWeight: '700',
  },
  bottomActionWrap: {
    paddingTop: 10,
    paddingHorizontal: 20,
    borderTopWidth: 1,
  },
  continueBtn: {
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  continueText: {
    fontSize: 16,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.46)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '72%',
    padding: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  modalList: {
    maxHeight: 360,
  },
  modalListContent: {
    gap: 8,
    paddingBottom: 6,
  },
  langRow: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  langLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  closeBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
