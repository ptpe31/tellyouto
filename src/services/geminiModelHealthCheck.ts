import {
  getActivePass1ModelId,
  getGeminiCandidateModelIds,
} from './geminiRemoteModelSteering';
import { executeGeminiCall } from './geminiDirectClient';

export type GeminiHealthCheckResult = {
  pass1Id: string;
  pass1Ok: boolean;
  pass2WinnerId: string;
  pass2TestedCount: number;
  pass2SkippedCount: number;
  pass2CandidateCount: number;
};

async function probeModel(modelId: string): Promise<boolean> {
  const res = await executeGeminiCall({
    modelId,
    request: {
      contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
      generationConfig: {
        temperature: 0,
        topP: 0.1,
        topK: 1,
        candidateCount: 1,
        maxOutputTokens: 16,
      },
    },
    stream: false,
  });
  return res.ok;
}

/**
 * Sonde Pass 1 (extraction) puis chaîne Pass 2 (raisonnement) — écran Debug.
 */
export async function runGeminiModelHealthCheck(): Promise<GeminiHealthCheckResult> {
  const pass1Id = getActivePass1ModelId();
  const pass1Ok = await probeModel(pass1Id);

  const ordered = getGeminiCandidateModelIds();
  const MAX_PROBES = 16;
  const pass2SkippedCount = Math.max(0, ordered.length - MAX_PROBES);
  const toProbe = ordered.slice(0, MAX_PROBES);
  let pass2TestedCount = 0;

  for (const id of toProbe) {
    pass2TestedCount += 1;
    if (await probeModel(id)) {
      return {
        pass1Id,
        pass1Ok,
        pass2WinnerId: id,
        pass2TestedCount,
        pass2SkippedCount,
        pass2CandidateCount: ordered.length,
      };
    }
  }

  throw new Error(
    `geminiModelHealthCheck: Pass1=${pass1Ok ? 'OK' : 'KO'} ; Pass2: no model OK among ${pass2TestedCount} probes`,
  );
}
