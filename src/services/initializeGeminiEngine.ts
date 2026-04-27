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
  isShortGeminiAliasModelId,
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
      contents: [{ parts: [{ text: 'Bonjour' }] }],
    }),
  });
  return { ok: res.ok, status: res.status };
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

    for (const id of allIds) {
      const meta = metaById.get(id);
      const outLim = meta?.outLim ?? 0;
      const inLim = meta?.inLim ?? 0;
      const supported = !isBannedGeminiModelId(id) && !isBannedGeminiModelIdForOneTap(id);
      console.log(`[RECRUTEMENT-AI] 📋 ${id} | In:${inLim || '?'} Out:${outLim || '?'} | Supported:${supported ? 'YES' : 'NO'}`);
    }

    const okForOneTap = (id: string) =>
      !isBannedGeminiModelId(id) && !isBannedGeminiModelIdForOneTap(id) && !isShortGeminiAliasModelId(id);
    const isFlashLatest = (id: string) => /^gemini-flash-latest$/i.test(id);
    const isProLatest = (id: string) => /^gemini-pro-latest$/i.test(id);
    const isFlash = (id: string) => /\bflash\b/i.test(id);
    const isPro = (id: string) => /\bpro\b/i.test(id);
    const isLatest = (id: string) => /-latest$/i.test(id);
    const ordered = allIds
      .filter((id) => okForOneTap(id) && (isFlashLatest(id) || isProLatest(id) || isFlash(id) || isPro(id)))
      .sort((a, b) => {
        const pa = isFlashLatest(a) ? 0 : isProLatest(a) ? 1 : isLatest(a) ? 2 : isFlash(a) ? 3 : 4;
        const pb = isFlashLatest(b) ? 0 : isProLatest(b) ? 1 : isLatest(b) ? 2 : isFlash(b) ? 3 : 4;
        if (pa !== pb) return pa - pb;
        const oa = metaById.get(a)?.outLim ?? 0;
        const ob = metaById.get(b)?.outLim ?? 0;
        if (oa !== ob) return ob - oa;
        return a.localeCompare(b);
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
