import { Alert } from 'react-native';

import i18n from '../locales/i18n';

const NATIVE_MODULE_RE = /Cannot find native module ['"]([^'"]+)['"]/i;

/**
 * Extrait le nom du module natif depuis l’erreur Expo / RN typique.
 */
export function extractMissingNativeModuleName(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(NATIVE_MODULE_RE);
  return m?.[1]?.trim() ?? null;
}

/**
 * Alerte bloquante pour APK / dev client désynchronisé avec package.json.
 * `contextI18nKey` : clé i18n complète (ex. `nativeModule.contextTalkHomeSpeech`).
 */
export function alertNativeModuleMissing(contextI18nKey: string, err: unknown): void {
  const mod = extractMissingNativeModuleName(err);
  const name = mod ?? i18n.t('nativeModule.unknownModuleName');
  const detail = err instanceof Error ? err.message : String(err);
  const context = i18n.t(contextI18nKey);
  Alert.alert(
    i18n.t('nativeModule.missingTitle'),
    i18n.t('nativeModule.missingBody', { name, context, detail }),
  );
}

export function isLikelyMissingNativeModuleError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('cannot find native module') ||
    (msg.includes('native module') && msg.includes('not found'))
  );
}
