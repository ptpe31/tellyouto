import React, { createContext, useContext, useMemo, useState } from 'react';
import en from './en.json';

type Dict = Record<string, string>;
type Locale = 'en';

const dictionaries: Record<Locale, Dict> = { en };

let activeLocale: Locale = 'en';

function applyTemplate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k: string) => {
    if (!(k in vars)) return `{${k}}`;
    return String(vars[k]);
  });
}

export function t(key: string, vars?: Record<string, string | number>, locale?: Locale): string {
  const d = dictionaries[locale ?? activeLocale] ?? dictionaries.en;
  const v = d[key] ?? key;
  return applyTemplate(v, vars);
}

type I18nValue = { locale: Locale; setLocale: (l: Locale) => void };
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider(props: { initialLocale?: Locale; children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(props.initialLocale ?? 'en');
  activeLocale = locale;
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useTranslation(): { t: typeof t; locale: Locale } {
  const ctx = useContext(I18nContext);
  return { t, locale: ctx?.locale ?? 'en' };
}

