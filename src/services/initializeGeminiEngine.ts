import {
  clearGeminiValidatedModelCache,
  ensureGeminiRemoteModelInitialized,
  excludeGeminiModelForSession,
  getActiveGeminiModelId,
  getGeminiCandidateModelIds,
  persistValidatedGeminiModelId,
  setGeminiActiveModelForSession,
} from './geminiRemoteModelSteering';
import { GEMINI_MODEL_SHORTLIST, isBannedGeminiModelId } from './geminiModelCatalog';
import { getGeminiApiKey } from './geminiSemanticLab';

const BASE_V1 = 'https://generativelanguage.googleapis.com/v1';
const BASE_V1BETA = 'https://generativelanguage.googleapis.com/v1beta';

async function pingGenerateContent(modelId: string, apiKey: string): Promise<{ ok: boolean; status: number }> {
  const base = /-latest$/i.test(modelId) ? BASE_V1BETA : BASE_V1;
  const url = `${base}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
        maxOutputTokens: 64,
      },
    }),
  });
  return { ok: res.ok, status: res.status };
}

export async function initializeGeminiEngine(): Promise<void> {
  await ensureGeminiRemoteModelInitialized();

  const active = getActiveGeminiModelId();
  if (active && (isBannedGeminiModelId(active) || !GEMINI_MODEL_SHORTLIST.includes(active as (typeof GEMINI_MODEL_SHORTLIST)[number]))) {
    await clearGeminiValidatedModelCache();
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.log(`[GEMINI-BOOT] 🤖 Modèle validé pour cette session : ${getActiveGeminiModelId()}`);
    return;
  }

  const raw = getGeminiCandidateModelIds();
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (!id || seen.has(id)) continue;
    if (isBannedGeminiModelId(id)) continue;
    seen.add(id);
    candidates.push(id);
  }

  const bannedForSession = new Set<string>();
  let usedTempFallback = false;
  for (const id of candidates) {
    if (bannedForSession.has(id)) continue;
    const probe = await pingGenerateContent(id, apiKey);
    if (probe.ok) {
      if (usedTempFallback) {
        setGeminiActiveModelForSession(id);
      } else {
        await persistValidatedGeminiModelId(id);
      }
      console.log(`[GEMINI-BOOT] 🤖 Modèle validé pour cette session : ${id}`);
      return;
    }
    if (probe.status === 503) {
      usedTempFallback = true;
      excludeGeminiModelForSession(id);
      continue;
    }
    bannedForSession.add(id);
    if (id === active) {
      await clearGeminiValidatedModelCache();
    }
  }

  console.log(`[GEMINI-BOOT] 🤖 Modèle validé pour cette session : ${getActiveGeminiModelId()}`);
}
