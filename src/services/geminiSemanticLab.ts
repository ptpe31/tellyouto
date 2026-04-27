/**
 * **Gemini Lab** — appels HTTP directs vers `generativelanguage.googleapis.com/v1` (REST).
 *
 * ## Résolution du modèle
 * Tous les chemins passent par {@link getActiveGeminiModelId} sauf **override** explicite (`modelOverride` sur certains appels).
 * Le modèle actif est piloté par {@link geminiRemoteModelSteering} (Remote Config + secours 24h).
 *
 * ## Self-healing réseau
 * Sur **404** ou **503** sur `generateContent` ou sur l’ouverture du stream, le module appelle
 * {@link recoverGeminiModelViaListModels} puis **réessaie une fois** avec le nouvel id (sans `modelOverride`).
 *
 * ## Génération « légère »
 * {@link withLightGenerationConfig} force `temperature` / `topP` / `topK` / `candidateCount` bas pour limiter la charge
 * (aligné avec les règles produit Gemini).
 *
 * ## One-tap (dual-path côté orchestration)
 * Les entrées **filaire** (`geminiGenerateOneTapCompressedLine`) et **streaming** (`geminiStreamOneTapCompressedLine`)
 * alimentent le **Path B** décrit dans {@link oneTapUniversalCapture} (`refineOneTapWithGeminiCompressed`).
 *
 * ## Logs terminal (Metro)
 * Chaque réponse HTTP aboutie : **`[GeminiAPI] 🚀 CALL_SUCCESS`** ou **`❌ CALL_ERROR`** (modèle, latence, FallbackUsed, v1, operation).
 * **Path B one-tap** : succès HTTP différé — après fusion filaire, **`[GeminiAPI] ✅ CALL_SUCCESS`** avec `Category` / `Entities` (voir {@link logGeminiApiPathBResolvedSuccess}) ; les erreurs incluent `PathA_Fallback_Category` / `PathA_Entities`.
 *
 * @module geminiSemanticLab
 */

import Constants from 'expo-constants';

import {
  getActiveGeminiModelId,
  getGeminiCandidateModelIds,
  excludeGeminiModelForSession,
  setGeminiActiveModelForSession,
  persistValidatedGeminiModelId,
  recoverGeminiModelViaListModelsExcluding,
} from './geminiRemoteModelSteering';
import { parseGeminiListInventoryJson, type GeminiListInventoryJson } from './listIntentionModel';

const BASE_V1 = 'https://generativelanguage.googleapis.com/v1';
const BASE_V1BETA = 'https://generativelanguage.googleapis.com/v1beta';

/** Lignes de détail des blocs `[GeminiAPI]` — même indentation que `[OneTap]` / `[OneTapPerf]`. */
const GLOG = '\n  | ';

/** Ancrage Path A passé aux logs Gemini pour l’affinage one-tap (Path B). */
export type GeminiPathBLogAnchor = {
  pathACategoryTag: string;
  pathAPredictedType: string;
  pathAData: Record<string, unknown>;
};

/** Métadonnées HTTP une fois la requête Path B terminée (avant fusion intention). */
export type GeminiHttpSettledMeta = {
  modelId: string;
  latencyMs: number;
  fallbackUsed: boolean;
  operation: string;
  versionLabel: string;
};

function getGeminiApiMetaForModel(modelId: string): { base: string; versionLabel: string } {
  if (/^gemini-(?:2|3)\./i.test(modelId)) return { base: BASE_V1BETA, versionLabel: 'v1beta' };
  if (/-latest$/i.test(modelId)) return { base: BASE_V1BETA, versionLabel: 'v1beta' };
  return { base: BASE_V1, versionLabel: 'v1' };
}

type PostGeminiHttpOptions = {
  pathBLog?: GeminiPathBLogAnchor;
  onHttpSuccessMeta?: (m: GeminiHttpSettledMeta) => void;
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

function logGeminiApiCallSuccess(params: {
  modelId: string;
  latencyMs: number;
  fallbackUsed: boolean;
  operation: string;
  versionLabel: string;
}): void {
  const fb = params.fallbackUsed ? 'YES' : 'NO';
  console.log(
    `[GeminiAPI] 🚀 CALL_SUCCESS${GLOG}Model: ${params.modelId}${GLOG}Latency: ${params.latencyMs}ms${GLOG}FallbackUsed: ${fb}${GLOG}Version: ${params.versionLabel}${GLOG}Operation: ${params.operation}`,
  );
}

/**
 * Log unique après parsing filaire Path B — intention fusionnée (catégorie + entités).
 * @remarks À appeler depuis {@link refineOneTapWithGeminiCompressed} une fois {@link mergeWireIntoOneTapSkeleton} appliqué.
 */
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

function logGeminiApiCallError(params: {
  modelId: string;
  latencyMs: number;
  fallbackUsed: boolean;
  operation: string;
  versionLabel: string;
  httpStatus?: number;
  reason?: string;
  pathBAnchor?: GeminiPathBLogAnchor;
}): void {
  const fb = params.fallbackUsed ? 'YES' : 'NO';
  const http = params.httpStatus != null ? `${GLOG}HTTP: ${params.httpStatus}` : '';
  const reason = params.reason ? `${GLOG}Reason: ${params.reason.slice(0, 200)}` : '';
  const pathA =
    params.pathBAnchor != null
      ? `${GLOG}PathA_Fallback_Category: ${params.pathBAnchor.pathACategoryTag}${GLOG}PathA_Entities: ${safeJsonForTerminalLog(params.pathBAnchor.pathAData, 600)}`
      : '';
  console.log(
    `[GeminiAPI] ❌ CALL_ERROR${GLOG}Model: ${params.modelId}${GLOG}Latency: ${params.latencyMs}ms${GLOG}FallbackUsed: ${fb}${GLOG}Version: ${params.versionLabel}${GLOG}Operation: ${params.operation}${http}${reason}${pathA}`,
  );
}

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

/**
 * Résout la clé API : `expo.extra.geminiApiKey` (EAS / app.config) puis `process.env.EXPO_PUBLIC_GEMINI_API_KEY`.
 */
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

function buildGenerateUrl(modelId: string, traceOperation?: string): string {
  const { base } = traceOperation?.startsWith('oneTap.wire') ? { base: BASE_V1BETA } : getGeminiApiMetaForModel(modelId);
  const key = getGeminiApiKey();
  if (!key) {
    console.error('[GeminiLab] API Key missing (EXPO_PUBLIC_GEMINI_API_KEY). Skipping Gemini calls.');
    return `${base}/models/${modelId}:generateContent`;
  }
  return `${base}/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`;
}

/**
 * Fusionne une config de génération « légère » (latence / coût) dans le corps `generateContent` / stream.
 */
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

function enforceOneTapMaxOutputTokens(body: object, traceOperation: string): object {
  if (!traceOperation.startsWith('oneTap.wire')) return body;
  const raw = body as { generationConfig?: Record<string, unknown> };
  const generationConfig = raw.generationConfig ?? {};
  const current = Number(generationConfig.maxOutputTokens ?? 0);
  const wanted = 800;
  const next = Number.isFinite(current) ? Math.max(wanted, current) : wanted;
  if (current !== next) {
    labLog('oneTap.maxOutputTokens.enforced', { from: current, to: next });
  }
  return {
    ...raw,
    generationConfig: {
      ...generationConfig,
      maxOutputTokens: next,
    },
  };
}

function computeGeminiIsFallback(_: string, usedRecoverRetry: boolean): boolean {
  return usedRecoverRetry;
}

function isModelTemporarilyUnavailable(status: number): boolean {
  return status === 503;
}

function isModelNotSupported(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const t = bodyText.toLowerCase();
  if (!t) return false;
  return (
    (t.includes('model') && t.includes('not found')) ||
    t.includes('not supported') ||
    t.includes('unsupported') ||
    t.includes('unknown model')
  );
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

/**
 * POST `generateContent` avec une passe de **self-healing** si 404/503 et pas d’override forcé.
 *
 * @param body — Corps JSON Gemini (contents + generationConfig optionnel).
 * @param modelOverride — Si défini, contourne le cache steering (tests ciblés) ; le self-heal ne s’applique pas.
 * @param traceOperation — Libellé pour les logs terminal `[GeminiAPI]`.
 * @param options.pathBLog — Si défini : erreurs enrichies (Path A) ; succès HTTP sans log immédiat (résolu après fusion dans {@link logGeminiApiPathBResolvedSuccess}).
 */
async function postGenerateContent(
  body: object,
  modelOverride?: string,
  traceOperation = 'generateContent.generic',
  options?: PostGeminiHttpOptions,
): Promise<unknown> {
  const effectiveBody = enforceOneTapMaxOutputTokens(withLightGenerationConfig(body), traceOperation);
  const audioKb = sumAudioPayloadKbFromGenerateBody(effectiveBody);
  console.log(`[GeminiLab] Audio Payload Size: ${audioKb.toFixed(2)} KB`);
  const textChars = sumTextPayloadCharsFromGenerateBody(effectiveBody);
  if (textChars > 0) {
    console.log(`[GeminiLab] Text Payload Size: ${textChars} chars`);
  }

  const runOnce = async (modelId: string) => {
    const url = buildGenerateUrl(modelId, traceOperation);
    const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
    const tNet0 = perfNowMs();
    labLog('request.start', {
      model: modelId,
      hasOverride: Boolean(modelOverride),
      endpoint: safeUrl,
      tNet0: Math.round(tNet0),
    });
    labLog('FINAL_URL', { model: modelId, endpoint: safeUrl, operation: traceOperation });
    if (traceOperation.startsWith('oneTap.wire')) {
      const gc = (effectiveBody as { generationConfig?: Record<string, unknown> }).generationConfig ?? {};
      labLog('oneTap.generationConfig', { model: modelId, ...gc });
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effectiveBody),
    });
    const text = await res.text();
    const tNet1 = perfNowMs();
    const latencyMs = Math.round(tNet1 - tNet0);
    labLog('request.timing', {
      model: modelId,
      ms: latencyMs,
      status: res.status,
      ok: res.ok,
    });
    labLog('request.response', {
      model: modelId,
      status: res.status,
      ok: res.ok,
      preview: text.slice(0, 220),
    });
    return { res, text, modelId, latencyMs };
  };

  const candidates = modelOverride ? [modelOverride] : getGeminiCandidateModelIds();
  const usedModels: string[] = [];
  let usedRecoverRetry = false;
  let usedTempFallback = false;
  let exhaustedUnsupported = false;
  let last = await runOnce(candidates[0]);
  usedModels.push(last.modelId);
  for (let i = 0; i < candidates.length && !last.res.ok; i += 1) {
    const candidate = candidates[i];
    if (i > 0) {
      last = await runOnce(candidate);
      usedModels.push(last.modelId);
    }
    if (last.res.ok) break;
    if (!modelOverride && isModelNotSupported(last.res.status, last.text)) {
      if (i === candidates.length - 1) exhaustedUnsupported = true;
      continue;
    }
    if (!modelOverride && isModelTemporarilyUnavailable(last.res.status)) {
      usedTempFallback = true;
      excludeGeminiModelForSession(last.modelId);
      continue;
    }
    break;
  }
  if (!last.res.ok && !modelOverride && exhaustedUnsupported) {
    const discovered = await recoverGeminiModelViaListModelsExcluding(usedModels);
    if (discovered) {
      usedRecoverRetry = true;
      last = await runOnce(discovered);
      usedModels.push(discovered);
    }
  }
  const { res, text, modelId, latencyMs } = last;
  if (!modelOverride && res.ok) {
    usedRecoverRetry = usedModels[0] !== modelId || usedRecoverRetry || usedTempFallback;
    if (usedTempFallback) {
      setGeminiActiveModelForSession(modelId);
    } else {
      void persistValidatedGeminiModelId(modelId);
    }
  }
  const versionLabel = getGeminiApiMetaForModel(modelId).versionLabel;

  if (res.ok) {
    try {
      const data = JSON.parse(text) as unknown;
      const fb = computeGeminiIsFallback(modelId, usedRecoverRetry);
      const meta: GeminiHttpSettledMeta = {
        modelId,
        latencyMs,
        fallbackUsed: fb,
        operation: traceOperation,
        versionLabel,
      };
      if (options?.pathBLog) {
        options.onHttpSuccessMeta?.(meta);
      } else {
        logGeminiApiCallSuccess(meta);
      }
      return data;
    } catch {
      logGeminiApiCallError({
        modelId,
        latencyMs,
        fallbackUsed: computeGeminiIsFallback(modelId, usedRecoverRetry),
        operation: traceOperation,
        versionLabel,
        reason: 'non-JSON response body',
        pathBAnchor: options?.pathBLog,
      });
      throw new Error(`Gemini: réponse non-JSON (${text.slice(0, 200)})`);
    }
  }

  logGeminiApiCallError({
    modelId,
    latencyMs,
    fallbackUsed: usedRecoverRetry,
    operation: traceOperation,
    versionLabel,
    httpStatus: res.status,
    reason: text.slice(0, 300),
    pathBAnchor: options?.pathBLog,
  });
  throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 800)}`);
}

function extractTextFromGenerateResponse(data: unknown): string {
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
  const data = await postGenerateContent(
    {
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
    },
    undefined,
    'lab.transcribe_audio',
  );
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

  const data = await postGenerateContent(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 512,
      },
    },
    undefined,
    'lab.analyze_intent',
  );
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

  const data = await postGenerateContent(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.12,
        maxOutputTokens: 512,
      },
    },
    undefined,
    'lab.deep_intention',
  );
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

  const data = await postGenerateContent(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.18,
        maxOutputTokens: 2048,
      },
    },
    undefined,
    'lab.list_inventory',
  );
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

/**
 * JSON structuré via `responseMimeType: application/json` — utilisé par certains flux analyse (hors one-tap filaire).
 */
export async function geminiGenerateTextUserPrompt(prompt: string): Promise<string> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) {
    throw new Error('Gemini: prompt vide');
  }
  const t0 = perfNowMs();
  const data = await postGenerateContent(
    {
      contents: [{ parts: [{ text: `${JSON_EXTRACTOR_PREFIX}${trimmed}` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    },
    undefined,
    'lab.generate_text_user_prompt',
  );
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
  'You convert a voice note into a JSON array of intent objects. ' +
  'Output MUST be a single valid JSON array only (no markdown, no fences, no prose, no line breaks outside JSON). ' +
  'Each object MUST include a "type" field with one of: TASK, LIST, HABIT, TRIP, NOTE. ' +
  'TASK fields: "content" (string), optional "due" (ISO 8601 date-time string), optional "notes" (string), optional "category" (short tag). ' +
  'LIST fields: "title" (string), "baseCount" (number), "unitLabel" (string), "items" (array of objects). ' +
  'Each LIST item object fields: "name" (string), "baseQuantity" (number), "unit" (string), "scalable" (boolean). ' +
  'If the user mentions servings/people count (e.g. "pour 6 personnes"), set baseCount=6 and unitLabel="personnes". If not mentioned, default baseCount=1, unitLabel="personne". ' +
  'Always set scalable=true for ingredients that scale with baseCount (most ingredients), scalable=false for items that should not scale (e.g. "1 four", "une casserole"). ' +
  'HABIT fields: "content" (string), optional "recurrence" (string), optional "preferredTime" (HH:mm), optional "category". ' +
  'TRIP fields: "destination" (string), optional "address" (string), optional "placeId" (string), optional "lat" (number), optional "lng" (number), optional "arrivalDue" (ISO 8601 date-time), optional "category". ' +
  'NOTE fields: "content" (string), optional "category".\n\n';

function buildStreamGenerateUrl(modelId: string, traceOperation?: string): string {
  const { base } = traceOperation?.startsWith('oneTap.wire') ? { base: BASE_V1BETA } : getGeminiApiMetaForModel(modelId);
  const key = getGeminiApiKey();
  if (!key) {
    console.error('[GeminiLab] API Key missing (EXPO_PUBLIC_GEMINI_API_KEY). Skipping Gemini calls.');
    return `${base}/models/${modelId}:streamGenerateContent`;
  }
  return `${base}/models/${modelId}:streamGenerateContent?key=${encodeURIComponent(key)}`;
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

/**
 * POST `streamGenerateContent` (SSE). Lit le corps d’erreur une seule fois avant retry après self-heal.
 *
 * @param onAccumulatedText — Callback à chaque fragment de texte utile (UI optimiste).
 * @param modelOverride — Comportement identique à {@link postGenerateContent}.
 * @param traceOperation — Libellé pour les logs `[GeminiAPI]`.
 * @param options — Même sémantique que {@link postGenerateContent} (Path B).
 */
async function postStreamGenerateContent(
  body: object,
  onAccumulatedText: (full: string) => void,
  modelOverride?: string,
  traceOperation = 'streamGenerateContent.generic',
  options?: PostGeminiHttpOptions,
): Promise<string> {
  const effectiveBody = enforceOneTapMaxOutputTokens(withLightGenerationConfig(body), traceOperation);
  const openStream = async (modelId: string) => {
    const url = buildStreamGenerateUrl(modelId, traceOperation);
    const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
    labLog('stream.request.start', { model: modelId, endpoint: safeUrl });
    labLog('FINAL_URL', { model: modelId, endpoint: safeUrl, operation: traceOperation });
    if (traceOperation.startsWith('oneTap.wire')) {
      const gc = (effectiveBody as { generationConfig?: Record<string, unknown> }).generationConfig ?? {};
      labLog('oneTap.generationConfig', { model: modelId, ...gc });
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effectiveBody),
    });
    return { res, modelId };
  };

  const candidates = modelOverride ? [modelOverride] : getGeminiCandidateModelIds();
  const usedModels: string[] = [];
  let lastErrBody = '';
  let usedRecoverRetry = false;
  let usedTempFallback = false;
  let exhaustedUnsupported = false;
  let { res, modelId } = await openStream(candidates[0]);
  usedModels.push(modelId);
  if (!res.ok) {
    lastErrBody = await res.text();
    labLog('stream.request.error', {
      model: modelId,
      status: res.status,
      preview: lastErrBody.slice(0, 220),
    });
  }
  for (let i = 0; i < candidates.length && !res.ok; i += 1) {
    const candidate = candidates[i];
    if (i > 0) {
      ({ res, modelId } = await openStream(candidate));
      usedModels.push(modelId);
      if (!res.ok) {
        lastErrBody = await res.text();
        labLog('stream.request.error', {
          model: modelId,
          status: res.status,
          preview: lastErrBody.slice(0, 220),
        });
      }
    }
    if (res.ok) break;
    if (!modelOverride && isModelNotSupported(res.status, lastErrBody)) {
      if (i === candidates.length - 1) exhaustedUnsupported = true;
      continue;
    }
    if (!modelOverride && isModelTemporarilyUnavailable(res.status)) {
      usedTempFallback = true;
      excludeGeminiModelForSession(modelId);
      continue;
    }
    break;
  }
  if (!res.ok && !modelOverride && exhaustedUnsupported) {
    const discovered = await recoverGeminiModelViaListModelsExcluding(usedModels);
    if (discovered) {
      usedRecoverRetry = true;
      ({ res, modelId } = await openStream(discovered));
      usedModels.push(discovered);
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
  if (!res.ok) {
    const versionLabel = getGeminiApiMetaForModel(modelId).versionLabel;
    logGeminiApiCallError({
      modelId,
      latencyMs: 0,
      fallbackUsed: usedRecoverRetry,
      operation: traceOperation,
      versionLabel,
      httpStatus: res.status,
      reason: lastErrBody.slice(0, 300),
    });
    throw new Error(`Gemini stream: HTTP ${res.status}: ${lastErrBody.slice(0, 800)}`);
  }
  if (!modelOverride) {
    usedRecoverRetry = usedModels[0] !== modelId || usedRecoverRetry || usedTempFallback;
    if (usedTempFallback) {
      setGeminiActiveModelForSession(modelId);
    } else {
      void persistValidatedGeminiModelId(modelId);
    }
  }
  let model = modelId;
  const reader = res.body?.getReader?.();
  if (!reader) {
    const versionLabel = getGeminiApiMetaForModel(modelId).versionLabel;
    // Préviews / RN sans corps lisible → repli non-stream generateContent (même modèle), ex. Gemini 3.1 preview.
    labLog('stream.antistream_fallback', {
      model: modelId,
      reason: 'no readable stream body',
      operation: traceOperation,
      version: versionLabel,
    });
    console.log(
      `[GeminiAPI] 🔁 ANTISTREAM_FALLBACK${GLOG}Model: ${modelId}${GLOG}Reason: no readable stream body${GLOG}Version: ${versionLabel}${GLOG}Operation: ${traceOperation}`,
    );
    const tAntistream0 = perfNowMs();
    const data = await postGenerateContent(
      body,
      modelId,
      `${traceOperation}.antistream_fallback`,
      options,
    );
    const raw = extractTextFromGenerateResponse(data).replace(/\s+/g, ' ').trim();
    const tAntistream1 = perfNowMs();
    if (!raw) {
      logGeminiApiCallError({
        modelId,
        latencyMs: Math.round(tAntistream1 - tAntistream0),
        fallbackUsed: computeGeminiIsFallback(modelId, usedRecoverRetry),
        operation: traceOperation,
        versionLabel,
        reason: 'no readable stream body → generateContent empty',
        pathBAnchor: options?.pathBLog,
      });
      throw new Error('Gemini stream: pas de flux lisible et réponse non-stream vide');
    }
    onAccumulatedText(raw);
    labLog('stream.antistream_fallback.timing', {
      model: modelId,
      ms: Math.round(tAntistream1 - tAntistream0),
      outChars: raw.length,
    });
    return raw;
  }
  const streamBodyStart = perfNowMs();
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
  const streamBodyEnd = perfNowMs();
  const streamLatencyMs = Math.round(streamBodyEnd - streamBodyStart);
  labLog('stream.request.timing', { model: modelId, ms: streamLatencyMs, chars: assembled.length });
  const out = assembled.trim();
  if (!out) {
    const versionLabel = getGeminiApiMetaForModel(modelId).versionLabel;
    logGeminiApiCallError({
      modelId,
      latencyMs: streamLatencyMs,
      fallbackUsed: computeGeminiIsFallback(modelId, usedRecoverRetry),
      operation: traceOperation,
      versionLabel,
      reason: 'empty stream text',
      pathBAnchor: options?.pathBLog,
    });
    throw new Error('Gemini stream: réponse vide');
  }
  const streamFb = computeGeminiIsFallback(modelId, usedRecoverRetry);
  const versionLabel = getGeminiApiMetaForModel(modelId).versionLabel;
  const streamMeta: GeminiHttpSettledMeta = {
    modelId,
    latencyMs: streamLatencyMs,
    fallbackUsed: streamFb,
    operation: traceOperation,
    versionLabel,
  };
  if (options?.pathBLog) {
    options.onHttpSuccessMeta?.(streamMeta);
  } else {
    logGeminiApiCallSuccess(streamMeta);
  }
  return out;
}

/**
 * **Path B (non stream)** — une ligne `KEY:value|…` pour l’affinage one-tap (voir préfixe système dans le fichier).
 * Utilisé quand `useStream: false` dans {@link refineOneTapWithGeminiCompressed}.
 */
export async function geminiGenerateOneTapCompressedLine(
  prompt: string,
  pathBLog?: GeminiPathBLogAnchor,
): Promise<{ raw: string; httpMeta: GeminiHttpSettledMeta | undefined }> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) throw new Error('Gemini: prompt vide');
  if (process.env.EXPO_PUBLIC_GEMINI_DEBUG_PROMPT === '1') {
    const full = `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}`;
    console.log(`[GeminiLab] oneTap.prompt.full\n${full}`);
  }
  const t0 = perfNowMs();
  let httpMeta: GeminiHttpSettledMeta | undefined;
  const data = await postGenerateContent(
    {
      contents: [{ parts: [{ text: `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}` }] }],
      generationConfig: {
        maxOutputTokens: 800,
      },
    },
    undefined,
    'oneTap.wire.nonstream',
    pathBLog
      ? {
          pathBLog,
          onHttpSuccessMeta: (m) => {
            httpMeta = m;
          },
        }
      : undefined,
  );
  const raw = extractTextFromGenerateResponse(data).replace(/\s+/g, ' ').trim();
  if (__DEV__ || process.env.EXPO_PUBLIC_GEMINI_DEBUG_PROMPT === '1') {
    const d = data as {
      candidates?: { finishReason?: unknown; content?: { parts?: { text?: unknown }[] } }[];
    };
    const c0 = d?.candidates?.[0];
    const parts = Array.isArray(c0?.content?.parts) ? c0?.content?.parts ?? [] : [];
    const texts = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).filter(Boolean);
    console.log('[GeminiLab] oneTap.response.debug', {
      finishReason: String(c0?.finishReason ?? ''),
      partsCount: texts.length,
      partsChars: texts.map((t) => t.length),
      joinedChars: texts.join('').length,
    });
  }
  const t1 = perfNowMs();
  labLog('geminiGenerateOneTapCompressedLine.timing', {
    ms: Math.round(t1 - t0),
    promptChars: trimmed.length,
    outChars: raw.length,
  });
  if (!raw) throw new Error('Gemini: réponse filaire vide');
  return { raw, httpMeta };
}

/**
 * **Path B (stream)** — même contrat que {@link geminiGenerateOneTapCompressedLine} avec tokens incrémentaux
 * (`onAccumulatedText`) pour mettre à jour la modale one-tap avant la fin du flux réseau.
 */
export async function geminiStreamOneTapCompressedLine(
  prompt: string,
  onAccumulatedText: (full: string) => void,
  pathBLog?: GeminiPathBLogAnchor,
): Promise<{ raw: string; httpMeta: GeminiHttpSettledMeta | undefined }> {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) throw new Error('Gemini: prompt vide');
  if (process.env.EXPO_PUBLIC_GEMINI_DEBUG_PROMPT === '1') {
    const full = `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}`;
    console.log(`[GeminiLab] oneTap.prompt.full\n${full}`);
  }
  const t0 = perfNowMs();
  let httpMeta: GeminiHttpSettledMeta | undefined;
  const out = await postStreamGenerateContent(
    {
      contents: [{ parts: [{ text: `${ONETAP_WIRE_SYSTEM_PREFIX}${trimmed}` }] }],
      generationConfig: {
        maxOutputTokens: 800,
      },
    },
    onAccumulatedText,
    undefined,
    'oneTap.wire.stream',
    pathBLog
      ? {
          pathBLog,
          onHttpSuccessMeta: (m) => {
            httpMeta = m;
          },
        }
      : undefined,
  );
  const t1 = perfNowMs();
  labLog('geminiStreamOneTapCompressedLine.timing', {
    ms: Math.round(t1 - t0),
    promptChars: trimmed.length,
    outChars: out.length,
  });
  return { raw: out.replace(/\s+/g, ' ').trim(), httpMeta };
}
