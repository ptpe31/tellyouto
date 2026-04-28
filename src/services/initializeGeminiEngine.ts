import {
  clearGeminiValidatedModelCache,
  ensureGeminiRemoteModelInitialized,
  getActiveGeminiModelId,
  setGeminiSessionCandidateModelIds,
} from './geminiRemoteModelSteering';
import {
  GEMINI_MODEL_SHORTLIST,
  isBannedGeminiModelId,
} from './geminiModelCatalog';

export async function initializeGeminiEngine(): Promise<void> {
  await ensureGeminiRemoteModelInitialized();

  const active = getActiveGeminiModelId();
  if (active && isBannedGeminiModelId(active)) {
    await clearGeminiValidatedModelCache();
  }

  setGeminiSessionCandidateModelIds(
    GEMINI_MODEL_SHORTLIST.filter((id) => !isBannedGeminiModelId(id)),
  );
  console.log(`[GEMINI-BOOT] 🤖 Modèle validé pour cette session : ${getActiveGeminiModelId()}`);
}
