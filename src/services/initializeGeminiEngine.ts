import {
  ensureGeminiRemoteModelInitialized,
  getActivePass1ModelId,
  getActivePass2ModelId,
  hasRemoteConfigFallbackModelsLoaded,
  setGeminiSessionCandidateModelIds,
} from './geminiRemoteModelSteering';
import { GEMINI_MODEL_SHORTLIST, isBannedGeminiModelId } from './geminiModelCatalog';

export async function initializeGeminiEngine(): Promise<void> {
  await ensureGeminiRemoteModelInitialized();

  if (!hasRemoteConfigFallbackModelsLoaded()) {
    const active = getActivePass2ModelId();
    const shortlist = GEMINI_MODEL_SHORTLIST.filter((id) => !isBannedGeminiModelId(id));
    setGeminiSessionCandidateModelIds([active, ...shortlist.filter((id) => id !== active)]);
  }

  console.log(
    `[GEMINI-BOOT] 🤖 Pass1 (extraction): ${getActivePass1ModelId()} | Pass2 (raisonnement): ${getActivePass2ModelId()}`,
  );
}
