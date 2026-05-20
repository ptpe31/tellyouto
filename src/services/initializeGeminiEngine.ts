import {
  ensureGeminiRemoteModelInitialized,
  getActiveGeminiModelId,
  hasRemoteConfigFallbackModelsLoaded,
  setGeminiSessionCandidateModelIds,
} from './geminiRemoteModelSteering';
import { GEMINI_MODEL_SHORTLIST, isBannedGeminiModelId } from './geminiModelCatalog';

export async function initializeGeminiEngine(): Promise<void> {
  await ensureGeminiRemoteModelInitialized();

  if (!hasRemoteConfigFallbackModelsLoaded()) {
    const active = getActiveGeminiModelId();
    const shortlist = GEMINI_MODEL_SHORTLIST.filter((id) => !isBannedGeminiModelId(id));
    setGeminiSessionCandidateModelIds([active, ...shortlist.filter((id) => id !== active)]);
  }

  console.log(`[GEMINI-BOOT] 🤖 Modèle validé pour cette session : ${getActiveGeminiModelId()}`);
}
