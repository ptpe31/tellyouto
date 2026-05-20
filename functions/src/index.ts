import { GoogleGenerativeAI, type GenerateContentRequest } from '@google/generative-ai';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';

admin.initializeApp();

/** Clé Gemini : Secret Manager uniquement, jamais exposée au client (`secrets` + `.value()` ci-dessous). */
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

type GeminiProxyBody = {
  modelId?: string;
  /** Instructions système (Pass 1 / Pass 2) — même chaîne que côté app ; passées au modèle sans concaténation côté proxy. */
  systemInstruction?: string;
  /** Corps Gemini tel quel (`contents`, `generationConfig`, etc.) — pas de surcouche texte ajoutée par le proxy. */
  request?: Record<string, unknown>;
  /** Utilisé uniquement si `request` est absent (fallback legacy `prompt`). */
  generationConfig?: Record<string, unknown>;
  prompt?: string;
};

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

async function verifyFirebaseIdToken(authorization: string | undefined): Promise<void> {
  const token = extractBearerToken(authorization);
  if (!token) {
    throw new Error('missing_authorization');
  }
  await admin.auth().verifyIdToken(token);
}

/** Chaîne SI non vide pour `getGenerativeModel` ; sinon `undefined` (évite un bloc système vide). */
function normalizeSystemInstruction(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Reconstruit la requête Gemini : priorité absolue à `body.request` (transmission fidèle, latence minimale).
 * Aucun texte utilisateur n’est injecté par le proxy lorsque `request` est fourni.
 */
function coerceRequest(body: GeminiProxyBody): GenerateContentRequest {
  if (body.request && typeof body.request === 'object') {
    return body.request as unknown as GenerateContentRequest;
  }
  const prompt = String(body.prompt || '');
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: body.generationConfig ?? undefined,
  };
}

export const geminiProxyStream = onRequest(
  {
    region: 'europe-west9',
    minInstances: 1,
    maxInstances: 50,
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [GEMINI_API_KEY],
    cors: true,
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }

    try {
      await verifyFirebaseIdToken(req.header('authorization'));
    } catch {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const body = (req.body || {}) as GeminiProxyBody;
    const modelId = String(body.modelId || 'gemini-3.1-flash-lite');
    const request = coerceRequest(body);
    const systemInstruction = normalizeSystemInstruction(body.systemInstruction);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
    const model = genAI.getGenerativeModel({
      model: modelId,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const startedAt = Date.now();

    try {
      const result = await model.generateContentStream(request);

      for await (const chunk of result.stream as AsyncIterable<{ text: () => string }>) {
        const delta = chunk.text();
        if (!delta) continue;
        res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
      }

      const finalResponse = await result.response;
      const finalText = finalResponse.text();
      const rawUsage =
        finalResponse && typeof (finalResponse as { usageMetadata?: unknown }).usageMetadata === 'object'
          ? ((finalResponse as { usageMetadata: unknown }).usageMetadata as Record<string, unknown>)
          : null;
      const promptTokenCount =
        rawUsage && typeof rawUsage.promptTokenCount === 'number'
          ? rawUsage.promptTokenCount
          : rawUsage && typeof rawUsage.prompt_token_count === 'number'
            ? rawUsage.prompt_token_count
            : undefined;
      const candidatesTokenCount =
        rawUsage && typeof rawUsage.candidatesTokenCount === 'number'
          ? rawUsage.candidatesTokenCount
          : rawUsage && typeof rawUsage.candidates_token_count === 'number'
            ? rawUsage.candidates_token_count
            : undefined;
      const totalTokenCount =
        rawUsage && typeof rawUsage.totalTokenCount === 'number'
          ? rawUsage.totalTokenCount
          : rawUsage && typeof rawUsage.total_token_count === 'number'
            ? rawUsage.total_token_count
            : undefined;
      /** Toujours renvoyer les compteurs utiles à l’app (persistance coût) — format natif + alias snake_case. */
      const usageMetadata =
        promptTokenCount === undefined && candidatesTokenCount === undefined && totalTokenCount === undefined
          ? undefined
          : {
              promptTokenCount,
              candidatesTokenCount,
              totalTokenCount,
              prompt_token_count: promptTokenCount,
              candidates_token_count: candidatesTokenCount,
              total_token_count: totalTokenCount,
            };
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          text: finalText,
          latencyMs: Date.now() - startedAt,
          modelId,
          usageMetadata,
          tokens_prompt: promptTokenCount ?? null,
          tokens_completion: candidatesTokenCount ?? null,
          tokens_total: totalTokenCount ?? null,
        })}\n\n`,
      );
      res.end();
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'gemini_failed' })}\n\n`);
      res.end();
    }
  },
);
