import { Alert } from 'react-native';

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
 * À appeler depuis un catch avant de relancer l’erreur si besoin.
 */
export function alertNativeModuleMissing(context: string, err: unknown): void {
  const mod = extractMissingNativeModuleName(err);
  const name = mod ?? '(module inconnu)';
  const detail = err instanceof Error ? err.message : String(err);
  Alert.alert(
    'ERREUR MODULE NATIF',
    `${name} manquant ou non lié au binaire actuel.\n` +
      `Contexte : ${context}\n` +
      `→ Rebuild Android requis (npx expo prebuild --clean --platform android puis compilation).\n\n` +
      `${detail}`,
  );
}

export function isLikelyMissingNativeModuleError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('cannot find native module') ||
    (msg.includes('native module') && msg.includes('not found'))
  );
}
