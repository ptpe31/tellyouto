/**
 * Singleton Firebase Remote Config — init unique (intervalle, defaultConfig) pour tous les modules.
 *
 * Modèles Gemini : deux clés RC dédiées (`gemini_pass1_model_id`, `gemini_pass2_model_id`) avec
 * défauts compilés dans `defaultConfig` (extraction rapide vs raisonnement profond).
 */

import '../api/firebaseIndexedDbGuard';

import type { RemoteConfig, ValueSource } from 'firebase/remote-config';

import { getFirebaseApp } from '../api/firebase';

export const RC_KEY_GEMINI_MODEL_FALLBACKS = 'gemini_model_fallbacks';
export const RC_KEY_GEMINI_PASS1_MODEL_ID = 'gemini_pass1_model_id';
export const RC_KEY_GEMINI_PASS2_MODEL_ID = 'gemini_pass2_model_id';
export const RC_KEY_PASS3_PROMPT = 'prompt_pass3_synth_v1';
export const RC_KEY_INITIAL_FREE_QUOTA = 'initial_free_quota';

export const DEFAULT_GEMINI_PASS1_MODEL_ID = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_PASS2_MODEL_ID = 'gemini-1.5-flash';
export const DEFAULT_SENTINEL_INITIAL_FREE_QUOTA = 6;

export const PASS3_PROMPT_FALLBACK_TEMPLATE = `Tu es l'architecte de synthèse d'une application mobile de planning. Transforme ce JSON d'intentions en une feuille de route HTML épurée.

Focus du jour (phrase courte).

Itinéraire Newton (TRIPs groupés).

Coup de Boost (orphelines les plus anciennes via age_days).

Groupements thématiques (ADMIN, MAISON, SHOPPING ou autre).
Réponds strictement dans la langue des intentions. HTML inline uniquement.`;

const PROD_MIN_FETCH_INTERVAL_MS = 4 * 60 * 60 * 1000;

let remoteConfigInstance: RemoteConfig | null = null;
let fetchInFlight: Promise<boolean> | null = null;
let lastFetchSucceeded = false;
let lastFetchErrorMessage: string | null = null;

export type RemoteConfigEntry = {
  value: string | null;
  source: ValueSource | 'unavailable';
};

function buildDefaultConfig(): Record<string, string | number> {
  return {
    [RC_KEY_GEMINI_PASS1_MODEL_ID]: DEFAULT_GEMINI_PASS1_MODEL_ID,
    [RC_KEY_GEMINI_PASS2_MODEL_ID]: DEFAULT_GEMINI_PASS2_MODEL_ID,
    [RC_KEY_PASS3_PROMPT]: PASS3_PROMPT_FALLBACK_TEMPLATE,
    [RC_KEY_INITIAL_FREE_QUOTA]: DEFAULT_SENTINEL_INITIAL_FREE_QUOTA,
  };
}

async function ensureRemoteConfigInstance(): Promise<RemoteConfig | null> {
  const app = getFirebaseApp();
  if (!app) {
    if (__DEV__) {
      console.warn('[GEMINI-RC] Remote Config indisponible — getFirebaseApp() null (EXPO_PUBLIC_FIREBASE_* ?)');
    }
    return null;
  }

  const { getRemoteConfig } = await import('firebase/remote-config');
  if (!remoteConfigInstance) {
    remoteConfigInstance = getRemoteConfig(app);
    remoteConfigInstance.settings.minimumFetchIntervalMillis = __DEV__ ? 0 : PROD_MIN_FETCH_INTERVAL_MS;
    remoteConfigInstance.defaultConfig = buildDefaultConfig();
    if (__DEV__) {
      console.log(
        `[GEMINI-RC] Remote Config init — projectId=${app.options.projectId ?? '?'} fetchInterval=${remoteConfigInstance.settings.minimumFetchIntervalMillis}ms`,
      );
    }
  }
  return remoteConfigInstance;
}

/** @returns `true` si `fetchAndActivate` a réussi pour cet appel. */
export async function fetchAndActivateRemoteConfig(): Promise<boolean> {
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const rc = await ensureRemoteConfigInstance();
      if (!rc) {
        lastFetchSucceeded = false;
        lastFetchErrorMessage = 'firebase_app_unavailable';
        return false;
      }
      const { fetchAndActivate } = await import('firebase/remote-config');
      const activated = await fetchAndActivate(rc);
      lastFetchSucceeded = true;
      lastFetchErrorMessage = null;
      if (__DEV__) {
        console.log(`[GEMINI-RC] fetchAndActivate OK (activated=${activated})`);
      }
      return true;
    } catch (e) {
      lastFetchSucceeded = false;
      lastFetchErrorMessage = e instanceof Error ? e.message : String(e);
      if (__DEV__) {
        console.warn(`[GEMINI-RC] fetchAndActivate ÉCHEC : ${lastFetchErrorMessage}`);
      }
      return false;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

export function didLastRemoteConfigFetchSucceed(): boolean {
  return lastFetchSucceeded;
}

export function getLastRemoteConfigFetchError(): string | null {
  return lastFetchErrorMessage;
}

export async function getRemoteConfigEntry(key: string): Promise<RemoteConfigEntry> {
  const rc = await ensureRemoteConfigInstance();
  if (!rc) return { value: null, source: 'unavailable' };
  const { getValue } = await import('firebase/remote-config');
  const entry = getValue(rc, key);
  const raw = entry.asString().trim();
  return {
    value: raw.length > 0 ? raw : null,
    source: entry.getSource(),
  };
}

export async function getRemoteConfigStringValue(key: string): Promise<string | null> {
  const entry = await getRemoteConfigEntry(key);
  return entry.value;
}

export async function getRemoteConfigNumberValue(key: string, fallback: number): Promise<number> {
  const raw = await getRemoteConfigStringValue(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Prompt Pass 3 — RC `prompt_pass3_synth_v1` avec repli template compilé. */
export async function fetchPass3DailyRoadmapPromptTemplate(): Promise<string> {
  await fetchAndActivateRemoteConfig();
  const raw = await getRemoteConfigStringValue(RC_KEY_PASS3_PROMPT);
  return raw ?? PASS3_PROMPT_FALLBACK_TEMPLATE;
}

/** Quota Sentinel — RC `initial_free_quota`. */
export async function fetchInitialSentinelFreeQuota(): Promise<number> {
  await fetchAndActivateRemoteConfig();
  const n = await getRemoteConfigNumberValue(RC_KEY_INITIAL_FREE_QUOTA, DEFAULT_SENTINEL_INITIAL_FREE_QUOTA);
  return Math.max(0, Math.floor(n));
}
