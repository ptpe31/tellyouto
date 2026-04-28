import { getGeminiProxyStreamUrl } from '../config/cloudFunctions';
import { ensureFirebaseAnonymousAuth, getFirebaseAuth } from '../api/firebase';
import { getGeminiCandidateModelIds } from './geminiRemoteModelSteering';
import { parseGeminiListInventoryJson, type GeminiListInventoryJson } from './listIntentionModel';

const GLOG = '\n  | ';

export type GeminiPathBLogAnchor = {
  pathACategoryTag: string;
  pathAPredictedType: string;
  pathAData: Record<string, unknown>;
};

export type GeminiHttpSettledMeta = {
  modelId: string;
  latencyMs: number;
  fallbackUsed: boolean;
  operation: string;
  versionLabel: string;
};

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
  parsed: { categoryTag: string; data: Record<string, unknown> },
): void {
  const fb = meta.fallbackUsed ? 'YES' : 'NO';
  const entitiesJson = safeJsonForTerminalLog(parsed.data, 2000);
  console.log(
    `[GeminiAPI] ✅ CALL_SUCCESS${GLOG}Model: ${meta.modelId}${GLOG}Category: ${parsed.categoryTag}${GLOG}Entities: ${entitiesJson}${GLOG}Latency: ${meta.latencyMs}ms${GLOG}FallbackUsed: ${fb}${GLOG}Version: ${meta.versionLabel}${GLOG}Operation: ${meta.operation}`,
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
  | { type: 'done'; text: string; latencyMs?: number; modelId?: string }
  | { type: 'error'; error: string };

async function getFirebaseIdToken(): Promise<string> {
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const token = await auth?.currentUser?.getIdToken();
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
): Promise<{ text: string; serverLatencyMs?: number; serverModelId?: string }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let doneText: string | null = null;
  let serverLatencyMs: number | undefined;
  let serverModelId: string | undefined;

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
    return { text: doneText ?? accumulated, serverLatencyMs, serverModelId };
  }

  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) processChunkText(decoder.decode(value, { stream: true }));
  }
  if (buffer) processChunkText('\n\n');
  return { text: doneText ?? accumulated, serverLatencyMs, serverModelId };
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

async function readProxyResponse(
  res: Response,
  onAccumulatedText?: (full: string) => void,
): Promise<{ text: string; serverLatencyMs?: number; serverModelId?: string }> {
  const ct = contentType(res);
  if (ct.includes('text/event-stream')) {
    return readProxySse(res, onAccumulatedText);
  }

  const raw = await readAllTextFromResponse(res);
  if (!raw.trim()) return { text: '' };

  if (ct.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const extracted = extractTextFromAnyGeminiShape(parsed);
      if (extracted) {
        onAccumulatedText?.(extracted);
        return { text: extracted };
      }
      const fallback = JSON.stringify(parsed);
      if (fallback && fallback !== 'null') {
        onAccumulatedText?.(fallback);
        return { text: fallback };
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
  onAccumulatedText?: (full: string) => void;
  options?: PostGeminiHttpOptions;
}): Promise<{ text: string; meta: GeminiHttpSettledMeta }> {
  const candidates = params.modelOverride
    ? [params.modelOverride]
    : getGeminiCandidateModelIds();

  const token = await getFirebaseIdToken();
  const t0 = perfNowMs();
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const modelId = candidates[i];
    const url = getGeminiProxyStreamUrl();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ modelId, request: params.request }),
    });

    if (!res.ok) {
      const bodyText = await readAllTextFromResponse(res);
      lastError = new Error(`${res.status}:${bodyText.slice(0, 200)}`);
      continue;
    }

    try {
      const out = await readProxyResponse(res, params.onAccumulatedText);
      const t1 = perfNowMs();
      const meta: GeminiHttpSettledMeta = {
        modelId: out.serverModelId ?? modelId,
        latencyMs: out.serverLatencyMs ?? Math.round(t1 - t0),
        fallbackUsed: i > 0,
        operation: params.operation,
        versionLabel: 'proxy',
      };
      params.options?.onHttpSuccessMeta?.(meta);
      if (!params.options?.pathBLog) logGeminiApiCallSuccess(meta);
      return { text: out.text, meta };
    } catch (e) {
      lastError = e;
    }
  }

  const t1 = perfNowMs();
  const meta: GeminiHttpSettledMeta = {
    modelId: candidates[0] ?? 'unknown',
    latencyMs: Math.round(t1 - t0),
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

const ONETAP_WIRE_SYSTEM_PREFIX =
  'Output ONLY lines starting with \">\". No markdown, no explanations. ' +
  'NO CALCULATIONS. Do NOT divide by baseCount. ' +
  'If the dictation mentions a travel/route (going to a place, a station/airport, \"trajet\", \"aller à\", \"chez\"), output a TRIP intent FIRST. ' +
  'Allowed TYPE: TASK, NOTE, LIST, HABIT, TRIP. ' +
  'TASK: > TASK | TitleOrContent | DateISO(optional ISO 8601). ' +
  'NOTE: > NOTE | TitleOrContent. ' +
  'HABIT: > HABIT | TitleOrContent | RecurrenceText(optional). ' +
  'TRIP: > TRIP | Destination | DateISO(optional). ' +
  'LIST format: > LIST | Title | baseCount | unitLabel then items: >> ITEM | Name | quantity | unit | scalable. ' +
  'quantity MUST be the standard recipe quantity for the whole recipe. ' +
  'baseCount MUST match the user requested baseCount.\n';

export async function geminiGenerateOneTapCompressedLine(
  prompt: string,
  pathBLog?: GeminiPathBLogAnchor,
): Promise<{ raw: string; httpMeta: GeminiHttpSettledMeta | undefined }> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) throw new Error('Gemini: prompt vide');
  let httpMeta: GeminiHttpSettledMeta | undefined;
  const { text } = await callGeminiProxyStream({
    request: {
      contents: [{ parts: [{ text: `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}` }] }],
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
  const raw = normalizeOneTapWireText(extractTextFromGenerateResponse(text));
  if (!raw) throw new Error('Gemini: réponse filaire vide');
  return { raw, httpMeta };
}

export async function geminiStreamOneTapCompressedLine(
  prompt: string,
  onAccumulatedText: (full: string) => void,
  pathBLog?: GeminiPathBLogAnchor,
): Promise<{ raw: string; httpMeta: GeminiHttpSettledMeta | undefined }> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) throw new Error('Gemini: prompt vide');
  let httpMeta: GeminiHttpSettledMeta | undefined;
  const { text } = await callGeminiProxyStream({
    request: {
      contents: [{ parts: [{ text: `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}` }] }],
      generationConfig: { maxOutputTokens: 2048 },
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
  const raw = normalizeOneTapWireText(extractTextFromGenerateResponse(text));
  if (!raw) throw new Error('Gemini: réponse filaire vide');
  return { raw, httpMeta };
}
