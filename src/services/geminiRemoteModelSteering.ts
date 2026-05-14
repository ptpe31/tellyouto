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

import {
  GEMINI_MODEL_SHORTLIST,
  isBannedGeminiModelId,
} from './geminiModelCatalog';

function getConfiguredShortlist(): string[] {
  const env = sanitizeRemoteModelId(process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim() ?? '');
  const base = env ? [env, ...GEMINI_MODEL_SHORTLIST] : [...GEMINI_MODEL_SHORTLIST];
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const raw of base) {
    const clean = sanitizeRemoteModelId(raw);
    if (!clean) continue;
    if (isBannedGeminiModelId(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    uniq.push(clean);
  }
  return uniq.length ? uniq : ['gemini-1.5-flash'];
}

export const GEMINI_SAFE_DEFAULT_MODEL_ID = getConfiguredShortlist()[0] ?? 'gemini-1.5-flash';
const GEMINI_FALLBACK_LIST_MODELS = getConfiguredShortlist();

let cachedActiveGeminiModelId: string = GEMINI_SAFE_DEFAULT_MODEL_ID;
let lastRemoteConfigResolvedModelId: string | null = null;
let steeringInitPromise: Promise<void> | null = null;
let fallbackCursor = 0;
const sessionExcludedModelIds = new Set<string>();
let sessionCandidateModelIds: string[] | null = null;

/** Secours local après self-heal (24h). */
const GEMINI_FALLBACK_STORAGE_KEY = 'validated_model_id';
const GEMINI_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const RECOVER_COOLDOWN_MS = 90_000;
let recoverInFlight: Promise<string | null> | null = null;
let lastRecoverAttemptAtMs = 0;
let lastRecoverSucceededAtMs = 0;

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

async function readPersistedFallbackModel(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(GEMINI_FALLBACK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { modelId?: unknown; expiresAtMs?: unknown };
    const modelId = sanitizeRemoteModelId(String(parsed.modelId ?? '').trim());
    const expiresAtMs = Number(parsed.expiresAtMs ?? 0);
    if (!modelId || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await clearPersistedFallbackModel();
      return null;
    }
    return modelId;
  } catch {
    return null;
  }
}

/** Efface le secours disque (appelé dès qu’un refresh RC a réussi — RC reprend la priorité). */
async function clearPersistedFallbackModel(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GEMINI_FALLBACK_STORAGE_KEY);
  } catch {
    /* best effort */
  }
}

function getFallbackListModelsExcluding(excluded: string[]): string[] {
  const ex = new Set(excluded.map((m) => sanitizeRemoteModelId(m) || '').filter(Boolean));
  return GEMINI_FALLBACK_LIST_MODELS.filter((m) => !ex.has(m));
}

async function rotateFallbackModel(used: string[]): Promise<string | null> {
  const candidates = getFallbackListModelsExcluding(used);
  if (!candidates.length) return null;
  const pick = candidates[fallbackCursor % candidates.length];
  fallbackCursor += 1;
  await persistFallbackModelFor24h(pick);
  cachedActiveGeminiModelId = pick;
  return pick;
}

/**
 * **Self-healing** après HTTP **404** ou **503** sur `:generateContent` / stream : interroge `listModels`,
 * sélectionne un modèle préféré, enregistre le secours 24h et met à jour le cache.
 *
 * @returns L’id du modèle choisi, ou `null` si pas de clé API ou échec réseau.
 */
export async function recoverGeminiModelViaListModels(): Promise<string | null> {
  return recoverGeminiModelViaListModelsExcluding([]);
}

export async function recoverGeminiModelViaListModelsExcluding(
  excludedModelIds: string[],
): Promise<string | null> {
  return rotateFallbackModel(excludedModelIds);
}

/** Modèle effectif pour les appels REST Gemini (mis à jour après `ensureGeminiRemoteModelInitialized`). */
export function getActiveGeminiModelId(): string {
  return cachedActiveGeminiModelId;
}

export function setGeminiActiveModelForSession(modelId: string): void {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  cachedActiveGeminiModelId = clean;
  lastRemoteConfigResolvedModelId = clean;
}

export function excludeGeminiModelForSession(modelId: string): void {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  sessionExcludedModelIds.add(clean);
}

export function isGeminiModelExcludedForSession(modelId: string): boolean {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return false;
  return sessionExcludedModelIds.has(clean);
}

export function setGeminiSessionCandidateModelIds(modelIds: string[]): void {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of modelIds) {
    const clean = sanitizeRemoteModelId(raw);
    if (!clean) continue;
    if (isBannedGeminiModelId(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  sessionCandidateModelIds = out.length ? out : null;
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
  if (!clean) return;
  cachedActiveGeminiModelId = clean;
  await persistFallbackModelFor24h(clean);
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
  const persisted = await readPersistedFallbackModel();
  if (persisted) {
    cachedActiveGeminiModelId = persisted;
    lastRemoteConfigResolvedModelId = persisted;
    return;
  }
  cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
  lastRemoteConfigResolvedModelId = cachedActiveGeminiModelId;
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

export function getGeminiCandidateModelIds(): string[] {
  const base = sessionCandidateModelIds ?? GEMINI_FALLBACK_LIST_MODELS;
  const active = getActiveGeminiModelId();
  const raw = [active, ...base.filter((id) => id !== active)];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    const clean = sanitizeRemoteModelId(id) ?? '';
    if (!clean) continue;
    if (isBannedGeminiModelId(clean)) continue;
    if (sessionExcludedModelIds.has(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export async function persistValidatedGeminiModelId(modelId: string): Promise<void> {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  cachedActiveGeminiModelId = clean;
  lastRemoteConfigResolvedModelId = clean;
  await persistFallbackModelFor24h(clean);
}

export async function clearGeminiValidatedModelCache(): Promise<void> {
  await clearPersistedFallbackModel();
  cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
  lastRemoteConfigResolvedModelId = cachedActiveGeminiModelId;
}

const PASS3_PROMPT_RC_KEY = 'prompt_pass3_synth_v1';

/** Secours local si Remote Config indisponible ou clé vide. */
export const PASS3_PROMPT_FALLBACK_TEMPLATE = `Tu es l'architecte de synthèse d'une application mobile de planning. Transforme ce JSON d'intentions en une feuille de route HTML épurée.

Focus du jour (phrase courte).

Itinéraire Newton (TRIPs groupés).

Coup de Boost (orphelines les plus anciennes via age_days).

Groupements thématiques (ADMIN, MAISON, SHOPPING ou autre).
Réponds strictement dans la langue des intentions. HTML inline uniquement.`;

/**
 * Prompt système Pass 3 (Feuille de route) — **Remote Config** `prompt_pass3_synth_v1`, même chaîne que les autres
 * paramètres RC (fetch + `getValue`), avec repli {@link PASS3_PROMPT_FALLBACK_TEMPLATE}.
 */
export async function fetchPass3DailyRoadmapPromptTemplate(): Promise<string> {
  const { getFirebaseApp } = await import('../api/firebase');
  const app = getFirebaseApp();
  if (!app) return PASS3_PROMPT_FALLBACK_TEMPLATE;
  try {
    const { getRemoteConfig, getValue, fetchAndActivate } = await import('firebase/remote-config');
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = __DEV__ ? 0 : 6 * 60 * 60 * 1000;
    rc.defaultConfig = {
      [PASS3_PROMPT_RC_KEY]: PASS3_PROMPT_FALLBACK_TEMPLATE,
    };
    try {
      await fetchAndActivate(rc);
    } catch {
      /* ignore */
    }
    const raw = getValue(rc, PASS3_PROMPT_RC_KEY).asString().trim();
    return raw.length > 0 ? raw : PASS3_PROMPT_FALLBACK_TEMPLATE;
  } catch {
    return PASS3_PROMPT_FALLBACK_TEMPLATE;
  }
}
