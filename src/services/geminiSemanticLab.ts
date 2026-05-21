import { getGeminiProxyStreamUrl } from '../config/cloudFunctions';
import { ensureFirebaseAnonymousAuth, getFirebaseAuth } from '../api/firebase';
import {
  awaitGeminiSteeringBeforeNetworkCall,
  excludeGeminiModelForSession,
  getActivePass1ModelId,
  getActivePass2ModelId,
  getGeminiCandidateModelIds,
  logPass2ModelSteeringDiagnostics,
  ensureFreshPassModelsFromRemoteConfig,
  setGeminiSessionFallbackModelId,
  shouldExcludeGeminiModelForSession,
} from './geminiRemoteModelSteering';
import { parseGeminiListInventoryJson, type GeminiListInventoryJson } from './listIntentionModel';
import { aiLogTokensFromHttpMeta, logAiInteraction } from '../utils/logAiInteraction';

const GLOG = '\n  | ';

export type GeminiPathBLogAnchor = {
  pathACategoryTag: string;
  pathAPredictedType: string;
  pathAData: Record<string, unknown>;
};

export type GeminiHttpSettledMeta = {
  modelId: string;
  latencyMs: number;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensTotal: number | null;
  estimatedCostUsd: number;
  fallbackUsed: boolean;
  operation: string;
  versionLabel: string;
};

function estimateGeminiCostUsd(modelId: string, tokensPrompt: number | null, tokensCompletion: number | null, tokensTotal: number | null): number {
  const m = String(modelId || '').toLowerCase();
  const prompt = Math.max(0, Number(tokensPrompt ?? 0) || 0);
  const completion = Math.max(0, Number(tokensCompletion ?? 0) || 0);
  const total = Math.max(0, Number(tokensTotal ?? 0) || 0);
  const pricing: Record<string, { promptPer1k: number; completionPer1k: number; totalPer1k?: number }> = {
    'gemini-3.1-flash-lite': { promptPer1k: 0.000075, completionPer1k: 0.0003 },
    'gemini-1.5-flash': { promptPer1k: 0.000075, completionPer1k: 0.0003 },
    'gemini-flash-latest': { promptPer1k: 0.000075, completionPer1k: 0.0003 },
    'gemini-1.5-pro': { promptPer1k: 0, completionPer1k: 0, totalPer1k: 0 },
    'gemini-2.0-flash': { promptPer1k: 0, completionPer1k: 0, totalPer1k: 0 },
  };
  const key =
    Object.keys(pricing).find((k) => m.includes(k)) ??
    (m.includes('flash') ? 'gemini-1.5-flash' : m.includes('pro') ? 'gemini-1.5-pro' : null);
  const p = key ? pricing[key] : null;
  if (!p) return 0;
  if (prompt > 0 || completion > 0) {
    return (prompt / 1000) * p.promptPer1k + (completion / 1000) * p.completionPer1k;
  }
  return (total / 1000) * (p.totalPer1k ?? 0);
}

function safeJsonForTerminalLog(value: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(value);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}…`;
  } catch {
    return '"[unserializable]"';
  }
}

function logGeminiApiCallSuccess(params: GeminiHttpSettledMeta): void {
  const fb = params.fallbackUsed ? 'YES' : 'NO';
  console.log(
    `[GeminiAPI] 🚀 CALL_SUCCESS${GLOG}Model: ${params.modelId}${GLOG}Latency: ${params.latencyMs}ms${GLOG}FallbackUsed: ${fb}${GLOG}Version: ${params.versionLabel}${GLOG}Operation: ${params.operation}`,
  );
}

export function logGeminiApiPathBResolvedSuccess(
  meta: GeminiHttpSettledMeta,
  parsed: { categoryTag: string; contextTag?: string; data: Record<string, unknown> },
): void {
  const fb = meta.fallbackUsed ? 'YES' : 'NO';
  const entitiesJson = safeJsonForTerminalLog(parsed.data, 2000);
  const ctxLine =
    parsed.contextTag && String(parsed.contextTag).trim()
      ? `${GLOG}Context: ${String(parsed.contextTag).trim()}`
      : '';
  console.log(
    `[GeminiAPI] ✅ CALL_SUCCESS${GLOG}Model: ${meta.modelId}${GLOG}Category: ${parsed.categoryTag}${ctxLine}${GLOG}Entities: ${entitiesJson}${GLOG}Latency: ${meta.latencyMs}ms${GLOG}FallbackUsed: ${fb}${GLOG}Version: ${meta.versionLabel}${GLOG}Operation: ${meta.operation}`,
  );
}

function logGeminiApiCallError(params: GeminiHttpSettledMeta & { reason?: string; pathBAnchor?: GeminiPathBLogAnchor }): void {
  const fb = params.fallbackUsed ? 'YES' : 'NO';
  const reason = params.reason ? `${GLOG}Reason: ${params.reason.slice(0, 200)}` : '';
  const pathA =
    params.pathBAnchor != null
      ? `${GLOG}PathA_Fallback_Category: ${params.pathBAnchor.pathACategoryTag}${GLOG}PathA_Entities: ${safeJsonForTerminalLog(params.pathBAnchor.pathAData, 600)}`
      : '';
  console.log(
    `[GeminiAPI] ❌ CALL_ERROR${GLOG}Model: ${params.modelId}${GLOG}Latency: ${params.latencyMs}ms${GLOG}FallbackUsed: ${fb}${GLOG}Version: ${params.versionLabel}${GLOG}Operation: ${params.operation}${reason}${pathA}`,
  );
}

function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

type PostGeminiHttpOptions = {
  pathBLog?: GeminiPathBLogAnchor;
  onHttpSuccessMeta?: (m: GeminiHttpSettledMeta) => void;
};

type ProxyStreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      text: string;
      latencyMs?: number;
      modelId?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      tokens_prompt?: number | null;
      tokens_completion?: number | null;
      tokens_total?: number | null;
    }
  | { type: 'error'; error: string };

async function getFirebaseIdToken(): Promise<string> {
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const token = await auth?.currentUser?.getIdToken(false);
  if (!token) throw new Error('Missing Firebase ID token');
  return token;
}

async function refreshFirebaseIdToken(): Promise<string> {
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const token = await auth?.currentUser?.getIdToken(true);
  if (!token) throw new Error('Missing Firebase ID token');
  return token;
}

async function readAllTextFromResponse(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function readProxySse(
  res: Response,
  onDelta?: (accumulated: string) => void,
): Promise<{
  text: string;
  serverLatencyMs?: number;
  serverModelId?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}> {
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let doneText: string | null = null;
  let serverLatencyMs: number | undefined;
  let serverModelId: string | undefined;
  let usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;

  const processChunkText = (chunkText: string) => {
    buffer += chunkText;
    while (true) {
      const sepIndex = buffer.indexOf('\n\n');
      if (sepIndex === -1) break;
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const lines = rawEvent.split('\n');
      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '');
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        let evt: ProxyStreamEvent | null = null;
        try {
          evt = JSON.parse(payload) as ProxyStreamEvent;
        } catch {
          continue;
        }
        if (!evt) continue;
        if (evt.type === 'delta') {
          accumulated += evt.text || '';
          onDelta?.(accumulated);
        } else if (evt.type === 'done') {
          doneText = typeof evt.text === 'string' ? evt.text : accumulated;
          serverLatencyMs = typeof evt.latencyMs === 'number' ? evt.latencyMs : undefined;
          serverModelId = typeof evt.modelId === 'string' ? evt.modelId : undefined;
          usageMetadata =
            evt.usageMetadata ??
            (typeof evt.tokens_prompt === 'number' || typeof evt.tokens_completion === 'number' || typeof evt.tokens_total === 'number'
              ? {
                  promptTokenCount: typeof evt.tokens_prompt === 'number' ? evt.tokens_prompt : undefined,
                  candidatesTokenCount: typeof evt.tokens_completion === 'number' ? evt.tokens_completion : undefined,
                  totalTokenCount: typeof evt.tokens_total === 'number' ? evt.tokens_total : undefined,
                }
              : usageMetadata);
        } else if (evt.type === 'error') {
          throw new Error(evt.error || 'proxy_error');
        }
      }
    }
  };

  const stream = (res.body as ReadableStream<Uint8Array> | null) ?? null;
  if (!stream || typeof stream.getReader !== 'function') {
    const text = await readAllTextFromResponse(res);
    processChunkText(text);
    return { text: doneText ?? accumulated, serverLatencyMs, serverModelId, usageMetadata };
  }

  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) processChunkText(decoder.decode(value, { stream: true }));
  }
  if (buffer) processChunkText('\n\n');
  return { text: doneText ?? accumulated, serverLatencyMs, serverModelId, usageMetadata };
}

function contentType(res: Response): string {
  return String(res.headers.get('content-type') || '').toLowerCase();
}

function extractTextFromAnyGeminiShape(data: unknown): string {
  if (typeof data === 'string') return data.trim();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const rec = data as Record<string, unknown>;
  if (typeof rec.text === 'string') return rec.text.trim();
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = d?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  let s = '';
  for (const p of parts) {
    if (p && typeof p.text === 'string') s += p.text;
  }
  return s.trim();
}

function extractUsageMetadataFromAnyGeminiShape(
  data: unknown,
): { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const rec = data as Record<string, unknown>;
  const tp = rec.tokens_prompt;
  const tc = rec.tokens_completion;
  const tt = rec.tokens_total;
  if (typeof tp === 'number' || typeof tc === 'number' || typeof tt === 'number') {
    return {
      promptTokenCount: typeof tp === 'number' ? tp : undefined,
      candidatesTokenCount: typeof tc === 'number' ? tc : undefined,
      totalTokenCount: typeof tt === 'number' ? tt : undefined,
    };
  }
  const direct = rec.usageMetadata;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const u = direct as Record<string, unknown>;
    return {
      promptTokenCount: typeof u.promptTokenCount === 'number' ? u.promptTokenCount : undefined,
      candidatesTokenCount: typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : undefined,
      totalTokenCount: typeof u.totalTokenCount === 'number' ? u.totalTokenCount : undefined,
    };
  }
  const nested = rec.response;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return extractUsageMetadataFromAnyGeminiShape(nested);
  }
  return undefined;
}

async function readProxyResponse(
  res: Response,
  onAccumulatedText?: (full: string) => void,
): Promise<{
  text: string;
  serverLatencyMs?: number;
  serverModelId?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}> {
  const ct = contentType(res);
  if (ct.includes('text/event-stream')) {
    return readProxySse(res, onAccumulatedText);
  }

  const raw = await readAllTextFromResponse(res);
  if (!raw.trim()) return { text: '' };

  if (raw.trim().startsWith('data:')) {
    const sseRes = {
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: null,
      text: async () => raw,
    } as unknown as Response;
    return readProxySse(sseRes, onAccumulatedText);
  }

  if (ct.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const extracted = extractTextFromAnyGeminiShape(parsed);
      const usageMetadata = extractUsageMetadataFromAnyGeminiShape(parsed);
      if (extracted) {
        onAccumulatedText?.(extracted);
        return { text: extracted, usageMetadata };
      }
      const fallback = JSON.stringify(parsed);
      if (fallback && fallback !== 'null') {
        onAccumulatedText?.(fallback);
        return { text: fallback, usageMetadata };
      }
    } catch {}
  }

  const out = raw.trim();
  if (out) onAccumulatedText?.(out);
  return { text: out };
}

async function callGeminiProxyStream(params: {
  request: object;
  operation: string;
  modelOverride?: string;
  /** Instructions système (proxy Firebase → Vertex) : réduit les tokens « user » et le coût. */
  systemInstruction?: string;
  onAccumulatedText?: (full: string) => void;
  options?: PostGeminiHttpOptions;
}): Promise<{ text: string; meta: GeminiHttpSettledMeta }> {
  await awaitGeminiSteeringBeforeNetworkCall();

  const candidates = params.modelOverride
    ? [params.modelOverride]
    : getGeminiCandidateModelIds();

  let token = await getFirebaseIdToken();
  let tokenRefreshed = false;
  const t0 = perfNowMs();
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const modelId = candidates[i];
    const url = getGeminiProxyStreamUrl();

    let res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        modelId,
        request: params.request,
        ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
      }),
    });

    if ((res.status === 401 || res.status === 403) && !tokenRefreshed) {
      token = await refreshFirebaseIdToken();
      tokenRefreshed = true;
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          modelId,
          request: params.request,
          ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
        }),
      });
    }

    if (res.status === 401 || res.status === 403) {
      const bodyText = await readAllTextFromResponse(res);
      lastError = new Error(`unauthorized:${res.status}:${bodyText.slice(0, 160)}`);
      break;
    }

    if (!res.ok) {
      const bodyText = await readAllTextFromResponse(res);
      lastError = new Error(`${res.status}:${bodyText.slice(0, 200)}`);
      if (shouldExcludeGeminiModelForSession(res.status, bodyText)) {
        excludeGeminiModelForSession(modelId);
      }
      continue;
    }

    try {
      const out = await readProxyResponse(res, params.onAccumulatedText);
      const t1 = perfNowMs();
      const tokensPrompt = typeof out.usageMetadata?.promptTokenCount === 'number' ? out.usageMetadata.promptTokenCount : null;
      const tokensCompletion =
        typeof out.usageMetadata?.candidatesTokenCount === 'number' ? out.usageMetadata.candidatesTokenCount : null;
      const tokensTotal = typeof out.usageMetadata?.totalTokenCount === 'number' ? out.usageMetadata.totalTokenCount : null;
      const meta: GeminiHttpSettledMeta = {
        modelId: out.serverModelId ?? modelId,
        latencyMs: out.serverLatencyMs ?? Math.round(t1 - t0),
        tokensPrompt,
        tokensCompletion,
        tokensTotal,
        estimatedCostUsd: estimateGeminiCostUsd(out.serverModelId ?? modelId, tokensPrompt, tokensCompletion, tokensTotal),
        fallbackUsed: i > 0,
        operation: params.operation,
        versionLabel: 'proxy',
      };
      params.options?.onHttpSuccessMeta?.(meta);
      if (!params.options?.pathBLog) logGeminiApiCallSuccess(meta);
      if (i > 0 && !params.modelOverride) {
        setGeminiSessionFallbackModelId(modelId);
      }
      return { text: out.text, meta };
    } catch (e) {
      lastError = e;
    }
  }

  const t1 = perfNowMs();
  const meta: GeminiHttpSettledMeta = {
    modelId: candidates[0] ?? 'unknown',
    latencyMs: Math.round(t1 - t0),
    tokensPrompt: null,
    tokensCompletion: null,
    tokensTotal: null,
    estimatedCostUsd: 0,
    fallbackUsed: candidates.length > 1,
    operation: params.operation,
    versionLabel: 'proxy',
  };
  logGeminiApiCallError({
    ...meta,
    reason: lastError instanceof Error ? lastError.message : String(lastError || 'unknown_error'),
    pathBAnchor: params.options?.pathBLog,
  });
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Gemini proxy failed'));
}

function extractTextFromGenerateResponse(data: unknown): string {
  return extractTextFromAnyGeminiShape(data);
}

function normalizeOneTapWireText(raw: string): string {
  const s = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n')
    .trim();
  return s;
}

export async function geminiTranscribeAudioBase64(
  base64Audio: string,
  mimeType: string = 'audio/mp4',
): Promise<string> {
  if (!base64Audio?.length) {
    throw new Error('Audio base64 vide');
  }
  const { text } = await callGeminiProxyStream({
    request: {
      contents: [
        {
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            {
              text:
                'Transcribe this audio into plain text only. Output ONLY the words spoken, in the original language. No preamble, no quotes, no markdown.',
            },
          ],
        },
      ],
    },
    operation: 'lab.transcribe_audio',
  });
  const out = extractTextFromGenerateResponse(text);
  if (!out) {
    throw new Error('Gemini: transcription vide');
  }
  return out;
}

function stripJsonFence(raw: string): string {
  let s = raw.trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m?.[1]) {
    s = m[1].trim();
  }
  return s;
}

export type GeminiLabAnalysis = {
  type: 'habit' | 'task' | 'project';
  frequency: string;
  isComplexProject: boolean;
  reasoning: string;
};

function parseGeminiAnalysisJson(raw: string): GeminiLabAnalysis {
  const s = stripJsonFence(raw);
  const obj = JSON.parse(s) as Record<string, unknown>;
  const type = obj.type;
  if (type !== 'habit' && type !== 'task' && type !== 'project') {
    throw new Error(`type Gemini invalide: ${String(type)}`);
  }
  const frequency = typeof obj.frequency === 'string' ? obj.frequency : '';
  const isComplexProject = Boolean(obj.isComplexProject);
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
  return { type, frequency, isComplexProject, reasoning };
}

export type GeminiAnalysisPromptLanguage = 'fr' | 'en';

function buildIntentAnalysisPrompt(transcriptSlice: string, lang: GeminiAnalysisPromptLanguage): string {
  if (lang === 'fr') {
    return `Tu es un assistant de laboratoire pour une app de productivité. Classe l'intention exprimée dans la transcription.

Transcription (verbatim) :
${transcriptSlice}

Règles :
- type "habit" = rituel récurrent (ex. chaque matin, tous les jours, chaque lundi).
- type "task" = action ponctuelle ou à horizon court, une étape.
- type "project" = entreprise multi-étapes ou longue durée (déménagement, mariage, lancement produit, "organiser mon déménagement").
- frequency : courte phrase décrivant la récurrence (ex. "quotidien", "une fois", "chaque matin").
- isComplexProject : true si clairement multi-étapes / horizon long, sinon false.
- reasoning : une phrase expliquant le choix (même langue que la transcription si possible).

Réponds UNIQUEMENT avec un JSON valide, sans markdown, de la forme :
{"type":"habit"|"task"|"project","frequency":"...","isComplexProject":true|false,"reasoning":"..."}`;
  }
  return `You are a lab assistant for a productivity app. Classify the intention in the transcript.

Transcript (verbatim):
${transcriptSlice}

Rules:
- type "habit" = recurring ritual (e.g. every morning, daily, every Monday).
- type "task" = one-off or short-horizon action, a single step.
- type "project" = multi-step or long-horizon endeavor (moving, wedding, product launch, "organize my move").
- frequency: short phrase describing recurrence (e.g. "daily", "once", "every morning").
- isComplexProject: true if clearly multi-step / long horizon, else false.
- reasoning: one sentence explaining the choice (same language as the transcript when possible).

Reply ONLY with valid JSON, no markdown, shaped like:
{"type":"habit"|"task"|"project","frequency":"...","isComplexProject":true|false,"reasoning":"..."}`;
}

export async function geminiAnalyzeIntentTranscript(
  transcript: string,
  options?: { promptLanguage?: GeminiAnalysisPromptLanguage },
): Promise<{ parsed: GeminiLabAnalysis; rawResponseText: string }> {
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  const promptLang: GeminiAnalysisPromptLanguage = options?.promptLanguage === 'en' ? 'en' : 'fr';
  const prompt = buildIntentAnalysisPrompt(safe, promptLang);

  const { text } = await callGeminiProxyStream({
    request: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 512 },
    },
    operation: 'lab.analyze_intent',
  });
  const rawResponseText = extractTextFromGenerateResponse(text);
  if (!rawResponseText) throw new Error('Gemini: réponse analyse vide');
  const parsed = parseGeminiAnalysisJson(rawResponseText);
  return { parsed, rawResponseText };
}

export type GeminiDeepIntention = {
  type: 'habit' | 'project';
  title: string;
  timing: string;
  isComplex: boolean;
};

function buildDeepIntentionPrompt(transcriptSlice: string, lang: GeminiAnalysisPromptLanguage): string {
  if (lang === 'fr') {
    return `À partir de la transcription ci-dessous, réponds avec UN SEUL objet JSON valide (pas de markdown, pas de texte autour), exactement ces clés :
"type" : uniquement "habit" ou "project"
"title" : titre court de l'intention
"timing" : moment ou récurrence en langage naturel
"isComplex" : booléen (true si chantier long ou clairement multi-étapes)

Règles :
- "habit" = rituel ou récurrence (sport quotidien, chaque lundi…).
- "project" = entreprise étendue ou plusieurs étapes (déménagement, lancement…).

Transcription :
${transcriptSlice}`;
  }
  return `From the transcript below, reply with ONE valid JSON object only (no markdown, no extra text), exactly these keys:
"type": only "habit" or "project"
"title": short intention title
"timing": when or recurrence in natural language
"isComplex": boolean (true if clearly long or multi-step)

Rules:
- "habit" = recurring ritual or routine.
- "project" = extended multi-step endeavor.

Transcript:
${transcriptSlice}`;
}

function parseDeepIntentionJson(raw: string): GeminiDeepIntention {
  const s = stripJsonFence(raw);
  const obj = JSON.parse(s) as Record<string, unknown>;
  const type = obj.type;
  if (type !== 'habit' && type !== 'project') {
    throw new Error(`Gemini deep: type invalide (${String(type)})`);
  }
  return {
    type,
    title: typeof obj.title === 'string' ? obj.title.trim() : '',
    timing: typeof obj.timing === 'string' ? obj.timing.trim() : '',
    isComplex: Boolean(obj.isComplex),
  };
}

export async function geminiDeepIntentionFromTranscript(
  transcript: string,
  options?: { promptLanguage?: GeminiAnalysisPromptLanguage },
): Promise<{ parsed: GeminiDeepIntention; rawResponseText: string }> {
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  const promptLang: GeminiAnalysisPromptLanguage = options?.promptLanguage === 'en' ? 'en' : 'fr';
  const prompt = buildDeepIntentionPrompt(safe, promptLang);

  const { text } = await callGeminiProxyStream({
    request: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.12, maxOutputTokens: 512 },
    },
    operation: 'lab.deep_intention',
  });
  const rawResponseText = extractTextFromGenerateResponse(text);
  if (!rawResponseText) throw new Error('Gemini: réponse deep vide');
  const parsed = parseDeepIntentionJson(rawResponseText);
  return { parsed, rawResponseText };
}

export type MelimeloGeminiGroup = {
  title: string;
  icon: string;
  noteIds: string[];
};

const MELOMELO_ICONS = new Set([
  'briefcase',
  'home',
  'heart',
  'star',
  'book',
  'leaf',
  'zap',
  'coffee',
  'music',
  'moon',
  'sun',
  'car',
  'plane',
  'target',
  'gift',
]);

function buildMelimeloPrompt(lines: string, uiLanguage: string): string {
  const langName =
    uiLanguage.startsWith('fr') || uiLanguage === 'fr'
      ? 'French'
      : uiLanguage.startsWith('en') || uiLanguage === 'en'
        ? 'English'
        : uiLanguage;
  return `You are clustering short notes for a calm productivity app (TellYouTo). Group them by theme.

Input notes (id and text, one per line):
${lines}

Rules:
- Output ONE valid JSON object only, no markdown, no commentary.
- Shape: {"groups":[{"title":"...","icon":"briefcase","noteIds":["id1","id2"]}]}
- Keys must stay in English: groups, title, icon, noteIds.
- Every "title" must be written in ${langName} (user interface language).
- icon must be one of: briefcase, home, heart, star, book, leaf, zap, coffee, music, moon, sun, car, plane, target, gift.
- Every input note id must appear exactly once across all noteIds arrays.
- If a note fits nowhere, put it alone in a small group with a neutral title in ${langName}.
- Prefer 2–6 thematic groups when there are enough notes; single note = one group.`;
}

function parseMelimeloClusterJson(raw: string, validIds: Set<string>, orphanTitle: string): MelimeloGeminiGroup[] {
  const s = stripJsonFence(raw);
  const obj = JSON.parse(s) as { groups?: unknown };
  const groupsRaw = obj.groups;
  if (!Array.isArray(groupsRaw)) {
    throw new Error('Gemini semantic sort: groups missing');
  }
  const used = new Set<string>();
  const out: MelimeloGeminiGroup[] = [];
  for (const g of groupsRaw) {
    if (!g || typeof g !== 'object') continue;
    const rec = g as Record<string, unknown>;
    const titleRaw = typeof rec.title === 'string' ? rec.title.trim() : '';
    const title = titleRaw || orphanTitle;
    let icon = typeof rec.icon === 'string' ? rec.icon.trim().toLowerCase() : 'leaf';
    if (!MELOMELO_ICONS.has(icon)) icon = 'leaf';
    const idsRaw = rec.noteIds;
    const noteIds: string[] = [];
    if (Array.isArray(idsRaw)) {
      for (const id of idsRaw) {
        if (typeof id === 'string' && validIds.has(id) && !used.has(id)) {
          used.add(id);
          noteIds.push(id);
        }
      }
    }
    if (noteIds.length > 0) {
      out.push({ title, icon, noteIds });
    }
  }
  for (const id of validIds) {
    if (!used.has(id)) {
      out.push({ title: orphanTitle, icon: 'leaf', noteIds: [id] });
    }
  }
  return out.filter((g) => g.noteIds.length > 0);
}

export async function geminiMelimeloClusterNotes(
  notes: { id: string; text: string }[],
  options: { uiLanguage: string; orphanTitle?: string },
): Promise<{ groups: MelimeloGeminiGroup[]; rawResponseText: string }> {
  if (notes.length === 0) throw new Error('Aucune note à regrouper');
  const validIds = new Set(notes.map((n) => n.id));
  const lines = notes
    .map((n) => {
      const t = n.text.length > 800 ? `${n.text.slice(0, 800)}…` : n.text;
      return `${n.id}\t${JSON.stringify(t)}`;
    })
    .join('\n');
  const prompt = buildMelimeloPrompt(lines, options.uiLanguage);

  const { text } = await callGeminiProxyStream({
    request: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.22, maxOutputTokens: 2048 },
    },
    operation: 'lab.melimelo_cluster',
  });
  const rawResponseText = extractTextFromGenerateResponse(text);
  if (!rawResponseText) throw new Error('Gemini semantic sort: empty response');
  const groups = parseMelimeloClusterJson(
    rawResponseText,
    validIds,
    (options.orphanTitle ?? 'Notes').trim() || 'Notes',
  );
  if (groups.length === 0) throw new Error('Gemini semantic sort: no valid group');
  return { groups, rawResponseText };
}

export async function geminiListInventoryFromTranscript(
  transcript: string,
  options: { isProContext: boolean; uiLocale: string },
): Promise<{ parsed: GeminiListInventoryJson; rawResponseText: string }> {
  const safe = transcript.length > 10_000 ? transcript.slice(0, 10_000) : transcript;
  const loc = String(options.uiLocale || 'fr').toLowerCase();
  const langHint = loc.startsWith('en') ? 'Respond with category names and item names in English.' : '';
  const proHint = options.isProContext
    ? `If the dictation sounds professional (office, project, stock), use professional category names (e.g. "Marketing", "Technique", "Logistique") where relevant.`
    : 'Prefer everyday categories (e.g. "Frais", "Épicerie", "Logistique") for personal lists.';
  const prompt = `You are an expert organizer. Analyze the dictated list and output ONE valid JSON object only — no markdown, no commentary.

${proHint}
${langHint}

Transcription:
"""${safe.replace(/"/g, '\\"')}"""

Return exactly this shape (keys in English as shown):
{"title": string, "baseCount": number, "unitLabel": string, "categories": [{"name": string, "items": [{"name": string, "baseQuantity": number, "unit": string, "scalable": boolean}]}]}
`;

  const { text } = await callGeminiProxyStream({
    request: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.18, maxOutputTokens: 2048 },
    },
    operation: 'lab.list_inventory',
  });
  const rawResponseText = extractTextFromGenerateResponse(text);
  if (!rawResponseText) throw new Error('Gemini: empty list inventory response');
  const parsed = parseGeminiListInventoryJson(rawResponseText);
  return { parsed, rawResponseText };
}

const PASS2_LIST_INLINE_PROMPT = (transcript: string) => `Tu es un expert en logistique. Décompose l'intention en une liste structurée JSON.

CONSIGNES DE ROBUSTESSE (CRITIQUE) :
- Langue : Réponds impérativement dans la langue de la dictée.
- Concision : Noms d'items courts (max 3 mots). Exemple : "Chocolat noir" au lieu de "Chocolat noir à pâtisser".
- Format : JSON pur uniquement. AUCUNE explication, aucun texte introductif.
- Sécurité : Ferme TOUTES les accolades et crochets avant de terminer ta réponse.
- Taille : Max 12 items au total. Si la liste dépasse, groupe par catégorie.

Transcription:
"""${transcript.replace(/"/g, '\\"')}"""

Schéma JSON :
{"title": string, "baseCount": number, "unitLabel": string, "categories": [{"name": string, "items": [{"name": string, "baseQuantity": number, "unit": string, "scalable": boolean}]}]}
`;

const PASS2_PROJECT_INLINE_PROMPT = (transcript: string) => `Tu es un expert en planification de projets. Ton rôle est de décomposer une intention en jalons/étapes clés.

Consignes strictes :
Miroir Linguistique (CRITIQUE) : Réponds impérativement dans la même langue que la dictée de l'utilisateur.
INTERDICTION : ne fournis aucune date (pas de YYYY-MM-DD, pas de "lundi", pas de "demain", pas d'horaires).
À la place, fournis pour chaque jalon une durée estimée.
Pour chaque jalon, identifie l'expert métier le plus qualifié (ex: Électricien, Acousticien, Diététicien, Wedding Planner). Si le contexte est général, utilise "Assistant Personnel".

Transcription:
"""${transcript.replace(/"/g, '\\"')}"""

Schéma attendu (JSON pur, clés exactement comme ci-dessous) :
{"title": string, "milestones": [{"title": string, "estimated_duration": number, "unit": "hours|days|weeks", "expert_persona": string}]}
`;

/** Pré-chauffe auth + TLS + proxy Gemini (Pass 1 — première requête utilisateur). */
export async function warmGeminiProxySession(): Promise<void> {
  const iso = new Date().toISOString();
  await callGeminiProxyStream({
    systemInstruction:
      'You are a warmup handshake. Reply with exactly the two letters OK and a newline, nothing else. No punctuation.',
    modelOverride: getActivePass1ModelId(),
    request: {
      contents: [{ role: 'user', parts: [{ text: `Reference Time: ${iso}\nTranscript: __proxy_warmup__` }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    },
    operation: 'gemini.proxy_warm',
  });
}

export async function geminiEnrichGenericList(
  transcript: string,
  options: { uiLocale: string; mode?: 'LIST' | 'PROJECT'; referenceTimeIso?: string },
): Promise<
  | { mode: 'LIST'; parsed: GeminiListInventoryJson; rawResponseText: string }
  | { mode: 'PROJECT'; parsed: import('./projectMilestonesModel').ProjectMilestonesPayload; rawResponseText: string }
> {
  const safe = transcript.length > 10_000 ? transcript.slice(0, 10_000) : transcript;
  const mode = options.mode === 'PROJECT' ? 'PROJECT' : 'LIST';
  const prompt =
    mode === 'PROJECT' ? PASS2_PROJECT_INLINE_PROMPT(safe) : PASS2_LIST_INLINE_PROMPT(safe);
  await awaitGeminiSteeringBeforeNetworkCall();
  await ensureFreshPassModelsFromRemoteConfig();
  await logPass2ModelSteeringDiagnostics(`lab.list_enrich_generic/${mode}`);
  const modelId = getActivePass2ModelId();
  const temperature = 0.18;
  const historyLength = 1;
  const isJsonMode = false;
  const t0 = perfNowMs();
  const logBase = {
    pass: 2 as const,
    label: 'REASONING' as const,
    modelId,
    userContent: prompt,
    temperature,
    isJsonMode,
    historyLength,
  };

  let rawResponseText: string | undefined;
  try {
    const { text, meta } = await callGeminiProxyStream({
      modelOverride: modelId,
      request: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: 2048 },
      },
      operation: 'lab.list_enrich_generic',
    });
    const latencyMs = perfNowMs() - t0;
    rawResponseText = extractTextFromGenerateResponse(text);
    if (!rawResponseText) throw new Error('Gemini: empty list enrich response');
    const tokens = aiLogTokensFromHttpMeta(meta);
    if (mode === 'PROJECT') {
      const { parseGeminiProjectMilestonesJson } = await import('./projectMilestonesModel');
      const parsed = parseGeminiProjectMilestonesJson(rawResponseText);
      logAiInteraction({
        ...logBase,
        modelId: meta.modelId,
        latencyMs,
        rawResponse: rawResponseText,
        parsedResult: parsed,
        parsedSectionTitle: 'PARSED MILESTONES',
        tokens,
      });
      return { mode, parsed, rawResponseText };
    }
    const parsed = parseGeminiListInventoryJson(rawResponseText);
    logAiInteraction({
      ...logBase,
      modelId: meta.modelId,
      latencyMs,
      rawResponse: rawResponseText,
      parsedResult: parsed,
      parsedSectionTitle: 'PARSED LIST',
      tokens,
    });
    return { mode, parsed, rawResponseText };
  } catch (error) {
    logAiInteraction({
      ...logBase,
      latencyMs: perfNowMs() - t0,
      error,
      rawResponse: rawResponseText,
    });
    throw error;
  }
}

const JSON_EXTRACTOR_PREFIX = 'You are a JSON extractor. Output ONLY raw JSON. No chat, no markdown.\n\n';

export async function geminiGenerateTextUserPrompt(prompt: string): Promise<string> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) throw new Error('Gemini: prompt vide');
  const { text } = await callGeminiProxyStream({
    request: {
      contents: [{ parts: [{ text: `${JSON_EXTRACTOR_PREFIX}${trimmed}` }] }],
      generationConfig: { maxOutputTokens: 2048 },
    },
    operation: 'lab.generate_text_user_prompt',
  });
  const raw = extractTextFromGenerateResponse(text);
  if (!raw) throw new Error('Gemini: réponse texte vide');
  return raw;
}

export async function geminiGenerateOneTapCompressedLine(
  args: { systemInstruction: string; userText: string; modelId?: string },
  pathBLog?: GeminiPathBLogAnchor,
): Promise<{ raw: string; httpMeta: GeminiHttpSettledMeta | undefined }> {
  const userText = String(args.userText || '').trim();
  const systemInstruction = String(args.systemInstruction || '').trim();
  if (!userText) throw new Error('Gemini: userText vide');
  let httpMeta: GeminiHttpSettledMeta | undefined;
  const { text } = await callGeminiProxyStream({
    systemInstruction: systemInstruction.length > 0 ? systemInstruction : undefined,
    modelOverride: args.modelId,
    request: {
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 2048 },
    },
    operation: 'oneTap.wire.nonstream',
    options: pathBLog
      ? {
          pathBLog,
          onHttpSuccessMeta: (m) => {
            httpMeta = m;
          },
        }
      : undefined,
  });
  const rawText = extractTextFromGenerateResponse(text);
  const raw = normalizeOneTapWireText(rawText);
  if (!raw) throw new Error('Gemini: réponse filaire vide');
  return { raw, httpMeta };
}

export async function geminiStreamOneTapCompressedLine(
  args: { systemInstruction: string; userText: string; modelId?: string },
  onAccumulatedText: (full: string) => void,
  pathBLog?: GeminiPathBLogAnchor,
): Promise<{ raw: string; httpMeta: GeminiHttpSettledMeta | undefined }> {
  const userText = String(args.userText || '').trim();
  const systemInstruction = String(args.systemInstruction || '').trim();
  if (!userText) throw new Error('Gemini: userText vide');
  let httpMeta: GeminiHttpSettledMeta | undefined;
  const { text } = await callGeminiProxyStream({
    systemInstruction: systemInstruction.length > 0 ? systemInstruction : undefined,
    modelOverride: args.modelId,
    request: {
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    },
    operation: 'oneTap.wire.stream',
    onAccumulatedText,
    options: pathBLog
      ? {
          pathBLog,
          onHttpSuccessMeta: (m) => {
            httpMeta = m;
          },
        }
      : undefined,
  });
  const rawText = extractTextFromGenerateResponse(text);
  const raw = normalizeOneTapWireText(rawText);
  if (!raw) throw new Error('Gemini: réponse filaire vide');
  return { raw, httpMeta };
}

function stripHtmlCodeFence(raw: string): string {
  let s = String(raw || '').trim();
  const m = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (m?.[1]) s = m[1].trim();
  return s;
}

/** Pass 3 — Feuille de route quotidienne : HTML inline (pas de document complet). */
export async function geminiPass3DailyRoadmapHtml(args: {
  systemInstruction: string;
  userJson: string;
  onAccumulatedText?: (full: string) => void;
}): Promise<string> {
  const userText = String(args.userJson || '').trim();
  const systemInstruction = String(args.systemInstruction || '').trim();
  if (!userText) throw new Error('Gemini: Pass3 userJson vide');
  const { text } = await callGeminiProxyStream({
    systemInstruction: systemInstruction.length > 0 ? systemInstruction : undefined,
    modelOverride: getActivePass2ModelId(),
    request: {
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 8192 },
    },
    operation: 'pass3.daily_roadmap_html',
    onAccumulatedText: args.onAccumulatedText,
  });
  const rawText = extractTextFromGenerateResponse(text);
  const out = stripHtmlCodeFence(rawText);
  if (!out) throw new Error('Gemini: Pass3 HTML vide');
  return out;
}
