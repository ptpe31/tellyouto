/**
 * Pilotage du modèle Gemini via Firebase Remote Config (`active_gemini_model`).
 * Fail-safe : si Firebase / RC est indisponible → {@link GEMINI_SAFE_DEFAULT_MODEL_ID}.
 *
 * @module geminiRemoteModelSteering
 */

import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';

import { ensureFirebaseAnonymousAuth, getFirebaseApp } from '../api/firebase';

/** Valeur RC attendue côté console Firebase. */
export const REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL = 'active_gemini_model';

/** Modèle utilisé tant que RC n’a pas répondu ou si la clé est vide / invalide. */
export const GEMINI_SAFE_DEFAULT_MODEL_ID = 'gemini-1.5-flash-latest';

let cachedActiveGeminiModelId: string = GEMINI_SAFE_DEFAULT_MODEL_ID;
let steeringInitPromise: Promise<void> | null = null;

function sanitizeRemoteModelId(raw: string): string | null {
  const s = raw.trim().replace(/^models\//, '');
  if (!s || s.length > 160) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(s)) return null;
  return s;
}

/** Modèle effectif pour les appels REST Gemini (mis à jour après `ensureGeminiRemoteModelInitialized`). */
export function getActiveGeminiModelId(): string {
  return cachedActiveGeminiModelId;
}

/**
 * Télécharge / active Remote Config et met à jour le cache du modèle.
 * Sans Firebase configuré : cache = {@link GEMINI_SAFE_DEFAULT_MODEL_ID}.
 */
export async function refreshGeminiModelFromRemoteConfig(): Promise<void> {
  const app = getFirebaseApp();
  if (!app) {
    cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
    if (__DEV__) {
      console.log(
        `[GeminiSteering] Firebase absent — modèle par défaut ${GEMINI_SAFE_DEFAULT_MODEL_ID}`,
      );
    }
    return;
  }

  try {
    await ensureFirebaseAnonymousAuth();
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = __DEV__ ? 60_000 : 4 * 60 * 60 * 1000;
    try {
      await fetchAndActivate(rc);
    } catch (e) {
      if (__DEV__) {
        console.warn('[GeminiSteering] fetchAndActivate (valeurs locales RC)', e);
      }
    }
    const raw = getValue(rc, REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL).asString();
    const clean = sanitizeRemoteModelId(raw);
    if (clean) {
      cachedActiveGeminiModelId = clean;
      if (__DEV__) {
        console.log(`[GeminiSteering] ${REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL}=${clean}`);
      }
    } else {
      cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
      if (__DEV__) {
        console.log(
          `[GeminiSteering] RC vide ou invalide — ${GEMINI_SAFE_DEFAULT_MODEL_ID}`,
        );
      }
    }
  } catch (e) {
    cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
    if (__DEV__) {
      console.warn('[GeminiSteering] Remote Config indisponible', e);
    }
  }
}

/**
 * Une seule promesse partagée au démarrage : fetch RC + cache.
 * Peut être rappelée sans coût (même promesse).
 */
export function ensureGeminiRemoteModelInitialized(): Promise<void> {
  if (!steeringInitPromise) {
    steeringInitPromise = refreshGeminiModelFromRemoteConfig();
  }
  return steeringInitPromise;
}
