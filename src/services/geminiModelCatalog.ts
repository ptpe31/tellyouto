/**
 * Catalogue Gemini (listModels) + sélection « zero-maintenance »
 * (priorité flash 8b / flash latest, puis heuristiques stables).
 */

export type GeminiListedModel = {
  name: string;
  supportedGenerationMethods?: string[];
};

const PREFERRED_MODEL_IDS = ['gemini-1.5-flash-8b-latest', 'gemini-1.5-flash-latest'] as const;

export function shortGeminiModelId(fullName: string): string {
  return String(fullName || '').trim().replace(/^models\//, '');
}

/**
 * Choisit un id de modèle REST (`:generateContent`) parmi ceux listés par l’API.
 */
export function pickPreferredGeminiModelId(models: GeminiListedModel[]): string | null {
  const withGen = models.filter((m) =>
    (m.supportedGenerationMethods ?? []).includes('generateContent'),
  );
  if (withGen.length === 0) return null;
  const ids = new Set(withGen.map((m) => shortGeminiModelId(m.name)));
  for (const p of PREFERRED_MODEL_IDS) {
    if (ids.has(p)) return p;
  }
  const idList = [...ids];
  const flashLatest = idList
    .filter((id) => /flash/i.test(id) && /-latest$/i.test(id))
    .sort();
  if (flashLatest.length > 0) return flashLatest[flashLatest.length - 1];
  const anyFlash = idList.find((id) => /flash/i.test(id));
  if (anyFlash) return anyFlash;
  return shortGeminiModelId(withGen[0].name);
}

/**
 * Liste paginée tous les modèles v1beta visibles pour la clé.
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
