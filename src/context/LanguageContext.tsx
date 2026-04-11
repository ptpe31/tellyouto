import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { DeviceEventEmitter } from 'react-native';

import { DATABASE_RESET_COMPLETE_EVENT } from '../api/localDb';
import i18n from '../locales/i18n';

const STORAGE_KEY = '@tellyouto/language';
const INTERACTION_KEY = '@tellyouto/interaction_language';

export type AppLanguage = 'fr' | 'en' | 'es' | 'de' | 'it' | 'ja' | 'zh';

const supported: AppLanguage[] = ['fr', 'en', 'es', 'de', 'it', 'ja', 'zh'];

function normalizeLocale(tag: string | undefined): AppLanguage {
  if (!tag) return 'en';
  const base = tag.split('-')[0]?.toLowerCase() ?? 'en';
  if (base === 'zh') return 'zh';
  if (supported.includes(base as AppLanguage)) return base as AppLanguage;
  return 'en';
}

type LanguageContextValue = {
  /** Langue de l’interface (i18n) */
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  /** Langue des réponses / interaction IA (indépendante de l’UI) */
  interactionLanguage: AppLanguage;
  setInteractionLanguage: (lang: AppLanguage) => Promise<void>;
  ready: boolean;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const [interactionLanguage, setInteractionLanguageState] =
    useState<AppLanguage>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedUi = await AsyncStorage.getItem(STORAGE_KEY);
        const nextUi =
          storedUi && supported.includes(storedUi as AppLanguage)
            ? (storedUi as AppLanguage)
            : normalizeLocale(Localization.getLocales()[0]?.languageTag);

        const storedAi = await AsyncStorage.getItem(INTERACTION_KEY);
        const nextAi =
          storedAi && supported.includes(storedAi as AppLanguage)
            ? (storedAi as AppLanguage)
            : nextUi;

        await i18n.changeLanguage(nextUi);
        if (!cancelled) {
          setLanguageState(nextUi);
          setInteractionLanguageState(nextAi);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      DATABASE_RESET_COMPLETE_EVENT,
      () => {
        const next = normalizeLocale(
          Localization.getLocales()[0]?.languageTag,
        );
        void (async () => {
          await i18n.changeLanguage(next);
          setLanguageState(next);
          setInteractionLanguageState(next);
        })();
      },
    );
    return () => sub.remove();
  }, []);

  const setLanguage = useCallback(async (lang: AppLanguage) => {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
    await i18n.changeLanguage(lang);
    setLanguageState(lang);
  }, []);

  const setInteractionLanguage = useCallback(async (lang: AppLanguage) => {
    await AsyncStorage.setItem(INTERACTION_KEY, lang);
    setInteractionLanguageState(lang);
  }, []);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      interactionLanguage,
      setInteractionLanguage,
      ready,
    }),
    [language, setLanguage, interactionLanguage, setInteractionLanguage, ready],
  );

  if (!ready) {
    return null;
  }

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
}
