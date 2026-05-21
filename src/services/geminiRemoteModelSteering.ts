/**
 * **Remote steering** du modèle Gemini utilisé par toutes les routes REST.
 *
 * ## Chaîne de résolution
 * 1. **Override Debug** (`debug_override_model`, 24h)
 * 2. **Firebase RC réseau** (`active_gemini_model` après `fetchAndActivate` OK)
 * 3. **Cache RC local** (`rc_model_cache`, AsyncStorage)
 * 4. **Session fallback** (mémoire vive — self-heal 503/404, jamais persisté)
 * 5. **Défaut compilé** (`GEMINI_SAFE_DEFAULT_MODEL_ID`)
 *
 * @module geminiRemoteModelSteering
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchAndActivateRemoteConfig,
  getRemoteConfigStringValue,
  DEFAULT_GEMINI_PASS1_MODEL_ID,
  DEFAULT_GEMINI_PASS2_MODEL_ID,
  RC_KEY_ACTIVE_GEMINI_MODEL,
  RC_KEY_GEMINI_MODEL_FALLBACKS,
  RC_KEY_GEMINI_PASS1_MODEL_ID,
  RC_KEY_GEMINI_PASS2_MODEL_ID,
} from './firebaseRemoteConfig';
import {
  GEMINI_MODEL_SHORTLIST,
  isBannedGeminiModelId,
} from './geminiModelCatalog';

/** Cache local de la dernière valeur RC réseau (secours hors-ligne). */
export const GEMINI_RC_CACHE_STORAGE_KEY = 'rc_model_cache';
/** Override manuel Debug / check santé IA (prioritaire, TTL 24h). */
export const GEMINI_DEBUG_OVERRIDE_STORAGE_KEY = 'debug_override_model';

/** Clés legacy — migration transparente au premier read. */
const LEGACY_RC_CACHE_STORAGE_KEY = 'validated_model_id';
const LEGACY_DEBUG_OVERRIDE_STORAGE_KEY = 'gemini_debug_model_override';

const GEMINI_RC_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const GEMINI_DEBUG_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000;
const STEERING_INIT_TIMEOUT_MS = 2000;

export type GeminiModelResolutionSource =
  | 'debug_override'
  | 'rc_network'
  | 'rc_cache'
  | 'session_fallback'
  | 'hardcoded_default'
  | 'steering_timeout';

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
  return uniq.length ? uniq : ['gemini-3.1-flash-lite'];
}

export const GEMINI_SAFE_DEFAULT_MODEL_ID = getConfiguredShortlist()[0] ?? 'gemini-3.1-flash-lite';
export const GEMINI_PASS1_DEFAULT_MODEL_ID = DEFAULT_GEMINI_PASS1_MODEL_ID;
export const GEMINI_PASS2_DEFAULT_MODEL_ID = DEFAULT_GEMINI_PASS2_MODEL_ID;
const GEMINI_FALLBACK_LIST_MODELS = getConfiguredShortlist();

let cachedActiveGeminiModelId: string = GEMINI_SAFE_DEFAULT_MODEL_ID;
let cachedPass1ModelId: string = GEMINI_PASS1_DEFAULT_MODEL_ID;
let cachedPass2ModelId: string = GEMINI_PASS2_DEFAULT_MODEL_ID;
let sessionFallbackModelId: string | null = null;
let lastRemoteConfigResolvedModelId: string | null = null;
let lastResolutionSource: GeminiModelResolutionSource = 'hardcoded_default';
let steeringInitPromise: Promise<void> | null = null;
let steeringResolutionDone = false;
let fallbackCursor = 0;
/** Blacklist session — modèles 404/503 exclus jusqu'au cold start. */
const sessionBannedModels = new Set<string>();
let sessionCandidateModelIds: string[] | null = null;
let rcDynamicFallbackModelIds: string[] | null = null;
let foregroundRefreshInFlight: Promise<void> | null = null;

function sanitizeRemoteModelId(raw: string): string | null {
  const s = raw.trim().replace(/^models\//, '');
  if (!s || s.length > 160) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(s)) return null;
  return s;
}

type PersistedModelEntry = {
  modelId?: unknown;
  expiresAtMs?: unknown;
};

async function writePersistedModelEntry(
  storageKey: string,
  modelId: string,
  ttlMs: number,
): Promise<void> {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  await AsyncStorage.setItem(
    storageKey,
    JSON.stringify({ modelId: clean, expiresAtMs: Date.now() + ttlMs }),
  );
}

async function readPersistedModelEntry(storageKey: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedModelEntry;
    const modelId = sanitizeRemoteModelId(String(parsed.modelId ?? '').trim());
    const expiresAtMs = Number(parsed.expiresAtMs ?? 0);
    if (!modelId || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await AsyncStorage.removeItem(storageKey);
      return null;
    }
    return modelId;
  } catch {
    return null;
  }
}

async function readPersistedModelEntryWithMigration(
  storageKey: string,
  legacyKey: string,
): Promise<string | null> {
  const current = await readPersistedModelEntry(storageKey);
  if (current) return current;

  const legacy = await readPersistedModelEntry(legacyKey);
  if (!legacy) return null;

  const ttlMs = storageKey === GEMINI_RC_CACHE_STORAGE_KEY
    ? GEMINI_RC_CACHE_TTL_MS
    : GEMINI_DEBUG_OVERRIDE_TTL_MS;
  await writePersistedModelEntry(storageKey, legacy, ttlMs);
  try {
    await AsyncStorage.removeItem(legacyKey);
  } catch {
    /* best effort */
  }
  return legacy;
}

async function persistRcModelToCache(modelId: string): Promise<void> {
  await writePersistedModelEntry(GEMINI_RC_CACHE_STORAGE_KEY, modelId, GEMINI_RC_CACHE_TTL_MS);
}

async function readPersistedRcModel(): Promise<string | null> {
  return readPersistedModelEntryWithMigration(
    GEMINI_RC_CACHE_STORAGE_KEY,
    LEGACY_RC_CACHE_STORAGE_KEY,
  );
}

async function persistDebugModelOverride(modelId: string): Promise<void> {
  await writePersistedModelEntry(
    GEMINI_DEBUG_OVERRIDE_STORAGE_KEY,
    modelId,
    GEMINI_DEBUG_OVERRIDE_TTL_MS,
  );
}

async function readDebugModelOverride(): Promise<string | null> {
  return readPersistedModelEntryWithMigration(
    GEMINI_DEBUG_OVERRIDE_STORAGE_KEY,
    LEGACY_DEBUG_OVERRIDE_STORAGE_KEY,
  );
}

async function clearPersistedRcModel(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GEMINI_RC_CACHE_STORAGE_KEY);
    await AsyncStorage.removeItem(LEGACY_RC_CACHE_STORAGE_KEY);
  } catch {
    /* best effort */
  }
}

async function clearDebugModelOverride(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GEMINI_DEBUG_OVERRIDE_STORAGE_KEY);
    await AsyncStorage.removeItem(LEGACY_DEBUG_OVERRIDE_STORAGE_KEY);
  } catch {
    /* best effort */
  }
}

function parseCsvModelIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const clean = sanitizeRemoteModelId(part);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function getEffectiveFallbackBaseModelIds(): string[] {
  return rcDynamicFallbackModelIds ?? GEMINI_FALLBACK_LIST_MODELS;
}

function applyCompiledFallbackCandidates(): void {
  const active = getActiveGeminiModelId();
  const base = GEMINI_FALLBACK_LIST_MODELS.filter((id) => id !== active);
  setGeminiSessionCandidateModelIds([active, ...base]);
}

async function loadFallbackModelsFromRemoteConfig(): Promise<void> {
  const raw = await getRemoteConfigStringValue(RC_KEY_GEMINI_MODEL_FALLBACKS);
  const parsed = parseCsvModelIds(raw);
  if (parsed.length) {
    rcDynamicFallbackModelIds = parsed;
    const active = getActiveGeminiModelId();
    setGeminiSessionCandidateModelIds([active, ...parsed.filter((id) => id !== active)]);
    return;
  }
  rcDynamicFallbackModelIds = null;
}

function getFallbackListModelsExcluding(excluded: string[]): string[] {
  const ex = new Set(excluded.map((m) => sanitizeRemoteModelId(m) || '').filter(Boolean));
  return getEffectiveFallbackBaseModelIds().filter((m) => !ex.has(m) && !sessionBannedModels.has(m));
}

function rotateFallbackModel(used: string[]): string | null {
  const candidates = getFallbackListModelsExcluding(used);
  if (!candidates.length) return null;
  const pick = candidates[fallbackCursor % candidates.length];
  fallbackCursor += 1;
  setGeminiSessionFallbackModelId(pick);
  return pick;
}

function applyResolvedModel(
  modelId: string,
  rcModelId: string | null,
  source: GeminiModelResolutionSource,
): void {
  cachedActiveGeminiModelId = modelId;
  lastRemoteConfigResolvedModelId = rcModelId;
  lastResolutionSource = source;
  if (source === 'rc_network') {
    sessionFallbackModelId = null;
  }
}

async function resolveSteeringWithoutNetwork(): Promise<void> {
  if (steeringResolutionDone) return;

  const debugModel = await readDebugModelOverride();
  if (debugModel) {
    applyResolvedModel(debugModel, null, 'debug_override');
    steeringResolutionDone = true;
    console.log(`[GEMINI-RC] 🔧 Override Debug (fast-path) : ${debugModel}`);
    return;
  }

  const cachedRc = await readPersistedRcModel();
  if (cachedRc) {
    applyResolvedModel(cachedRc, null, 'rc_cache');
    steeringResolutionDone = true;
    console.log(`[GEMINI-RC] 📦 Cache RC (fast-path) : ${cachedRc}`);
    return;
  }

  applyResolvedModel(GEMINI_SAFE_DEFAULT_MODEL_ID, null, 'steering_timeout');
  steeringResolutionDone = true;
  console.log(`[GEMINI-RC] ⏱️ Timeout steering → défaut : ${GEMINI_SAFE_DEFAULT_MODEL_ID}`);
}

export async function recoverGeminiModelViaListModels(): Promise<string | null> {
  return recoverGeminiModelViaListModelsExcluding([]);
}

export async function recoverGeminiModelViaListModelsExcluding(
  excludedModelIds: string[],
): Promise<string | null> {
  return rotateFallbackModel(excludedModelIds);
}

/** Modèle effectif pour les appels REST (session fallback > résolution boot). */
export function getActiveGeminiModelId(): string {
  return sessionFallbackModelId ?? cachedActiveGeminiModelId;
}

/** Modèle Pass 1 (extraction / capture One-Tap) — piloté par RC `gemini_pass1_model_id`. */
export function getActivePass1ModelId(): string {
  const clean = sanitizeRemoteModelId(cachedPass1ModelId);
  if (clean && !sessionBannedModels.has(clean)) return clean;
  return GEMINI_PASS1_DEFAULT_MODEL_ID;
}

/** Modèle Pass 2 (enrichissement LIST / PROJECT) — piloté par RC `gemini_pass2_model_id`. */
export function getActivePass2ModelId(): string {
  const clean = sanitizeRemoteModelId(cachedPass2ModelId);
  if (clean && !sessionBannedModels.has(clean)) return clean;
  return GEMINI_PASS2_DEFAULT_MODEL_ID;
}

export function getGeminiModelResolutionSource(): GeminiModelResolutionSource {
  if (sessionFallbackModelId) return 'session_fallback';
  return lastResolutionSource;
}

export function setGeminiActiveModelForSession(modelId: string): void {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  cachedActiveGeminiModelId = clean;
  sessionFallbackModelId = null;
  lastRemoteConfigResolvedModelId = clean;
}

/** Fallback session uniquement (mémoire) — ne touche jamais `rc_model_cache`. */
export function setGeminiSessionFallbackModelId(modelId: string): void {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  sessionFallbackModelId = clean;
  lastResolutionSource = 'session_fallback';
}

/** Exclut un modèle défaillant (404/503) pour le reste de la session. */
export function excludeGeminiModelForSession(modelId: string): void {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  sessionBannedModels.add(clean);
  if (__DEV__) {
    console.log(`[GEMINI-RC] 🚫 Modèle exclu (session) : ${clean}`);
  }
}

export function isGeminiModelExcludedForSession(modelId: string): boolean {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return false;
  return sessionBannedModels.has(clean);
}

export function getSessionBannedGeminiModelIds(): string[] {
  return [...sessionBannedModels];
}

/** `true` si `gemini_model_fallbacks` a été lu depuis RC lors du dernier fetch OK. */
export function hasRemoteConfigFallbackModelsLoaded(): boolean {
  return rcDynamicFallbackModelIds != null && rcDynamicFallbackModelIds.length > 0;
}

/** Retourne `true` pour 404, 503 ou 400 « model not found / unsupported ». */
export function shouldExcludeGeminiModelForSession(status: number, bodyText: string): boolean {
  if (status === 404 || status === 503) return true;
  if (status !== 400) return false;
  const t = String(bodyText || '').toLowerCase();
  if (!t) return false;
  return (
    (t.includes('model') && t.includes('not found')) ||
    t.includes('not supported') ||
    t.includes('unsupported') ||
    t.includes('unknown model')
  );
}

export function setGeminiSessionCandidateModelIds(modelIds: string[]): void {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of modelIds) {
    const clean = sanitizeRemoteModelId(raw);
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  sessionCandidateModelIds = out.length ? out : null;
}

export function getLastRemoteConfigResolvedModelId(): string | null {
  return lastRemoteConfigResolvedModelId;
}

export async function hasActiveDebugGeminiModelOverride(): Promise<boolean> {
  return (await readDebugModelOverride()) != null;
}

export async function forceRefreshGeminiRemoteConfig(): Promise<void> {
  steeringInitPromise = null;
  steeringResolutionDone = false;
  sessionFallbackModelId = null;
  const p = refreshGeminiModelFromRemoteConfig();
  steeringInitPromise = p;
  await p;
}

export async function applyGeminiLocalModelOverride(modelId: string): Promise<void> {
  const clean = sanitizeRemoteModelId(modelId);
  if (!clean) return;
  sessionFallbackModelId = null;
  cachedActiveGeminiModelId = clean;
  lastResolutionSource = 'debug_override';
  await persistDebugModelOverride(clean);
}

async function loadPassModelsFromRemoteConfig(): Promise<void> {
  const pass1Raw = await getRemoteConfigStringValue(RC_KEY_GEMINI_PASS1_MODEL_ID);
  const pass1 = pass1Raw ? sanitizeRemoteModelId(pass1Raw) : null;
  if (pass1 && !isBannedGeminiModelId(pass1)) {
    cachedPass1ModelId = pass1;
  }

  const pass2Raw = await getRemoteConfigStringValue(RC_KEY_GEMINI_PASS2_MODEL_ID);
  const pass2 = pass2Raw ? sanitizeRemoteModelId(pass2Raw) : null;
  if (pass2 && !isBannedGeminiModelId(pass2)) {
    cachedPass2ModelId = pass2;
  }
}

async function applyRemoteConfigModelsAfterFetch(fetchOk: boolean): Promise<string | null> {
  await loadPassModelsFromRemoteConfig();
  if (fetchOk) {
    await loadFallbackModelsFromRemoteConfig();
  }

  let rcModel: string | null = null;
  if (fetchOk) {
    const raw = await getRemoteConfigStringValue(RC_KEY_ACTIVE_GEMINI_MODEL);
    rcModel = raw ? sanitizeRemoteModelId(raw) : null;
    if (rcModel) {
      lastRemoteConfigResolvedModelId = rcModel;
      await persistRcModelToCache(rcModel);
    }
  }
  return rcModel;
}

/**
 * Refresh silencieux au retour foreground — non bloquant, préserve blacklist / fallback session.
 */
export async function refreshGeminiModelOnAppForeground(): Promise<void> {
  const debugModel = await readDebugModelOverride();
  const fetchOk = await fetchAndActivateRemoteConfig();
  const rcModel = await applyRemoteConfigModelsAfterFetch(fetchOk);

  if (!fetchOk) return;

  if (debugModel) {
    if (__DEV__ && rcModel) {
      console.log(`[GEMINI-RC] 🔄 Foreground RC (debug override, cache MAJ : ${rcModel})`);
    }
    return;
  }

  if (rcModel && !sessionBannedModels.has(rcModel)) {
    cachedActiveGeminiModelId = rcModel;
    lastResolutionSource = 'rc_network';
    if (sessionFallbackModelId && sessionFallbackModelId !== rcModel) {
      sessionFallbackModelId = null;
    }
    if (__DEV__) {
      console.log(`[GEMINI-RC] 🔄 Foreground RC appliqué : ${rcModel}`);
    }
    return;
  }

  if (__DEV__ && rcModel) {
    console.log(`[GEMINI-RC] 🔄 Foreground RC (cache MAJ, modèle banni en session : ${rcModel})`);
  }
}

/** Lance un refresh RC foreground fire-and-forget (AppState → active). */
export function scheduleGeminiForegroundRemoteConfigRefresh(): void {
  if (foregroundRefreshInFlight) return;
  foregroundRefreshInFlight = refreshGeminiModelOnAppForeground()
    .catch(() => {
      /* silencieux */
    })
    .finally(() => {
      foregroundRefreshInFlight = null;
    });
}

export async function refreshGeminiModelFromRemoteConfig(): Promise<void> {
  steeringResolutionDone = false;
  sessionFallbackModelId = null;

  const debugModel = await readDebugModelOverride();
  const fetchOk = await fetchAndActivateRemoteConfig();
  const rcModel = await applyRemoteConfigModelsAfterFetch(fetchOk);

  if (fetchOk && !sessionCandidateModelIds) {
    applyCompiledFallbackCandidates();
  }

  if (debugModel) {
    applyResolvedModel(debugModel, rcModel, 'debug_override');
    steeringResolutionDone = true;
    console.log(
      `[GEMINI-RC] 🔧 Override Debug : ${debugModel}` +
        (rcModel ? ` (RC réseau : ${rcModel}, non appliqué)` : fetchOk ? ' (RC vide / invalide)' : ' (RC fetch échoué)'),
    );
    return;
  }

  if (fetchOk && rcModel) {
    applyResolvedModel(rcModel, rcModel, 'rc_network');
    steeringResolutionDone = true;
    console.log(`[GEMINI-RC] ✅ Modèle Remote Config (réseau) : ${rcModel}`);
    return;
  }

  const cachedRc = await readPersistedRcModel();
  if (cachedRc) {
    applyResolvedModel(cachedRc, null, 'rc_cache');
    steeringResolutionDone = true;
    console.log(
      `[GEMINI-RC] 📦 Cache RC hors-ligne : ${cachedRc}` +
        (fetchOk ? ' (RC réseau vide / invalide)' : ' (fetch RC échoué)'),
    );
    return;
  }

  applyResolvedModel(GEMINI_SAFE_DEFAULT_MODEL_ID, null, 'hardcoded_default');
  steeringResolutionDone = true;
  console.log(`[GEMINI-RC] ⚙️ Défaut compilé : ${GEMINI_SAFE_DEFAULT_MODEL_ID}`);
}

export function ensureGeminiRemoteModelInitialized(): Promise<void> {
  if (!steeringInitPromise) {
    steeringInitPromise = refreshGeminiModelFromRemoteConfig().finally(() => {
      steeringResolutionDone = true;
    });
  }
  return steeringInitPromise;
}

/**
 * Verrou avant tout appel Gemini : attend la résolution RC (max {@link STEERING_INIT_TIMEOUT_MS}).
 * Si timeout, résolution hors-ligne (Debug > cache RC > défaut) sans bloquer One-Tap.
 */
export async function awaitGeminiSteeringBeforeNetworkCall(): Promise<void> {
  const initPromise = ensureGeminiRemoteModelInitialized();
  let timedOut = false;

  await Promise.race([
    initPromise,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, STEERING_INIT_TIMEOUT_MS);
    }),
  ]);

  if (timedOut && !steeringResolutionDone) {
    await resolveSteeringWithoutNetwork();
  }
}

export function getGeminiCandidateModelIds(): string[] {
  const preferredActive = getActiveGeminiModelId();
  const active = sessionBannedModels.has(preferredActive) ? '' : preferredActive;
  const base = sessionCandidateModelIds ?? getEffectiveFallbackBaseModelIds();
  const raw = active
    ? [active, ...base.filter((id) => id !== active)]
    : [...base];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    const clean = sanitizeRemoteModelId(id) ?? '';
    if (!clean) continue;
    if (sessionBannedModels.has(clean)) continue;
    if (seen.has(clean)) continue;
    if (clean !== active && isBannedGeminiModelId(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  if (out.length) return out;

  const defaultId = sanitizeRemoteModelId(GEMINI_SAFE_DEFAULT_MODEL_ID);
  if (defaultId && !sessionBannedModels.has(defaultId)) return [defaultId];
  return preferredActive ? [preferredActive] : [GEMINI_SAFE_DEFAULT_MODEL_ID];
}

/** @deprecated Self-heal session-only — n'écrit plus dans le cache RC. */
export function persistValidatedGeminiModelId(modelId: string): void {
  setGeminiSessionFallbackModelId(modelId);
}

export async function clearGeminiValidatedModelCache(): Promise<void> {
  await clearPersistedRcModel();
  await clearDebugModelOverride();
  sessionFallbackModelId = null;
  cachedActiveGeminiModelId = GEMINI_SAFE_DEFAULT_MODEL_ID;
  lastRemoteConfigResolvedModelId = null;
  lastResolutionSource = 'hardcoded_default';
  steeringInitPromise = null;
  steeringResolutionDone = false;
}

export {
  fetchPass3DailyRoadmapPromptTemplate,
  PASS3_PROMPT_FALLBACK_TEMPLATE,
} from './firebaseRemoteConfig';
