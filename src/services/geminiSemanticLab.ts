/**
 * Appels directs Google AI (Gemini) pour le lab sémantique.
 * Clé : EXPO_PUBLIC_GEMINI_API_KEY — réservée aux builds de test (exposée client).
 * Modèle : Firebase Remote Config `active_gemini_model` (voir {@link geminiRemoteModelSteering}),
 * défaut `gemini-1.5-flash-latest` tant que RC n’est pas chargé ou en erreur.
 *
 * **Self-healing** : sur HTTP 404/503, `listModels` + modèle de secours (AsyncStorage 24h, voir steering).
 *
 * **Streaming / audio** : `generateContent` non streamé par défaut ; one-tap filaire utilise `streamGenerateContent`.
 */

import Constants from 'expo-constants';

import { getActiveGeminiModelId, recoverGeminiModelViaListModels } from './geminiRemoteModelSteering';
import { parseGeminiListInventoryJson, type GeminiListInventoryJson } from './listIntentionModel';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

type GeminiExtra = {
  geminiApiKey?: string;
};

function readGeminiExtra(): GeminiExtra {
  return (Constants.expoConfig?.extra ?? {}) as GeminiExtra;
}

function labLog(stage: string, detail?: Record<string, unknown>): void {
  if (detail) {
    console.log(`[GeminiLab] ${stage}`, detail);
    return;
  }
  console.log(`[GeminiLab] ${stage}`);
}

/** Taille en octets du binaire représenté par une chaîne base64 (sans espaces). */
function base64DecodedByteLength(b64: string): number {
  const s = b64.replace(/\s/g, '');
  if (s.length === 0) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

/** Somme des tailles décodées (KB) des parties `inlineData` audio du corps `generateContent`. */
function sumAudioPayloadKbFromGenerateBody(body: unknown): number {
  let bytes = 0;
  const root = body as { contents?: { parts?: unknown[] }[] };
  for (const c of root.contents ?? []) {
    for (const p of c?.parts ?? []) {
      const part = p as { inlineData?: { mimeType?: string; data?: string } };
      const mt = part.inlineData?.mimeType?.toLowerCase() ?? '';
      const data = part.inlineData?.data;
      if (mt.startsWith('audio/') && typeof data === 'string' && data.length > 0) {
        bytes += base64DecodedByteLength(data);
      }
    }
  }
  return bytes / 1024;
}

export function getGeminiApiKey(): string | undefined {
  const fromExtra = readGeminiExtra().geminiApiKey?.trim();
  const fromEnv = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
  const k = fromExtra || fromEnv;
  labLog('apiKey.resolve', {
    fromExtra: Boolean(fromExtra),
    fromEnv: Boolean(fromEnv),
    selected: fromExtra ? 'extra' : fromEnv ? 'env' : 'none',
  });
  return k || undefined;
}

/** Modèle unique piloté par Remote Config (cache démarrage). */
export function getGeminiModelId(): string {
  return getActiveGeminiModelId();
}

export type GeminiLabAnalysis = {
  type: 'habit' | 'task' | 'project';
  frequency: string;
  isComplexProject: boolean;
  reasoning: string;
};

function buildGenerateUrl(modelId: string): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error(
      'Gemini: clé absente. Définis EXPO_PUBLIC_GEMINI_API_KEY dans `.env` à la racine, puis `npx expo prebuild` ou relance Metro avec cache vidé.',
    );
  }
  return `${BASE}/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`;
}

function withLightGenerationConfig(body: object): object {
  const raw = body as { generationConfig?: Record<string, unknown> };
  const generationConfig = raw.generationConfig ?? {};
  return {
    ...raw,
    generationConfig: {
      ...generationConfig,
      // Ultra-low latency (Path B + lab) — les champs explicites l’emportent sur le corps appelant.
      temperature: 0.1,
      topP: 0.1,
      topK: 1,
      candidateCount: 1,
    },
  };
}

function sumTextPayloadCharsFromGenerateBody(body: object): number {
  const contents = (body as { contents?: { parts?: { text?: string }[] }[] }).contents;
  if (!Array.isArray(contents)) return 0;
  let n = 0;
  for (const c of contents) {
    const parts = c?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (p && typeof p.text === 'string') n += p.text.length;
    }
  }
  return n;
}

async function postGenerateContent(body: object, modelOverride?: string): Promise<unknown> {
  const effectiveBody = withLightGenerationConfig(body);
  const audioKb = sumAudioPayloadKbFromGenerateBody(effectiveBody);
  console.log(`[GeminiLab] Audio Payload Size: ${audioKb.toFixed(2)} KB`);
  const textChars = sumTextPayloadCharsFromGenerateBody(effectiveBody);
  if (textChars > 0) {
    console.log(`[GeminiLab] Text Payload Size: ${textChars} chars`);
  }

  const runOnce = async (modelId: string) => {
    const url = buildGenerateUrl(modelId);
    const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
    const tNet0 = perfNowMs();
    labLog('request.start', {
      model: modelId,
      hasOverride: Boolean(modelOverride),
      endpoint: safeUrl,
      tNet0: Math.round(tNet0),
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effectiveBody),
    });
    const text = await res.text();
    const tNet1 = perfNowMs();
    labLog('request.timing', {
      model: modelId,
      ms: Math.round(tNet1 - tNet0),
      status: res.status,
      ok: res.ok,
    });
    labLog('request.response', {
      model: modelId,
      status: res.status,
      ok: res.ok,
      preview: text.slice(0, 220),
    });
    return { res, text, modelId };
  };

  let model = modelOverride || getActiveGeminiModelId();
  let { res, text, modelId } = await runOnce(model);
  if (
    !res.ok &&
    (res.status === 404 || res.status === 503) &&
    !modelOverride
  ) {
    const recovered = await recoverGeminiModelViaListModels();
    if (recovered) {
      ({ res, text, modelId } = await runOnce(recovered));
    }
  }

  if (res.ok) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Gemini: réponse non-JSON (${text.slice(0, 200)})`);
    }
  }

  throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 800)}`);
}

function extractTextFromGenerateResponse(data: unknown): string {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const t = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof t === 'string' ? t.trim() : '';
}

/**
 * Transcription verbatim depuis un fichier audio encodé base64 (ex. .m4a AAC).
 */
export async function geminiTranscribeAudioBase64(
  base64Audio: string,
  mimeType: string = 'audio/mp4',
): Promise<string> {
  if (!base64Audio?.length) {
    throw new Error('Audio base64 vide');
  }
  const data = await postGenerateContent({
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          {
            text:
              'Transcribe this audio into plain text only. Output ONLY the words spoken, in the original language. No preamble, no quotes, no markdown.',
          },
        ],
      },
    ],
  });
  const out = extractTextFromGenerateResponse(data);
  if (!out) {
    throw new Error('Gemini: transcription vide (vérifie le modèle et le format audio)');
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

/**
 * Analyse structurée du texte transcrit (JSON attendu dans la réponse modèle).
 * @param options.promptLanguage Langue des consignes modèle — aligner sur la langue d’interaction (LanguageContext.interactionLanguage) pour des réglages futurs.
 */
export async function geminiAnalyzeIntentTranscript(
  transcript: string,
  options?: { promptLanguage?: GeminiAnalysisPromptLanguage },
): Promise<{ parsed: GeminiLabAnalysis; rawResponseText: string }> {
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  const promptLang: GeminiAnalysisPromptLanguage =
    options?.promptLanguage === 'en' ? 'en' : 'fr';
  const prompt = buildIntentAnalysisPrompt(safe, promptLang);

  const data = await postGenerateContent({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 512,
    },
  });
  const rawResponseText = extractTextFromGenerateResponse(data);
  if (!rawResponseText) {
    throw new Error('Gemini: réponse analyse vide');
  }
  const parsed = parseGeminiAnalysisJson(rawResponseText);
  return { parsed, rawResponseText };
}

/** Schéma unique Talk Deep : projet vs habitude + champs éditables. */
export type GeminiDeepIntention = {
  type: 'habit' | 'project';
  title: string;
  timing: string;
  isComplex: boolean;
};

function buildDeepIntentionPrompt(
  transcriptSlice: string,
  lang: GeminiAnalysisPromptLanguage,
): string {
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

/**
 * Analyse Deep (Talk) : JSON unique { type, title, timing, isComplex } depuis la transcription audio.
 */
export async function geminiDeepIntentionFromTranscript(
  transcript: string,
  options?: { promptLanguage?: GeminiAnalysisPromptLanguage },
): Promise<{ parsed: GeminiDeepIntention; rawResponseText: string }> {
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  const promptLang: GeminiAnalysisPromptLanguage =
    options?.promptLanguage === 'en' ? 'en' : 'fr';
  const prompt = buildDeepIntentionPrompt(safe, promptLang);

  const data = await postGenerateContent({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.12,
      maxOutputTokens: 512,
    },
  });
  const rawResponseText = extractTextFromGenerateResponse(data);
  if (!rawResponseText) {
    throw new Error('Gemini: réponse deep vide');
  }
  const parsed = parseDeepIntentionJson(rawResponseText);
  return { parsed, rawResponseText };
}

/** Groupe renvoyé par Gemini pour le tri sémantique (clés JSON en anglais, titres en langue UI). */
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

function buildMelimeloPrompt(
  lines: string,
  uiLanguage: string,
): string {
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

function parseMelimeloClusterJson(
  raw: string,
  validIds: Set<string>,
  orphanTitle: string,
): MelimeloGeminiGroup[] {
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
      out.push({
        title: orphanTitle,
        icon: 'leaf',
        noteIds: [id],
      });
    }
  }
  return out.filter((g) => g.noteIds.length > 0);
}

/**
 * Regroupe des notes (id + texte brut) via Gemini Flash — JSON thématique.
 */
export async function geminiMelimeloClusterNotes(
  notes: { id: string; text: string }[],
  options: { uiLanguage: string; orphanTitle?: string },
): Promise<{ groups: MelimeloGeminiGroup[]; rawResponseText: string }> {
  if (notes.length === 0) {
    throw new Error('Aucune note à regrouper');
  }
  const validIds = new Set(notes.map((n) => n.id));
  const lines = notes
    .map((n) => {
      const t = n.text.length > 800 ? `${n.text.slice(0, 800)}…` : n.text;
      return `${n.id}\t${JSON.stringify(t)}`;
    })
    .join('\n');
  const prompt = buildMelimeloPrompt(lines, options.uiLanguage);

  const data = await postGenerateContent({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.22,
      maxOutputTokens: 2048,
    },
  });
  const rawResponseText = extractTextFromGenerateResponse(data);
  if (!rawResponseText) {
    throw new Error('Gemini semantic sort: empty response');
  }
  const groups = parseMelimeloClusterJson(
    rawResponseText,
    validIds,
    (options.orphanTitle ?? 'Notes').trim() || 'Notes',
  );
  if (groups.length === 0) {
    throw new Error('Gemini semantic sort: no valid group');
  }
  return { groups, rawResponseText };
}

/**
 * Liste inventaire (courses, matériel, valises) — JSON structuré via Gemini Flash.
 */
export async function geminiListInventoryFromTranscript(
  transcript: string,
  options: { isProContext: boolean; uiLocale: string },
): Promise<{ parsed: GeminiListInventoryJson; rawResponseText: string }> {
  const safe = transcript.length > 10_000 ? transcript.slice(0, 10_000) : transcript;
  const loc = String(options.uiLocale || 'fr').toLowerCase();
  const langHint =
    loc.startsWith('en') ? 'Respond with category names and item names in English.' : '';
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

Rules:
- title: short explicit name (e.g. "Weekly groceries", "Trade show kit").
- baseCount: number of people or portions implied in the dictation (default 1 if unclear).
- unitLabel: short label for what the multiplier scales (e.g. "personne", "guest", "day").
- categories: logical groups (e.g. "Fresh", "Dry goods").
- items: name clear; **baseQuantity** is always the amount for **exactly one** person (or one base unit), never the total for the whole group; unit must be one of: g, kg, piece, cl, l.
- scalable: true if the amount should scale with headcount (ingredients, portions); false for fixed one-off items (e.g. one toothpaste tube for the household).`;

  const data = await postGenerateContent({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.18,
      maxOutputTokens: 2048,
    },
  });
  const rawResponseText = extractTextFromGenerateResponse(data);
  if (!rawResponseText) {
    throw new Error('Gemini: empty list inventory response');
  }
  const parsed = parseGeminiListInventoryJson(rawResponseText);
  return { parsed, rawResponseText };
}

/**
 * Appel **generateContent** avec un seul message utilisateur (prompt texte).
 * Utile pour les flux JSON structurés (ex. one-tap capture).
 *
 * @param prompt — Texte complet du prompt (consignes + contexte).
 * @returns Texte brut du premier candidat (souvent du JSON).
 */
const JSON_EXTRACTOR_PREFIX =
  'You are a JSON extractor. Output ONLY raw JSON. No chat, no markdown.\n\n';

export async function geminiGenerateTextUserPrompt(prompt: string): Promise<string> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) {
    throw new Error('Gemini: prompt vide');
  }
  const t0 = perfNowMs();
  const data = await postGenerateContent({
    contents: [{ parts: [{ text: `${JSON_EXTRACTOR_PREFIX}${trimmed}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 2048,
    },
  });
  const raw = extractTextFromGenerateResponse(data);
  const t1 = perfNowMs();
  labLog('geminiGenerateTextUserPrompt.timing', {
    ms: Math.round(t1 - t0),
    promptChars: trimmed.length,
  });
  if (!raw) {
    throw new Error('Gemini: réponse texte vide');
  }
  return raw;
}

const ONETAP_WIRE_SYSTEM_PREFIX =
  'You compress a voice note into ONE single line. Pipe-separated KEY:value segments. ' +
  'Allowed keys: P (TASK|RECURRING_TASK|HABIT|LIST|ANNIVERSARY|NOTE), K (short domain tag), T (title max 90 chars, never use the pipe character inside values), ' +
  'D (due date YYYY-MM-DD or empty), H (time HH:mm 24h or empty), N (short notes, no pipes), L (LIST only: item names separated by semicolons), ' +
  'A (ANNIVERSARY person name), G (ANNIVERSARY month-day MM-DD or YYYY-MM-DD), C (cadence / habit text), R (recurrence short text). ' +
  'Output ONLY that line: no markdown, no JSON, no line breaks.\n\n';

function buildStreamGenerateUrl(modelId: string): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error(
      'Gemini: clé absente. Définis EXPO_PUBLIC_GEMINI_API_KEY dans `.env` à la racine, puis `npx expo prebuild` ou relance Metro avec cache vidé.',
    );
  }
  return `${BASE}/models/${modelId}:streamGenerateContent?key=${encodeURIComponent(key)}`;
}

function extractStreamedTextDelta(parsed: unknown): string {
  const d = parsed as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = d?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  let s = '';
  for (const p of parts) {
    if (p && typeof p.text === 'string') s += p.text;
  }
  return s;
}

function mergeGeminiStreamTextChunk(accumulated: string, nextPart: string): string {
  const n = nextPart;
  if (!n) return accumulated;
  if (!accumulated) return n;
  if (n.startsWith(accumulated)) return n;
  if (accumulated.startsWith(n)) return accumulated;
  return accumulated + n;
}

async function postStreamGenerateContent(
  body: object,
  onAccumulatedText: (full: string) => void,
  modelOverride?: string,
): Promise<string> {
  const effectiveBody = withLightGenerationConfig(body);
  const openStream = async (modelId: string) => {
    const url = buildStreamGenerateUrl(modelId);
    const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
    labLog('stream.request.start', { model: modelId, endpoint: safeUrl });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effectiveBody),
    });
    return { res, modelId };
  };

  const tNet0 = perfNowMs();
  let model = modelOverride || getActiveGeminiModelId();
  let { res, modelId } = await openStream(model);
  let lastErrBody = '';
  if (!res.ok) {
    lastErrBody = await res.text();
    labLog('stream.request.error', {
      model: modelId,
      status: res.status,
      preview: lastErrBody.slice(0, 220),
    });
    if ((res.status === 404 || res.status === 503) && !modelOverride) {
      const recovered = await recoverGeminiModelViaListModels();
      if (recovered) {
        ({ res, modelId } = await openStream(recovered));
        if (!res.ok) {
          lastErrBody = await res.text();
          labLog('stream.request.error', {
            model: modelId,
            status: res.status,
            preview: lastErrBody.slice(0, 220),
          });
        }
      }
    }
  }
  if (!res.ok) {
    throw new Error(`Gemini stream: HTTP ${res.status}: ${lastErrBody.slice(0, 800)}`);
  }
  model = modelId;
  const reader = res.body?.getReader?.();
  if (!reader) {
    throw new Error('Gemini stream: pas de flux lisible (body)');
  }
  const decoder = new TextDecoder();
  let lineBuf = '';
  let assembled = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuf += decoder.decode(value, { stream: true });
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '').trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload) as unknown;
        const delta = extractStreamedTextDelta(chunk);
        if (delta) {
          assembled = mergeGeminiStreamTextChunk(assembled, delta);
          onAccumulatedText(assembled);
        }
      } catch {
        // ignore malformed SSE JSON
      }
    }
  }
  if (lineBuf.trim()) {
    const line = lineBuf.replace(/\r$/, '').trim();
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (payload && payload !== '[DONE]') {
        try {
          const chunk = JSON.parse(payload) as unknown;
          const delta = extractStreamedTextDelta(chunk);
          if (delta) {
            assembled = mergeGeminiStreamTextChunk(assembled, delta);
            onAccumulatedText(assembled);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  const tNet1 = perfNowMs();
  labLog('stream.request.timing', { model: modelId, ms: Math.round(tNet1 - tNet0), chars: assembled.length });
  const out = assembled.trim();
  if (!out) throw new Error('Gemini stream: réponse vide');
  return out;
}

/**
 * One-tap « filaire » : une ligne compacte (pas de JSON) — latence et parsing réduits.
 */
export async function geminiGenerateOneTapCompressedLine(prompt: string): Promise<string> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) throw new Error('Gemini: prompt vide');
  const t0 = perfNowMs();
  const data = await postGenerateContent({
    contents: [{ parts: [{ text: `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}` }] }],
    generationConfig: {
      maxOutputTokens: 256,
    },
  });
  const raw = extractTextFromGenerateResponse(data).replace(/\s+/g, ' ').trim();
  const t1 = perfNowMs();
  labLog('geminiGenerateOneTapCompressedLine.timing', {
    ms: Math.round(t1 - t0),
    promptChars: trimmed.length,
    outChars: raw.length,
  });
  if (!raw) throw new Error('Gemini: réponse filaire vide');
  return raw;
}

/**
 * Même contrat que {@link geminiGenerateOneTapCompressedLine} avec tokens incrémentaux (UI optimiste).
 */
export async function geminiStreamOneTapCompressedLine(
  prompt: string,
  onAccumulatedText: (full: string) => void,
): Promise<string> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) throw new Error('Gemini: prompt vide');
  const t0 = perfNowMs();
  const out = await postStreamGenerateContent(
    {
      contents: [{ parts: [{ text: `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}` }] }],
      generationConfig: {
        maxOutputTokens: 256,
      },
    },
    onAccumulatedText,
  );
  const t1 = perfNowMs();
  labLog('geminiStreamOneTapCompressedLine.timing', {
    ms: Math.round(t1 - t0),
    promptChars: trimmed.length,
    outChars: out.length,
  });
  return out.replace(/\s+/g, ' ').trim();
}
