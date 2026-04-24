import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import it from './it.json';
import ja from './ja.json';
import ko from './ko.json';
import nl from './nl.json';
import sv from './sv.json';
import zh from './zh.json';
import ar from './ar.json';

const supported = new Set(['fr', 'en', 'es', 'de', 'it', 'ja', 'zh', 'ar', 'ko', 'nl', 'sv']);
const deviceBase =
  Localization.getLocales()[0]?.languageCode?.split('-')[0]?.toLowerCase() ?? 'en';
const initialLng = supported.has(deviceBase) ? deviceBase : 'en';

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: initialLng,
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    es: { translation: es },
    de: { translation: de },
    it: { translation: it },
    ja: { translation: ja },
    zh: { translation: zh },
    ar: { translation: ar },
    ko: { translation: ko },
    nl: { translation: nl },
    sv: { translation: sv },
  },
  fallbackLng: 'en',
  supportedLngs: ['fr', 'en', 'es', 'de', 'it', 'ja', 'zh', 'ar', 'ko', 'nl', 'sv'],
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

export default i18n;
