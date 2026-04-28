import { ensureFirebaseAnonymousAuth, getFirebaseAuth } from '../api/firebase';
import { getGeminiProxyStreamUrl } from '../config/cloudFunctions';
import { getGeminiCandidateModelIds } from './geminiRemoteModelSteering';

export type GeminiHealthCheckResult = {
  winnerId: string;
  testedCount: number;
  skippedCount: number;
  candidateCount: number;
};

/**
 * Probe légère sur une shortlist de modèles pour trouver un gagnant (écran Debug).
 */
export async function runGeminiModelHealthCheck(): Promise<GeminiHealthCheckResult> {
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('geminiModelHealthCheck: missing id token');

  const ordered = getGeminiCandidateModelIds();
  const MAX_PROBES = 16;
  const skippedCount = Math.max(0, ordered.length - MAX_PROBES);
  const toProbe = ordered.slice(0, MAX_PROBES);
  let testedCount = 0;

  for (const id of toProbe) {
    testedCount += 1;
    const res = await fetch(getGeminiProxyStreamUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        modelId: id,
        request: {
          contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
          generationConfig: { temperature: 0, topP: 0.1, topK: 1, candidateCount: 1, maxOutputTokens: 16 },
        },
      }),
    });
    if (res.ok) {
      return {
        winnerId: id,
        testedCount,
        skippedCount,
        candidateCount: ordered.length,
      };
    }
  }
  throw new Error(`geminiModelHealthCheck: no model OK among ${testedCount} probes`);
}
