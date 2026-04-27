import {
  clearGeminiValidatedModelCache,
  ensureGeminiRemoteModelInitialized,
  excludeGeminiModelForSession,
  getActiveGeminiModelId,
  persistValidatedGeminiModelId,
  setGeminiSessionCandidateModelIds,
  setGeminiActiveModelForSession,
} from './geminiRemoteModelSteering';
import {
  fetchAllGeminiModelsList,
  GEMINI_MODEL_SHORTLIST,
  isBannedGeminiModelId,
  shortGeminiModelId,
} from './geminiModelCatalog';
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

  let candidates: string[] = [];
  try {
    const listed = await fetchAllGeminiModelsList(apiKey);
    const withGen = listed.filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'));
    const allIds = [...new Set(withGen.map((m) => shortGeminiModelId(m.name)))];
    const desiredPrefixes = [...new Set(GEMINI_MODEL_SHORTLIST.map((id) => id.replace(/-latest$/i, '')))];
    const matchesDesired = (id: string) => desiredPrefixes.some((p) => id === p || id.startsWith(`${p}-`));
    candidates = allIds.filter((id) => !isBannedGeminiModelId(id) && matchesDesired(id));
    const rank = (id: string) => {
      const pref = desiredPrefixes.findIndex((p) => id === p || id.startsWith(`${p}-`));
      const familyBonus = /flash/i.test(id) ? 0 : /pro/i.test(id) ? 1 : 2;
      const latestBonus = /-latest$/i.test(id) ? 0 : 1;
      return pref < 0 ? 999 : pref * 10 + familyBonus * 2 + latestBonus;
    };
    candidates.sort((a, b) => rank(a) - rank(b));
  } catch {
    candidates = [];
  }

  if (!candidates.length) {
    const fallback = GEMINI_MODEL_SHORTLIST.filter((id) => !isBannedGeminiModelId(id));
    candidates = fallback;
  }

  setGeminiSessionCandidateModelIds(candidates);

  const bannedForSession = new Set<string>();
  let usedTempFallback = false;
  const activeNow = getActiveGeminiModelId();
  const ordered = activeNow && candidates.includes(activeNow) ? [activeNow, ...candidates.filter((m) => m !== activeNow)] : candidates;
  for (const id of ordered) {
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
