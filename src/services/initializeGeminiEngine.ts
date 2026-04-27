import {
  clearGeminiValidatedModelCache,
  ensureGeminiRemoteModelInitialized,
  getActiveGeminiModelId,
  getGeminiCandidateModelIds,
  persistValidatedGeminiModelId,
} from './geminiRemoteModelSteering';
import { isBannedGeminiModelId } from './geminiModelCatalog';
import { getGeminiApiKey } from './geminiSemanticLab';

const BASE = 'https://generativelanguage.googleapis.com/v1';

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

export async function initializeGeminiEngine(): Promise<void> {
  await ensureGeminiRemoteModelInitialized();

  const active = getActiveGeminiModelId();
  if (active && isBannedGeminiModelId(active)) {
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
  for (const id of candidates) {
    if (bannedForSession.has(id)) continue;
    const ok = await pingGenerateContent(id, apiKey);
    if (ok) {
      await persistValidatedGeminiModelId(id);
      console.log(`[GEMINI-BOOT] 🤖 Modèle validé pour cette session : ${id}`);
      return;
    }
    bannedForSession.add(id);
    if (id === active) {
      await clearGeminiValidatedModelCache();
    }
  }

  console.log(`[GEMINI-BOOT] 🤖 Modèle validé pour cette session : ${getActiveGeminiModelId()}`);
}

