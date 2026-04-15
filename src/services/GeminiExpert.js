/**
 * Expert Gemini (fallback robuste) via API REST v1beta.
 * Clé : process.env.EXPO_PUBLIC_GEMINI_API_KEY
 */

const DEFAULT_MODEL = 'gemini-1.5-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

function log(stage, detail) {
  const line = `[GeminiExpert] ${stage}`;
  if (detail !== undefined) {
    // Évite de logger des clés : ne jamais passer l’API key ici.
    console.log(line, detail);
  } else {
    console.log(line);
  }
}

function getApiKey() {
  const k = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
  log('apiKey.resolve', {
    fromEnv: Boolean(k),
    selected: k ? 'env' : 'none',
  });
  if (!k) {
    log('init.error', { ok: false, reason: 'EXPO_PUBLIC_GEMINI_API_KEY absente' });
    throw new Error(
      'GeminiExpert: définis EXPO_PUBLIC_GEMINI_API_KEY dans .env (voir env.example).',
    );
  }
  return k;
}

function getModelId() {
  const configured = process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim();
  if (!configured) {
    log('model.resolve', {
      fromEnv: null,
      resolved: DEFAULT_MODEL,
      reason: 'no_configured_model',
    });
    return DEFAULT_MODEL;
  }
  // Gemini 2.0 Flash can be unavailable for new/free accounts: force stable fallback.
  if (configured.includes('gemini-2.0-flash')) {
    log('model.resolve', {
      fromEnv: configured,
      resolved: DEFAULT_MODEL,
      reason: 'configured_model_is_2_0_flash',
    });
    return DEFAULT_MODEL;
  }
  log('model.resolve', {
    fromEnv: configured,
    resolved: configured,
    reason: 'configured_model',
  });
  return configured;
}

let cachedGenerateContentModels = null;

async function listGenerateContentModels(apiKey) {
  if (cachedGenerateContentModels) return cachedGenerateContentModels;
  const url = `${BASE}/models?key=${encodeURIComponent(apiKey)}`;
  const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
  try {
    log('models.list.start', { endpoint: safeUrl });
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      log('models.list.error', { status: res.status, preview: text.slice(0, 220) });
      return [];
    }
    const parsed = JSON.parse(text);
    const models = Array.isArray(parsed?.models)
      ? parsed.models
          .filter((m) => Array.isArray(m?.supportedGenerationMethods))
          .filter((m) => m.supportedGenerationMethods.includes('generateContent'))
          .map((m) => String(m?.name || '').replace(/^models\//, '').trim())
          .filter(Boolean)
      : [];
    cachedGenerateContentModels = Array.from(new Set(models));
    log('models.list.success', {
      count: cachedGenerateContentModels.length,
      sample: cachedGenerateContentModels.slice(0, 10),
    });
    return cachedGenerateContentModels;
  } catch (error) {
    log('models.list.exception', {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function computeModelCandidates(configuredModel, apiKey) {
  const preferred = [configuredModel, DEFAULT_MODEL, ...FALLBACK_MODELS];
  const available = await listGenerateContentModels(apiKey);
  if (!available.length) return Array.from(new Set(preferred));
  const preferredAvailable = preferred.filter((m) => available.includes(m));
  return Array.from(new Set([...preferredAvailable, ...available]));
}

function extractTextFromGenerateResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

async function generateContentWithFallback(prompt, generationConfig) {
  const apiKey = getApiKey();
  const configuredModel = getModelId();
  const candidates = await computeModelCandidates(configuredModel, apiKey);
  let lastError = null;

  for (const model of candidates) {
    const url = `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const safeUrl = url.replace(/([?&]key=)[^&]+/, '$1***');
    log('request.start', {
      model,
      endpoint: safeUrl,
      candidateCount: candidates.length,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
    });
    const text = await res.text();
    log('request.response', {
      model,
      status: res.status,
      ok: res.ok,
      preview: text.slice(0, 220),
    });
    if (res.ok) {
      const parsed = JSON.parse(text);
      return {
        model,
        rawText: extractTextFromGenerateResponse(parsed),
      };
    }
    const looksLikeMissingModel =
      res.status === 404 &&
      (text.includes('is no longer available to new users') ||
        text.includes('NOT_FOUND') ||
        text.includes('models/'));
    if (looksLikeMissingModel) {
      log('request.retry_fallback', { fromModel: model, status: res.status });
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

function extractJsonBlock(raw) {
  const t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence?.[1]?.trim() || t;
}

function isoDayLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function yyyymmddLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function extractRelativeDaysHint(input) {
  const text = String(input || '').toLowerCase();
  const m =
    text.match(/\bdans\s+(\d{1,3})\s*jours?\b/i) ||
    text.match(/\bin\s+(\d{1,3})\s*days?\b/i);
  if (!m) return null;
  const days = Number(m[1]);
  if (!Number.isFinite(days) || days < 0) return null;
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return { days, iso: isoDayLocal(date), ymd: yyyymmddLocal(date) };
}

function normalizeExpertArray(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      const obj = item && typeof item === 'object' ? item : {};
      const rawType = String(obj.type || obj.intent_type || obj.intentType || '')
        .trim()
        .toUpperCase();
      const type =
        rawType === 'PROJECT' || rawType === 'PROJET'
          ? 'PROJECT'
          : rawType === 'HABIT' || rawType === 'ROUTINE'
            ? 'HABIT'
            : rawType === 'TASK' || rawType === 'TODO'
              ? 'TASK'
              : rawType === 'NOTE'
                ? 'NOTE'
                : '';
      if (
        type !== 'TASK' &&
        type !== 'HABIT' &&
        type !== 'NOTE' &&
        type !== 'PROJECT'
      ) {
        return null;
      }
      const title = String(obj.title || '').trim();
      if (!title) return null;
      return {
        type,
        title,
        metadata: {
          ...(obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {}),
          gemini_type: type,
        },
        suggested_category: String(
          obj.suggested_category || obj.category || obj.folder || '',
        )
          .trim()
          .toLowerCase(),
      };
    })
    .filter(Boolean);
}

export async function askGeminiExpert(input) {
  log('askGeminiExpert.start', { inputChars: input?.length ?? 0, model: getModelId() });
  const prompt = `SYSTEM:
Tu es Expert Trankil. Transforme l'entree utilisateur en tableau JSON pur.
Tu dois retourner UNIQUEMENT un array JSON valide.

Schema strict par objet:
{
  "type": "TASK" | "HABIT" | "NOTE" | "PROJECT",
  "title": "string",
  "metadata": { "date"?: string, "time"?: string, "location"?: string },
  "suggested_category": "string"
}

Regles:
- Ne retourne aucun texte explicatif.
- Si plusieurs intentions sont detectees, cree plusieurs objets.
- Extrait date/heure/lieu quand present dans metadata.
- Garde un titre court, actionnable.

USER_INPUT:
${input}`;

  let generated;
  try {
    generated = await generateContentWithFallback(prompt, {
        temperature: 0.2,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
    });
  } catch (error) {
    log('askGeminiExpert.generateContent.error', {
      model: getModelId(),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const rawText = generated.rawText?.trim();
  log('askGeminiExpert.rawLength', { chars: rawText?.length ?? 0 });
  if (!rawText) {
    log('askGeminiExpert.empty', {});
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(extractJsonBlock(rawText));
  } catch (e) {
    log('askGeminiExpert.parseError', {
      message: e instanceof Error ? e.message : String(e),
      preview: rawText.slice(0, 240),
    });
    throw e;
  }
  const rows = normalizeExpertArray(parsed);
  log('askGeminiExpert.done', { rows: rows.length });
  return rows;
}

function normalizeAtomizedPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const projectTitle = String(raw.projectTitle || raw.project_title || '').trim();
  const tasksRaw = raw.tasks;
  if (!Array.isArray(tasksRaw)) return null;
  const tasks = tasksRaw
    .map((t) => {
      const o = t && typeof t === 'object' ? t : {};
      const title = String(o.t || o.title || '').trim();
      if (!title) return null;
      const dueDateRaw = String(o.d || '').trim();
      const dueDate = /^\d{8}$/.test(dueDateRaw) ? dueDateRaw : null;
      return {
        title,
        suggestAlarm: Boolean(o.a ?? o.suggestAlarm ?? o.suggest_alarm),
        dueDate,
      };
    })
    .filter(Boolean);
  return { projectTitle, tasks };
}

/** Découpe une narration projet en périmètre + tâches concrètes (bouton PROJET). */
export async function atomizeProject(audioText) {
  log('atomizeProject.start', { inputChars: audioText?.length ?? 0, model: getModelId() });
  const today = isoDayLocal(new Date());
  const relativeHint = extractRelativeDaysHint(audioText);
  const relativeDeadlineRule = relativeHint
    ? `- Si l'utilisateur dit "dans ${relativeHint.days} jours", la date de fin est donc le ${relativeHint.iso} (format d: ${relativeHint.ymd}).`
    : '';

  const prompt = `SYSTEM:
Tu es un planificateur d'exécution. L'utilisateur décrit un PROJET ou une intention large (voix transcrite).
Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte autour).
Aujourd'hui nous sommes le ${today}. Toutes les dates "d" que tu génères doivent être calculées à partir de cette date précise.

Schema JSON strict:
{
  "projectTitle": "Titre court",
  "tasks": [
    { "t": "Titre tache", "a": true, "d": "YYYYMMDD" }
  ]
}

Règles:
- Génère maximum 10 tâches pour rester concis et garantir un JSON complet.
- Chaque tâche doit inclure "d" (date prévue) au format YYYYMMDD.
- Répartis les dates "d" de façon logique entre la date du jour et la deadline donnée par l'utilisateur.
- N'invente jamais un mois précédent/suivant si ce n'est pas cohérent avec la date de référence ci-dessus.
- Si la deadline est relative (ex: "dans X jours"), convertis-la explicitement en date calendrier.
${relativeDeadlineRule}
- Chaque titre est actionnable seul (pas de sous-points dans le titre).
- Si le texte est flou, déduis les étapes logiques les plus probables.
- projectTitle : une seule ligne, pas un paragraphe.

TRANSCRIPT:
${audioText}`;

  let generated;
  try {
    generated = await generateContentWithFallback(prompt, {
        temperature: 0.25,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
    });
  } catch (error) {
    log('atomizeProject.generateContent.error', {
      model: getModelId(),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const rawText = generated.rawText?.trim();
  log('atomizeProject.rawLength', { chars: rawText?.length ?? 0 });
  if (!rawText) {
    log('atomizeProject.empty', {});
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJsonBlock(rawText));
  } catch (e) {
    log('atomizeProject.parseError', {
      message: e instanceof Error ? e.message : String(e),
      preview: rawText.slice(0, 320),
    });
    const parseError = new Error('PLAN_JSON_PARSE_ERROR');
    parseError.name = 'PlanJsonParseError';
    throw parseError;
  }

  const norm = normalizeAtomizedPayload(parsed);
  if (!norm || !norm.tasks.length) {
    log('atomizeProject.noTasks', { parsedKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [] });
    return [];
  }

  const pt =
    norm.projectTitle ||
    (audioText.length > 80 ? `${audioText.slice(0, 77)}…` : audioText.trim()) ||
    'Projet';

  const rows = [
    {
      type: 'PROJECT',
      title: pt,
      metadata: { source: 'atomizeProject', taskCount: norm.tasks.length },
      suggested_category: 'projets',
    },
    ...norm.tasks.map((t) => ({
      type: 'TASK',
      title: t.title,
      metadata: { suggest_alarm: t.suggestAlarm, due_date: t.dueDate },
      suggested_category: 'projets',
    })),
  ];

  log('atomizeProject.done', {
    projectTitle: pt,
    taskCount: norm.tasks.length,
    totalRows: rows.length,
  });
  return rows;
}
