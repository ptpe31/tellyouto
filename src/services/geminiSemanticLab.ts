/**
 * Appels directs Google AI (Gemini Flash) pour le lab sémantique.
 * Clé : EXPO_PUBLIC_GEMINI_API_KEY — réservée aux builds de test (exposée client).
 * Modèle : EXPO_PUBLIC_GEMINI_MODEL (défaut gemini-2.0-flash).
 */

const DEFAULT_MODEL = 'gemini-2.0-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function getGeminiApiKey(): string | undefined {
  const k = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
  return k || undefined;
}

export function getGeminiModelId(): string {
  return process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export type GeminiLabAnalysis = {
  type: 'habit' | 'task' | 'project';
  frequency: string;
  isComplexProject: boolean;
  reasoning: string;
};

function buildGenerateUrl(): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error('EXPO_PUBLIC_GEMINI_API_KEY manquant');
  }
  const model = getGeminiModelId();
  return `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
}

async function postGenerateContent(body: object): Promise<unknown> {
  const url = buildGenerateUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Gemini: réponse non-JSON (${text.slice(0, 200)})`);
  }
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
