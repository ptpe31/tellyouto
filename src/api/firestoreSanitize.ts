import { Timestamp } from 'firebase/firestore';

function isFirestoreFieldValue(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as { _methodName?: string })._methodName === 'string'
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Timestamp) &&
    !isFirestoreFieldValue(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/**
 * Rend un objet compatible Firestore : pas de `undefined` (interdit par le SDK).
 * — `undefined` → `null` (ou `0` pour `ad_free_until_ms` si absent / invalide).
 * — objets JSON simples : récursion superficielle (ex. `weights`).
 */
export function sanitizeFirestoreMap(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) {
      out[k] = k === 'ad_free_until_ms' ? 0 : null;
      continue;
    }
    if (v === null) {
      out[k] = null;
      continue;
    }
    if (isFirestoreFieldValue(v) || v instanceof Timestamp) {
      out[k] = v;
      continue;
    }
    if (isPlainObject(v)) {
      out[k] = sanitizeFirestoreMap(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}
