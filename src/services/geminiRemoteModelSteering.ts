/**
 * Pilotage du modèle Gemini via Firebase Remote Config (`active_gemini_model`).
 * Fail-safe : si Firebase / RC est indisponible → {@link GEMINI_SAFE_DEFAULT_MODEL_ID}.
 * Self-healing : sur erreur HTTP Gemini 404/503 ou échec RC avec clé dispo → `listModels` + cache + AsyncStorage 24h.
 *
 * @module geminiRemoteModelSteering
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';

import { ensureFirebaseAnonymousAuth, getFirebaseApp } from '../api/firebase';
import { fetchAllGeminiModelsList, pickPreferredGeminiModelId } from './geminiModelCatalog';

/** Valeur RC attendue côté console Firebase. */
export const REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL = 'active_gemini_model';

/** Modèle utilisé tant que RC n’a pas répondu ou si la clé est vide / invalide. */
export const GEMINI_SAFE_DEFAULT_MODEL_ID = 'gemini-1.5-flash-latest';

let cachedActiveGeminiModelId: string = GEMINI_SAFE_DEFAULT_MODEL_ID;
let steeringInitPromise: Promise<void> | null = null;

/** Secours local après self-heal (24h). */
const GEMINI_FALLBACK_STORAGE_KEY = 'tellyouto_gemini_model_fallback_v1';
const GEMINI_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;

function sanitizeRemoteModelId(raw: string): string | null {
  const s = raw.trim().replace(/^models\//, '');
  if (!s || s.length > 160) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(s)) return null;
  return s;
}

async function readStoredFallbackModelId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(GEMINI_FALLBACK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { modelId?: string; expiresAtMs?: number };
    if (typeof parsed.expiresAtMs !== 'number' || parsed.expiresAtMs <= Date.now()) {
      await AsyncStorage.removeItem(GEMINI_FALLBACK_STORAGE_KEY);
      return null;
    }
    return sanitizeRemoteModelId(String(parsed.modelId ?? ''));
  } catch {
    return null;
  }
}

async function persistFallbackModelFor24h(modelId: string): Promise<void> {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  await AsyncStorage.setItem(
    GEMINI_FALLBACK_STORAGE_KEY,
    JSON.stringify({ modelId: clean, expiresAtMs: Date.now() + GEMINI_FALLBACK_TTL_MS }),
  );
}

/**
 * Si un secours AsyncStorage (< 24h) existe, il remplace le cache (priorité sur RC défaillante).
 */
async function applyPersistedFallbackIfValid(): Promise<void> {
  const fb = await readStoredFallbackModelId();
  if (fb) {
    cachedActiveGeminiModelId = fb;
    if (__DEV__) {
      console.log(`[GeminiSteering] fallback AsyncStorage actif → ${fb}`);
    }
  }
}

async function tryRecoverFromListModels(apiKey: string): Promise<string | null> {
  try {
    const models = await fetchAllGeminiModelsList(apiKey);
    const picked = pickPreferredGeminiModelId(models);
    if (!picked) return null;
    await persistFallbackModelFor24h(picked);
    cachedActiveGeminiModelId = picked;
    if (__DEV__) {
      console.log(`[GeminiSteering] listModels → ${picked} (${models.length} modèles)`);
    }
    return picked;
  } catch (e) {
    if (__DEV__) {
      console.warn('[GeminiSteering] listModels échoué', e);
    }
    return null;
  }
}

/**
 * Après HTTP 404 / 503 sur `:generateContent` ou équivalent : détection locale + persistance 24h.
 */
export async function recoverGeminiModelViaListModels(): Promise<string | null> {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
  if (!key) return null;
  return tryRecoverFromListModels(key);
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
    await applyPersistedFallbackIfValid();
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
    await applyPersistedFallbackIfValid();
  } catch (e) {
    cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
    if (__DEV__) {
      console.warn('[GeminiSteering] Remote Config indisponible', e);
    }
    const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
    const recovered = key ? await tryRecoverFromListModels(key) : null;
    if (!recovered) {
      await applyPersistedFallbackIfValid();
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
