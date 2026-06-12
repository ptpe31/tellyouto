/**
 * Routeur Gemini : proxy Firebase (défaut) ou Google AI Studio direct (mode local).
 *
 * @module geminiDirectClient
 */

import { ensureFirebaseAnonymousAuth, getFirebaseAuth } from '../api/firebase';
import { getGeminiProxyStreamUrl } from '../config/cloudFunctions';
import { IS_LOCAL_MODE, LOCAL_GEMINI_API_KEY } from '../config/appConfig';

export type GeminiCallParams = {
  modelId: string;
  request: Record<string, unknown>;
  systemInstruction?: string;
  /** `true` (défaut) → streamGenerateContent / SSE proxy ; `false` → generateContent JSON. */
  stream?: boolean;
};

export function isGeminiLocalModeActive(): boolean {
  return IS_LOCAL_MODE && LOCAL_GEMINI_API_KEY.length > 0;
}

function buildGoogleAiRequestBody(params: {
  request: Record<string, unknown>;
  systemInstruction?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { ...params.request };
  const si = params.systemInstruction?.trim();
  if (si) {
    body.systemInstruction = { parts: [{ text: si }] };
  }
  return body;
}

function googleAiBaseUrl(modelId: string, stream: boolean): string {
  const action = stream ? 'streamGenerateContent' : 'generateContent';
  const suffix = stream ? '&alt=sse' : '';
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:${action}?key=${encodeURIComponent(LOCAL_GEMINI_API_KEY)}${suffix}`;
}

function extractTextFromGoogleResponse(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const rec = data as Record<string, unknown>;
  const candidates = rec.candidates;
  if (!Array.isArray(candidates) || !candidates[0]) return '';
  const content = (candidates[0] as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return '';
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return '';
  let s = '';
  for (const p of parts) {
    if (p && typeof p === 'object' && typeof (p as { text?: string }).text === 'string') {
      s += (p as { text: string }).text;
    }
  }
  return s;
}

function extractUsageFromGoogleResponse(
  data: unknown,
): { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const um = (data as Record<string, unknown>).usageMetadata;
  if (!um || typeof um !== 'object' || Array.isArray(um)) return undefined;
  const u = um as Record<string, unknown>;
  return {
    promptTokenCount: typeof u.promptTokenCount === 'number' ? u.promptTokenCount : undefined,
    candidatesTokenCount:
      typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : undefined,
    totalTokenCount: typeof u.totalTokenCount === 'number' ? u.totalTokenCount : undefined,
  };
}

function encodeProxySseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Transforme le flux SSE natif Google (`alt=sse`) en événements proxy
 * (`delta` / `done`) attendus par `readProxySse` dans l'app.
 */
function transformGoogleSseToProxySse(
  googleBody: ReadableStream<Uint8Array> | null,
  googleTextFallback: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = '';
      let lastUsage:
        | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
        | undefined;

      const emitDelta = (delta: string) => {
        if (!delta) return;
        controller.enqueue(encoder.encode(encodeProxySseEvent({ type: 'delta', text: delta })));
      };

      const processGooglePayload = (payload: string) => {
        const trimmed = payload.trim();
        if (!trimmed || trimmed === '[DONE]') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return;
        }
        const chunkText = extractTextFromGoogleResponse(parsed);
        const usage = extractUsageFromGoogleResponse(parsed);
        if (usage) lastUsage = usage;

        if (!chunkText) return;

        let delta = '';
        if (chunkText.startsWith(accumulated)) {
          delta = chunkText.slice(accumulated.length);
          accumulated = chunkText;
        } else {
          delta = chunkText;
          accumulated += chunkText;
        }
        emitDelta(delta);
      };

      const processBuffer = (buffer: string, flushPartial = false) => {
        const parts = buffer.split('\n');
        const rest = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.replace(/\r$/, '');
          if (!trimmed.startsWith('data:')) continue;
          processGooglePayload(trimmed.slice(5).trim());
        }
        if (flushPartial && rest.trim().startsWith('data:')) {
          processGooglePayload(rest.trim().slice(5).trim());
        }
        return rest;
      };

      try {
        if (!googleBody || typeof googleBody.getReader !== 'function') {
          let buf = googleTextFallback;
          buf = processBuffer(buf, true);
          if (buf.trim()) processBuffer(`${buf}\n`);
        } else {
          const reader = googleBody.getReader();
          let buf = '';
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) buf += decoder.decode(value, { stream: true });
            buf = processBuffer(buf);
          }
          if (buf) processBuffer(`${buf}\n`, true);
        }

        controller.enqueue(
          encoder.encode(
            encodeProxySseEvent({
              type: 'done',
              text: accumulated,
              usageMetadata: lastUsage,
              tokens_prompt: lastUsage?.promptTokenCount ?? null,
              tokens_completion: lastUsage?.candidatesTokenCount ?? null,
              tokens_total: lastUsage?.totalTokenCount ?? null,
            }),
          ),
        );
        controller.close();
      } catch (e) {
        const details = e instanceof Error ? e.message : String(e);
        controller.enqueue(
          encoder.encode(
            encodeProxySseEvent({ type: 'error', error: 'gemini_failed', code: 'gemini_failed', details }),
          ),
        );
        controller.close();
      }
    },
  });
}

async function executeLocalGeminiCall(params: GeminiCallParams): Promise<Response> {
  if (!LOCAL_GEMINI_API_KEY) {
    throw new Error('LOCAL_MODE: EXPO_PUBLIC_GEMINI_API_KEY manquante');
  }

  const stream = params.stream !== false;
  const url = googleAiBaseUrl(params.modelId, stream);
  const body = buildGoogleAiRequestBody({
    request: params.request,
    systemInstruction: params.systemInstruction,
  });

  if (__DEV__) {
    console.log(
      `[GEMINI-LOCAL] Appel direct Google AI | ModelId: ${params.modelId} | Stream: ${stream}`,
    );
  }

  const googleRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!stream) {
    return googleRes;
  }

  if (!googleRes.ok) {
    return googleRes;
  }

  const bodyStream = googleRes.body;
  if (bodyStream && typeof bodyStream.getReader === 'function') {
    const proxyStream = transformGoogleSseToProxySse(bodyStream, '');
    return new Response(proxyStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    });
  }

  const fallbackText = await googleRes.text().catch(() => '');
  const proxyStream = transformGoogleSseToProxySse(null, fallbackText);
  return new Response(proxyStream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

async function executeProxyGeminiCall(params: GeminiCallParams): Promise<Response> {
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  let token = await auth?.currentUser?.getIdToken(false);
  if (!token) throw new Error('Missing Firebase ID token');

  const url = getGeminiProxyStreamUrl();
  const payload = JSON.stringify({
    modelId: params.modelId,
    request: params.request,
    ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
    Authorization: `Bearer ${token}`,
  };

  let res = await fetch(url, { method: 'POST', headers, body: payload });

  if ((res.status === 401 || res.status === 403) && auth?.currentUser) {
    token = await auth.currentUser.getIdToken(true);
    if (token) {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: payload,
      });
    }
  }

  return res;
}

/**
 * Point d'entrée unique des appels Gemini HTTP.
 * Mode local actif → Google AI Studio ; sinon → proxy Firebase + Bearer token.
 */
export async function executeGeminiCall(params: GeminiCallParams): Promise<Response> {
  if (isGeminiLocalModeActive()) {
    return executeLocalGeminiCall(params);
  }
  return executeProxyGeminiCall(params);
}
