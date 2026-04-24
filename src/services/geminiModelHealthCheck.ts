/**
 * Probe légère `:generateContent` sur une shortlist de modèles pour trouver un gagnant (écran Debug).
 */

import {
  fetchAllGeminiModelsList,
  orderGeminiModelIdsForHealthProbe,
  pickPreferredGeminiModelId,
  shortGeminiModelId,
  type GeminiListedModel,
} from './geminiModelCatalog';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_PROBES = 32;

async function pingGenerateContent(modelId: string, apiKey: string): Promise<boolean> {
  const url = `${BASE}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
      generationConfig: {
        temperature: 0,
        topP: 0.1,
        topK: 1,
        candidateCount: 1,
        maxOutputTokens: 8,
      },
    }),
  });
  return res.ok;
}

export type GeminiHealthCheckResult = {
  winnerId: string;
  testedCount: number;
  skippedCount: number;
  candidateCount: number;
};

/**
 * Liste les modèles `generateContent`, les teste dans l’ordre préféré jusqu’au premier HTTP 200.
 */
export async function runGeminiModelHealthCheck(apiKey: string): Promise<GeminiHealthCheckResult> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error('geminiModelHealthCheck: empty API key');
  }
  const listed: GeminiListedModel[] = await fetchAllGeminiModelsList(key);
  const withGen = listed.filter((m) =>
    (m.supportedGenerationMethods ?? []).includes('generateContent'),
  );
  if (withGen.length === 0) {
    throw new Error('geminiModelHealthCheck: no generateContent model in list');
  }
  const preferred = pickPreferredGeminiModelId(listed);
  const allIds = [...new Set(withGen.map((m) => shortGeminiModelId(m.name)))];
  let ordered = orderGeminiModelIdsForHealthProbe(allIds);
  if (preferred && ordered.includes(preferred)) {
    ordered = [preferred, ...ordered.filter((id) => id !== preferred)];
  }
  const skippedCount = Math.max(0, ordered.length - MAX_PROBES);
  const toProbe = ordered.slice(0, MAX_PROBES);
  let testedCount = 0;
  for (const id of toProbe) {
    testedCount += 1;
    const ok = await pingGenerateContent(id, key);
    if (ok) {
      return {
        winnerId: id,
        testedCount,
        skippedCount,
        candidateCount: ordered.length,
      };
    }
  }
  throw new Error(`geminiModelHealthCheck: no model OK among ${testedCount} probes`);
}
