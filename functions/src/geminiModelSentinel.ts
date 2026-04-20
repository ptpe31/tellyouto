/**
 * Sentinelle : listModels → meilleur modèle flash stable → Remote Config `active_gemini_model`.
 * Cron quotidien (4h Europe/Paris) — voir `index.ts`.
 */

import * as admin from 'firebase-admin';

/** Aligné sur `src/services/geminiRemoteModelSteering.ts`. */
const REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL = 'active_gemini_model';

type GeminiListedModel = {
  name: string;
  supportedGenerationMethods?: string[];
};

const PREFERRED_MODEL_IDS = ['gemini-1.5-flash-8b-latest', 'gemini-1.5-flash-latest'] as const;

function shortGeminiModelId(fullName: string): string {
  return String(fullName || '').trim().replace(/^models\//, '');
}

function pickPreferredGeminiModelId(models: GeminiListedModel[]): string | null {
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
  template.parameters[REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL] = {
    ...existing,
    defaultValue: { value: chosen },
    valueType: 'STRING',
    description:
      existing?.description ??
      'Modèle Gemini actif (mis à jour automatiquement par geminiModelSentinel).',
  };

  await rc.publishTemplate(template);
  console.log(
    `[geminiModelSentinel] published ${REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL}=${chosen} (from ${models.length} listed)`,
  );
  return { chosenModelId: chosen, listCount: models.length };
}
