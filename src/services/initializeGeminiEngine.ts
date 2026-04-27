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
  isBannedGeminiModelIdForOneTap,
  GEMINI_MODEL_SHORTLIST,
  isBannedGeminiModelId,
  shortGeminiModelId,
} from './geminiModelCatalog';
import { getGeminiApiKey } from './geminiSemanticLab';

const BASE_V1 = 'https://generativelanguage.googleapis.com/v1';
const BASE_V1BETA = 'https://generativelanguage.googleapis.com/v1beta';

async function pingGenerateContent(modelId: string, apiKey: string): Promise<{ ok: boolean; status: number }> {
  const base = BASE_V1BETA;
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
  const metaById = new Map<string, { inLim: number; outLim: number }>();
  try {
    const listed = await fetchAllGeminiModelsList(apiKey);
    const withGen = listed.filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'));
    const toNumber = (n: unknown) => {
      const v = Number(n ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    const allIds = [...new Set(withGen.map((m) => shortGeminiModelId(m.name)))];
    const oneTapMinOut = 800;
    for (const m of withGen) {
      const id = shortGeminiModelId(m.name);
      metaById.set(id, { inLim: toNumber(m.inputTokenLimit), outLim: toNumber(m.outputTokenLimit) });
    }

    const okOneTapFamily = (id: string) => !isBannedGeminiModelId(id) && !isBannedGeminiModelIdForOneTap(id) && /^gemini-1\.5-/i.test(id);
    const isFlash15 = (id: string) => /^gemini-1\.5-flash/i.test(id);
    const isPro15 = (id: string) => /^gemini-1\.5-pro/i.test(id);
    const isLatest = (id: string) => /-latest$/i.test(id);

    for (const id of allIds) {
      if (!okOneTapFamily(id)) continue;
      const meta = metaById.get(id);
      const outLim = meta?.outLim ?? 0;
      const inLim = meta?.inLim ?? 0;
      const desired = isFlash15(id) || isPro15(id);
      const qualified = outLim > 0 ? outLim >= oneTapMinOut : true;
      console.log(
        `[RECRUTEMENT-AI] 📋 ${id} | In:${inLim || '?'} Out:${outLim || '?'} | Desired:${desired ? 'YES' : 'NO'} | ${qualified ? 'QUALIFIÉ' : 'NON_QUALIFIÉ'}`,
      );
    }

    const ordered = allIds
      .filter((id) => okOneTapFamily(id) && (isFlash15(id) || isPro15(id)))
      .sort((a, b) => {
        const fa = isFlash15(a) ? 0 : 1;
        const fb = isFlash15(b) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const la = isLatest(a) ? 0 : 1;
        const lb = isLatest(b) ? 0 : 1;
        if (la !== lb) return la - lb;
        const oa = metaById.get(a)?.outLim ?? 0;
        const ob = metaById.get(b)?.outLim ?? 0;
        if (oa !== ob) return ob - oa;
        return b.localeCompare(a);
      });

    for (const id of ordered) {
      const outLim = metaById.get(id)?.outLim ?? 0;
      if (outLim > 0 && outLim < oneTapMinOut) continue;
      const probe = await pingGenerateContent(id, apiKey);
      if (probe.ok) {
        candidates = [id];
        break;
      }
    }
  } catch {
    candidates = [];
  }

  if (!candidates.length) {
    candidates = GEMINI_MODEL_SHORTLIST.filter((id) => !isBannedGeminiModelId(id));
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
      setGeminiActiveModelForSession(id);
      const outLim = metaById.get(id)?.outLim ?? 0;
      console.log(
        `[RECRUTEMENT-AI] ✅ Candidat retenu : ${id} (Output limit: ${Number.isFinite(outLim) && outLim > 0 ? outLim : '?'})`,
      );
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
