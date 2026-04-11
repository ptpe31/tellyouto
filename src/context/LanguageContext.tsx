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
import i18n from '../locales/i18n';

const STORAGE_KEY = '@tellyouto/language';

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
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  ready: boolean;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        const next =
          stored && supported.includes(stored as AppLanguage)
            ? (stored as AppLanguage)
            : normalizeLocale(Localization.getLocales()[0]?.languageTag);
        await i18n.changeLanguage(next);
        if (!cancelled) {
          setLanguageState(next);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback(async (lang: AppLanguage) => {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
    await i18n.changeLanguage(lang);
    setLanguageState(lang);
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, ready }),
    [language, setLanguage, ready],
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
