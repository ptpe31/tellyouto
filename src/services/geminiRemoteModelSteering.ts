/**
 * **Remote steering** du modèle Gemini utilisé par toutes les routes REST (`:generateContent` / `:streamGenerateContent`).
 *
 * ## Chaîne de résolution (démarrage / refresh RC)
 * 1. **Remote Config** — clé `active_gemini_model`, lue après `fetchAndActivate`. Toujours **prioritaire** : le cache
 *    mémoire reprend la valeur RC (ou {@link GEMINI_SAFE_DEFAULT_MODEL_ID} si la clé est vide / invalide).
 * 2. **Vidage du secours** — dès que le RC est lu avec succès (fetch + lecture param), le stockage
 *    {@link GEMINI_FALLBACK_STORAGE_KEY} est **effacé** : plus d’override silencieux au boot depuis AsyncStorage.
 * 3. **Firebase absent ou exception RC** — cache = {@link GEMINI_SAFE_DEFAULT_MODEL_ID}, puis tentative
 *    {@link tryRecoverFromListModels} si clé API présente (sans relire AsyncStorage en secours silencieux).
 *
 * ## Self-healing (après échec **appel modèle** 404 / 503)
 * Les appelants déclenchent {@link recoverGeminiModelViaListModels} → `listModels` → modèle préféré → persistance
 * 24h + mise à jour du cache **en mémoire** pour la session. Au prochain **refresh RC réussi**, le secours disque est
 * vidé et la valeur RC reprend la main.
 *
 * **Override manuel Debug** — {@link applyGeminiLocalModelOverride} écrit encore le secours 24h + cache ; un refresh RC
 * réussi le **remplace** par la valeur RC et vide le disque (comportement aligné sur « RC prioritaire »).
 *
 * Le **modèle effectif** pour une requête est {@link getActiveGeminiModelId} (RC au boot, puis self-heal en session si besoin).
 *
 * @see {@link forceRefreshGeminiRemoteConfig} — écran Debug : forcer un nouveau fetch RC.
 * @see {@link applyGeminiLocalModelOverride} — check santé IA : appliquer un gagnant local 24h.
 * @module geminiRemoteModelSteering
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureFirebaseAnonymousAuth, getFirebaseApp } from '../api/firebase';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';

import { fetchAllGeminiModelsList, pickPreferredGeminiModelId } from './geminiModelCatalog';

/** Erreurs plateforme RC (IndexedDB / Hermes) — pas d’avertissement console, repli sur valeurs locales ou défaut. */
function isBenignRemoteConfigPlatformError(e: unknown): boolean {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code?: string }).code ?? '')
      : '';
  const msg = e instanceof Error ? e.message : String(e);
  const bundle = `${code} ${msg}`.toLowerCase();
  return (
    bundle.includes('indexeddb') ||
    bundle.includes('indexed db') ||
    bundle.includes('storage-open') ||
    bundle.includes('idb') ||
    bundle.includes('indexeddb-unavailable') ||
    (bundle.includes('property') && bundle.includes("doesn't exist") && bundle.includes('indexed'))
  );
}

/** Valeur RC attendue côté console Firebase. */
export const REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL = 'active_gemini_model';

/** Modèle utilisé tant que RC n’a pas répondu ou si la clé est vide / invalide. */
export const GEMINI_SAFE_DEFAULT_MODEL_ID = 'gemini-1.5-flash-latest';

let cachedActiveGeminiModelId: string = GEMINI_SAFE_DEFAULT_MODEL_ID;
/** Dernière valeur lue depuis le paramètre RC `active_gemini_model` (fetch réussi). `null` si Firebase absent ou exception hors try RC. */
let lastRemoteConfigResolvedModelId: string | null = null;
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

async function persistFallbackModelFor24h(modelId: string): Promise<void> {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  await AsyncStorage.setItem(
    GEMINI_FALLBACK_STORAGE_KEY,
    JSON.stringify({ modelId: clean, expiresAtMs: Date.now() + GEMINI_FALLBACK_TTL_MS }),
  );
}

/** Efface le secours disque (appelé dès qu’un refresh RC a réussi — RC reprend la priorité). */
async function clearPersistedFallbackModel(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GEMINI_FALLBACK_STORAGE_KEY);
  } catch {
    /* best effort */
  }
}

/**
 * Appelle l’API `listModels`, choisit un id via {@link pickPreferredGeminiModelId}, persiste et met à jour le cache.
 * @internal
 */
async function tryRecoverFromListModels(apiKey: string): Promise<string | null> {
  try {
    const models = await fetchAllGeminiModelsList(apiKey);
    const picked = pickPreferredGeminiModelId(models);
    if (!picked) return null;
    await persistFallbackModelFor24h(picked);
    cachedActiveGeminiModelId = picked;
    console.log(
      `[GeminiSteering] 🛠️ SELF_HEALING_TRIGGERED\n| Found: ${models.length} models\n| New Local Choice: ${picked}`,
    );
    return picked;
  } catch (e) {
    if (__DEV__) {
      console.warn('[GeminiSteering] listModels échoué', e);
    }
    return null;
  }
}

/**
 * **Self-healing** après HTTP **404** ou **503** sur `:generateContent` / stream : interroge `listModels`,
 * sélectionne un modèle préféré, enregistre le secours 24h et met à jour le cache.
 *
 * @returns L’id du modèle choisi, ou `null` si pas de clé API ou échec réseau.
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

/** Modèle issu du dernier fetch RC (sans tenir compte du secours local 24h). */
export function getLastRemoteConfigResolvedModelId(): string | null {
  return lastRemoteConfigResolvedModelId;
}

/**
 * Force un nouveau fetch RC (ignore la promesse d’init partagée une fois).
 */
export async function forceRefreshGeminiRemoteConfig(): Promise<void> {
  steeringInitPromise = null;
  const p = refreshGeminiModelFromRemoteConfig();
  steeringInitPromise = p;
  await p;
}

/**
 * Applique un modèle choisi manuellement (ex. **check santé IA** sur l’écran Debug) : persistance
 * {@link GEMINI_FALLBACK_STORAGE_KEY} + mise à jour du cache mémoire pour la session en cours.
 * Un **refresh RC réussi** (`forceRefreshGeminiRemoteConfig` / init) réapplique la valeur RC et **vide** ce secours.
 *
 * @throws Si l’id ne passe pas {@link sanitizeRemoteModelId}.
 */
export async function applyGeminiLocalModelOverride(modelId: string): Promise<void> {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) {
    throw new Error('applyGeminiLocalModelOverride: invalid model id');
  }
  await persistFallbackModelFor24h(clean);
  cachedActiveGeminiModelId = clean;
}

/**
 * Pipeline principal : authent anonyme si besoin, `fetchAndActivate` RC, lecture `active_gemini_model`,
 * mise à jour de {@link lastRemoteConfigResolvedModelId} et du cache, puis **vidage** du secours AsyncStorage
 * ({@link clearPersistedFallbackModel}) pour que la valeur RC reste prioritaire au prochain cold start.
 *
 * En cas d’exception RC : défaut + {@link tryRecoverFromListModels} si clé API (sans relire le secours disque).
 *
 * @remarks Intervalle minimal entre fetch RC : 60s en `__DEV__`, 4h en production (paramètre SDK client).
 */
export async function refreshGeminiModelFromRemoteConfig(): Promise<void> {
  const app = getFirebaseApp();
  if (!app) {
    lastRemoteConfigResolvedModelId = null;
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
      lastRemoteConfigResolvedModelId = clean;
      cachedActiveGeminiModelId = clean;
      if (__DEV__) {
        console.log(`[GeminiSteering] ${REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL}=${clean}`);
      }
    } else {
      lastRemoteConfigResolvedModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
      cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
      if (__DEV__) {
        console.log(
          `[GeminiSteering] RC vide ou invalide — ${GEMINI_SAFE_DEFAULT_MODEL_ID}`,
        );
      }
    }
    await clearPersistedFallbackModel();
  } catch (e) {
    lastRemoteConfigResolvedModelId = null;
    cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
    if (__DEV__ && !isBenignRemoteConfigPlatformError(e)) {
      console.warn('[GeminiSteering] Remote Config indisponible', e);
    }
    const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
    if (key) {
      await tryRecoverFromListModels(key);
    }
  }
}

/**
 * Initialise une seule fois le steering (promesse partagée). Les appels suivants retournent la même promesse
 * jusqu’à ce que {@link forceRefreshGeminiRemoteConfig} réinitialise le singleton.
 */
export function ensureGeminiRemoteModelInitialized(): Promise<void> {
  if (!steeringInitPromise) {
    steeringInitPromise = refreshGeminiModelFromRemoteConfig();
  }
  return steeringInitPromise;
}
