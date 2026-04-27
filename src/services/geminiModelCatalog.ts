/**
 * Catalogue Gemini (listModels) + sélection « zero-maintenance ».
 *
 * Critères (Sentinelle & self-heal alignés) :
 * - ID contient **flash** (insensible à la casse).
 * - Bonus **8b** ou **lite** (mot entier) si présent dans l’ID.
 * - **Récence** : champ API `version` si numérique, suffixe **-latest**, semver `gemini-X.Y` dans l’ID, suffixe **-00N**.
 */

export type GeminiListedModel = {
  name: string;
  supportedGenerationMethods?: string[];
  /** Champ API listModels (ex. "2.0", "001") — utilisé pour le tri récence. */
  version?: string;
  baseModelId?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

export const GEMINI_MODEL_SHORTLIST = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash-exp',
] as const;

export const BANNED_MODELS_FOR_ONETAP = ['gemini-2.5-flash', 'gemini-2.0-flash'] as const;

export function isBannedGeminiModelIdForOneTap(id: string): boolean {
  const clean = String(id || '').trim();
  for (const base of BANNED_MODELS_FOR_ONETAP) {
    if (clean === base) return true;
    if (clean.startsWith(`${base}-`)) return true;
    if (clean.startsWith(`${base}:`)) return true;
  }
  return false;
}

export function shortGeminiModelId(fullName: string): string {
  return String(fullName || '').trim().replace(/^models\//, '');
}

function isFlashModelId(id: string): boolean {
  return /flash/i.test(id);
}

export function isBannedGeminiModelId(id: string): boolean {
  if (/\blite\b/i.test(id)) return true;
  return /-(\d{3})(?:\b|$)/.test(id);
}

function isLatestModelId(id: string): boolean {
  return /-latest$/i.test(id);
}

/** Parse un nombre depuis le champ `version` de l’API (ex. "2.0", "001"). */
function parseApiVersionRank(version: string | undefined): number {
  if (!version) return 0;
  const t = version.trim();
  if (!t) return 0;
  const n = Number.parseFloat(t.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Extrait gemini-M.m depuis l’ID (ex. gemini-2.0-flash → [2,0]). */
function parseSemverFromGeminiId(id: string): [number, number] | null {
  const m = id.match(/gemini-(\d+)\.(\d+)/i);
  if (!m) return null;
  const major = Number.parseInt(m[1], 10);
  const minor = Number.parseInt(m[2], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return [major, minor];
}

/** Suffixe type -001, -002 en fin de segment. */
function parseTrailingNumericSuffix(id: string): number {
  const m = id.match(/-(\d{3})(?:\b|[-_]|$)/);
  if (!m) return 0;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ordre décroissant : plus « récent » / prioritaire en premier.
 * Utilisé pour les IDs **flash** uniquement (prérequis appelant).
 */
export function compareFlashGeminiModelIds(aId: string, bId: string): number {
  const ba = isBannedGeminiModelId(aId) ? 1 : 0;
  const bb = isBannedGeminiModelId(bId) ? 1 : 0;
  if (ba !== bb) return ba - bb;

  const latestA = isLatestModelId(aId) ? 1 : 0;
  const latestB = isLatestModelId(bId) ? 1 : 0;
  if (latestA !== latestB) return latestB - latestA;

  const sa = parseSemverFromGeminiId(aId);
  const sb = parseSemverFromGeminiId(bId);
  if (sa && sb) {
    if (sa[0] !== sb[0]) return sb[0] - sa[0];
    if (sa[1] !== sb[1]) return sb[1] - sa[1];
  } else if (sa && !sb) return -1;
  else if (!sa && sb) return 1;

  const ta = parseTrailingNumericSuffix(aId);
  const tb = parseTrailingNumericSuffix(bId);
  if (ta !== tb) return tb - ta;

  return bId.localeCompare(aId);
}

function compareFlashGeminiModels(a: GeminiListedModel, b: GeminiListedModel): number {
  const idA = shortGeminiModelId(a.name);
  const idB = shortGeminiModelId(b.name);

  const ba = isBannedGeminiModelId(idA) ? 1 : 0;
  const bb = isBannedGeminiModelId(idB) ? 1 : 0;
  if (ba !== bb) return ba - bb;

  const vRank = parseApiVersionRank(b.version) - parseApiVersionRank(a.version);
  if (vRank !== 0) return vRank;

  const latestA = isLatestModelId(idA) ? 1 : 0;
  const latestB = isLatestModelId(idB) ? 1 : 0;
  if (latestA !== latestB) return latestB - latestA;

  const sa = parseSemverFromGeminiId(idA);
  const sb = parseSemverFromGeminiId(idB);
  if (sa && sb) {
    if (sa[0] !== sb[0]) return sb[0] - sa[0];
    if (sa[1] !== sb[1]) return sb[1] - sa[1];
  } else if (sa && !sb) return -1;
  else if (!sa && sb) return 1;

  const ta = parseTrailingNumericSuffix(idA);
  const tb = parseTrailingNumericSuffix(idB);
  if (ta !== tb) return tb - ta;

  return idB.localeCompare(idA);
}

/**
 * Choisit un id de modèle REST (`:generateContent`) parmi ceux listés par l’API.
 * Filtre **flash** ; sinon repli sur le premier `generateContent`.
 */
export function pickPreferredGeminiModelId(models: GeminiListedModel[]): string | null {
  const withGen = models.filter((m) =>
    (m.supportedGenerationMethods ?? []).includes('generateContent'),
  );
  if (withGen.length === 0) return null;

  const nonBanned = withGen.filter((m) => !isBannedGeminiModelId(shortGeminiModelId(m.name)));
  const usable = nonBanned.length ? nonBanned : withGen;
  const flashOnly = usable.filter((m) => isFlashModelId(shortGeminiModelId(m.name)));
  const pool = flashOnly.length > 0 ? flashOnly : usable;
  const sorted = [...pool].sort(compareFlashGeminiModels);
  return shortGeminiModelId(sorted[0].name);
}

/**
 * Ordre de probe santé : flash triés (8b/lite + récence), puis autres ids triés localement.
 */
export function orderGeminiModelIdsForHealthProbe(ids: string[]): string[] {
  const set = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const uniq = [...set];
  const flash = uniq.filter((id) => isFlashModelId(id)).sort(compareFlashGeminiModelIds);
  const nonFlash = uniq.filter((id) => !isFlashModelId(id)).sort((a, b) => a.localeCompare(b));
  return [...flash, ...nonFlash];
}

/**
 * Liste paginée tous les modèles v1 visibles pour la clé.
 */
export async function fetchAllGeminiModelsList(apiKey: string): Promise<GeminiListedModel[]> {
  const key = apiKey.trim();
  if (!key) throw new Error('geminiModelCatalog: empty API key');
  const out: GeminiListedModel[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    u.searchParams.set('key', key);
    u.searchParams.set('pageSize', '100');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const res = await fetch(u.toString());
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`listModels HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = JSON.parse(text) as {
      models?: GeminiListedModel[];
      nextPageToken?: string;
    };
    out.push(...(data.models ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}
