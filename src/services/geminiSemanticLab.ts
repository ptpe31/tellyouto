/**
 * Appels directs Google AI (Gemini Flash) pour le lab sémantique.
 * Clé : EXPO_PUBLIC_GEMINI_API_KEY — réservée aux builds de test (exposée client).
 * Modèle : EXPO_PUBLIC_GEMINI_MODEL (défaut gemini-1.5-flash-latest).
 *
 * Résolution : `expo.extra` (injecté par app.config.js depuis .env / env) puis process.env.
 */

import Constants from 'expo-constants';

import { parseGeminiListInventoryJson, type GeminiListInventoryJson } from './listIntentionModel';

const DEFAULT_MODEL = 'gemini-1.5-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
] as const;

type GeminiExtra = {
  geminiApiKey?: string;
  geminiModel?: string;
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

export function getGeminiModelId(): string {
  const fromExtra = readGeminiExtra().geminiModel?.trim();
  const fromEnv = process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim();
  const configured = fromExtra || fromEnv;
  if (!configured) {
    labLog('model.resolve', {
      fromExtra: fromExtra || null,
      fromEnv: fromEnv || null,
      resolved: DEFAULT_MODEL,
      reason: 'no_configured_model',
    });
    return DEFAULT_MODEL;
  }
  // Gemini 2.0 Flash can be unavailable for new/free accounts.
  if (configured.includes('gemini-2.0-flash')) {
    labLog('model.resolve', {
      fromExtra: fromExtra || null,
      fromEnv: fromEnv || null,
      resolved: DEFAULT_MODEL,
      reason: 'configured_model_is_2_0_flash',
    });
    return DEFAULT_MODEL;
  }
  labLog('model.resolve', {
    fromExtra: fromExtra || null,
    fromEnv: fromEnv || null,
    resolved: configured,
    reason: 'configured_model',
  });
  return configured;
}

export type GeminiLabAnalysis = {
  type: 'habit' | 'task' | 'project';
  frequency: string;
  isComplexProject: boolean;
  reasoning: string;
};

function buildGenerateUrl(modelOverride?: string): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error(
      'Gemini: clé absente. Définis EXPO_PUBLIC_GEMINI_API_KEY dans .env ou env à la racine, puis `npx expo prebuild` ou relance Metro avec cache vidé.',
    );
  }
  const model = modelOverride || getGeminiModelId();
  return `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
}

type GeminiModelsListResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
};

let cachedGenerateContentModels: string[] | null = null;

async function listGenerateContentModels(): Promise<string[]> {
  if (cachedGenerateContentModels) return cachedGenerateContentModels;
  const key = getGeminiApiKey();
  if (!key) return [];
  const url = `${BASE}/models?key=${encodeURIComponent(key)}`;
  const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
  try {
    labLog('models.list.start', { endpoint: safeUrl });
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      labLog('models.list.error', {
        status: res.status,
        preview: text.slice(0, 220),
      });
      return [];
    }
    const parsed = JSON.parse(text) as GeminiModelsListResponse;
    const models = (parsed.models ?? [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods))
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, '').trim())
      .filter(Boolean);
    cachedGenerateContentModels = Array.from(new Set(models));
    labLog('models.list.success', {
      count: cachedGenerateContentModels.length,
      sample: cachedGenerateContentModels.slice(0, 10),
    });
    return cachedGenerateContentModels;
  } catch (error) {
    labLog('models.list.exception', {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function computeModelCandidates(modelOverride?: string): Promise<string[]> {
  const configured = modelOverride || getGeminiModelId();
  const preferred = [configured, DEFAULT_MODEL, ...FALLBACK_MODELS];
  const available = await listGenerateContentModels();
  if (!available.length) {
    return Array.from(new Set(preferred));
  }
  const preferredAvailable = preferred.filter((m) => available.includes(m));
  const full = [...preferredAvailable, ...available];
  return Array.from(new Set(full));
}

async function postGenerateContent(body: object, modelOverride?: string): Promise<unknown> {
  const candidates = await computeModelCandidates(modelOverride);
  let lastError: Error | null = null;

  for (const model of candidates) {
    const url = buildGenerateUrl(model);
    const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
    labLog('request.start', {
      model,
      hasOverride: Boolean(modelOverride),
      endpoint: safeUrl,
      candidateCount: candidates.length,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    labLog('request.response', {
      model,
      status: res.status,
      ok: res.ok,
      preview: text.slice(0, 220),
    });

    if (res.ok) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Gemini: réponse non-JSON (${text.slice(0, 200)})`);
      }
    }

    const looksLikeMissingModel =
      res.status === 404 &&
      (text.includes('is no longer available to new users') ||
        text.includes('NOT_FOUND') ||
        text.includes('models/'));
    if (looksLikeMissingModel) {
      labLog('request.retry_fallback', {
        fromModel: model,
        status: res.status,
      });
      lastError = new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 800)}`);
      continue;
    }
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 800)}`);
  }

  throw (
    lastError ||
    new Error(
      `Gemini: aucun modèle compatible generateContent trouvé (candidats testés: ${candidates.join(', ')})`,
    )
  );
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
{"title": string, "baseCount": number, "unitLabel": string, "categories": [{"name": string, "items": [{"name": string, "qty": number, "unit": string, "scalable": boolean}]}]}

Rules:
- title: short explicit name (e.g. "Weekly groceries", "Trade show kit").
- baseCount: usually 1 (reference headcount or base unit for the list).
- unitLabel: short label for what the multiplier scales (e.g. "personne", "guest", "day").
- categories: logical groups (e.g. "Fresh", "Dry goods").
- items: name clear; qty is quantity for ONE base unit; unit must be one of: g, kg, piece, cl, l.
- scalable: true if quantity should scale when the user changes the multiplier (e.g. pasta portions); false for fixed items (e.g. toothpaste tube).`;

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
