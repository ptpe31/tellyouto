/**
 * Sentinelle : listModels → meilleur modèle flash stable → Remote Config `active_gemini_model`.
 * Cron quotidien (4h Europe/Paris) — voir `index.ts`.
 *
 * **SYNC** : la logique `pickPreferredGeminiModelId` / tri flash doit rester alignée avec
 * `src/services/geminiModelCatalog.ts` (même heuristique : flash, 8b|lite, récence API + ID).
 */

import * as admin from 'firebase-admin';

/** Aligné sur `src/services/geminiRemoteModelSteering.ts`. */
const REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL = 'active_gemini_model';

type GeminiListedModel = {
  name: string;
  supportedGenerationMethods?: string[];
  version?: string;
  baseModelId?: string;
};

function shortGeminiModelId(fullName: string): string {
  return String(fullName || '').trim().replace(/^models\//, '');
}

function isFlashModelId(id: string): boolean {
  return /flash/i.test(id);
}

function is8bOrLiteModelId(id: string): boolean {
  return /\b8b\b/i.test(id) || /\blite\b/i.test(id);
}

function isLatestModelId(id: string): boolean {
  return /-latest$/i.test(id);
}

function parseApiVersionRank(version: string | undefined): number {
  if (!version) return 0;
  const t = version.trim();
  if (!t) return 0;
  const n = Number.parseFloat(t.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseSemverFromGeminiId(id: string): [number, number] | null {
  const m = id.match(/gemini-(\d+)\.(\d+)/i);
  if (!m) return null;
  const major = Number.parseInt(m[1], 10);
  const minor = Number.parseInt(m[2], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return [major, minor];
}

function parseTrailingNumericSuffix(id: string): number {
  const m = id.match(/-(\d{3})(?:\b|[-_]|$)/);
  if (!m) return 0;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

function compareFlashGeminiModels(a: GeminiListedModel, b: GeminiListedModel): number {
  const idA = shortGeminiModelId(a.name);
  const idB = shortGeminiModelId(b.name);

  const la = is8bOrLiteModelId(idA) ? 1 : 0;
  const lb = is8bOrLiteModelId(idB) ? 1 : 0;
  if (la !== lb) return lb - la;

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

function pickPreferredGeminiModelId(models: GeminiListedModel[]): string | null {
  const withGen = models.filter((m) =>
    (m.supportedGenerationMethods ?? []).includes('generateContent'),
  );
  if (withGen.length === 0) return null;

  const flashOnly = withGen.filter((m) => isFlashModelId(shortGeminiModelId(m.name)));
  const pool = flashOnly.length > 0 ? flashOnly : withGen;
  const sorted = [...pool].sort(compareFlashGeminiModels);
  return shortGeminiModelId(sorted[0].name);
}

async function fetchAllGeminiModelsList(apiKey: string): Promise<GeminiListedModel[]> {
  const key = apiKey.trim();
  if (!key) throw new Error('geminiModelSentinel: empty GEMINI_API_KEY');
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

export async function runGeminiModelSentinel(apiKey: string): Promise<{
  chosenModelId: string;
  listCount: number;
}> {
  const models = await fetchAllGeminiModelsList(apiKey);
  const chosen = pickPreferredGeminiModelId(models);
  if (!chosen) {
    throw new Error('geminiModelSentinel: no model supports generateContent');
  }

  const rc = admin.remoteConfig();
  const template = await rc.getTemplate();
  template.parameters = template.parameters ?? {};
  const existing = template.parameters[REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL];
  const previousDefault = existing?.defaultValue;
  const ancienModele =
    previousDefault && typeof previousDefault === 'object' && 'value' in previousDefault
      ? String((previousDefault as { value: string }).value ?? '').trim()
      : '';
  template.parameters[REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL] = {
    ...existing,
    defaultValue: { value: chosen },
    valueType: 'STRING',
    description:
      existing?.description ??
      'Modèle Gemini actif (mis à jour automatiquement par geminiModelSentinel).',
  };

  await rc.publishTemplate(template);
  const nouveauModele = chosen;
  const transitionLabel = `${ancienModele || '(aucun)'} -> ${nouveauModele}`;
  console.log(
    JSON.stringify({
      source: 'geminiModelSentinel',
      event: 'RC_MODEL_TRANSITION',
      ANCIEN_MODELE: ancienModele || null,
      NOUVEAU_MODELE: nouveauModele,
      transition: transitionLabel,
      rc_key: REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL,
      did_change: ancienModele !== nouveauModele,
      list_models_count: models.length,
    }),
  );
  return { chosenModelId: chosen, listCount: models.length };
}
