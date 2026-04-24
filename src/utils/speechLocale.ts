import * as Localization from 'expo-localization';

const BASE_TO_BCP47: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  it: 'it-IT',
  ja: 'ja-JP',
  zh: 'zh-CN',
  ar: 'ar-SA',
  ko: 'ko-KR',
  nl: 'nl-NL',
  sv: 'sv-SE',
};

function bcp47FromUiLanguage(uiLanguageCode: string): string | null {
  const normalized = uiLanguageCode?.trim();
  if (!normalized) return null;
  if (normalized.includes('-') || normalized.includes('_')) {
    return normalized.replace('_', '-');
  }
  const base = normalized.split(/[-_]/)[0]?.toLowerCase();
  if (!base) return null;
  return BASE_TO_BCP47[base] ?? `${base}-${base.toUpperCase()}`;
}

function systemBcp47Tag(): string | null {
  const system = Localization.getLocales()[0]?.languageTag?.trim();
  if (system) return system;
  const resolved = Intl.DateTimeFormat().resolvedOptions().locale?.trim();
  if (resolved && resolved !== 'und') return resolved;
  return null;
}

/**
 * Locale BCP-47 pour l’ASR native : priorité UI i18n, puis système, puis `en-US`.
 * Le fallback en cascade évite les erreurs de démarrage ASR quand une locale manque.
 */
export function resolveSpeechLangForSession(uiLanguageCode: string): string {
  return bcp47FromUiLanguage(uiLanguageCode) ?? systemBcp47Tag() ?? 'en-US';
}

/** Alias rétro-compatible. */
export const speechRecognitionBcp47Tag = resolveSpeechLangForSession;
