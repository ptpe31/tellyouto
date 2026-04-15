/**
 * Expert Gemini via @google/generative-ai (modèle Flash stable).
 * Clé : process.env.EXPO_PUBLIC_GEMINI_API_KEY
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_MODEL = 'gemini-1.5-flash';

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
  if (!configured) return DEFAULT_MODEL;
  // Gemini 2.0 Flash can be unavailable for new/free accounts: force stable fallback.
  if (configured.includes('gemini-2.0-flash')) {
    return DEFAULT_MODEL;
  }
  return configured;
}

function getGenerativeModel() {
  const apiKey = getApiKey();
  const modelId = getModelId();
  log('model.init', { modelId, keyPresent: true });
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel(
    { model: modelId },
    { apiVersion: 'v1beta' },
  );
}

function extractJsonBlock(raw) {
  const t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence?.[1]?.trim() || t;
}

function normalizeExpertArray(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      const obj = item && typeof item === 'object' ? item : {};
      const type = String(obj.type || '').toUpperCase();
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
        metadata:
          obj.metadata && typeof obj.metadata === 'object'
            ? obj.metadata
            : {},
        suggested_category: String(obj.suggested_category || '').trim(),
      };
    })
    .filter(Boolean);
}

export async function askGeminiExpert(input) {
  const model = getGenerativeModel();
  log('askGeminiExpert.start', {
    inputChars: input?.length ?? 0,
    model: getModelId(),
  });
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

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 600,
      responseMimeType: 'application/json',
    },
  });

  const rawText = result.response.text()?.trim();
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
    .map((t, i) => {
      const o = t && typeof t === 'object' ? t : {};
      const title = String(o.title || '').trim();
      if (!title) return null;
      return {
        title,
        order: typeof o.order === 'number' ? o.order : i + 1,
        metadata:
          o.metadata && typeof o.metadata === 'object' ? o.metadata : {},
      };
    })
    .filter(Boolean);
  return { projectTitle, tasks };
}

/** Découpe une narration projet en périmètre + tâches concrètes (bouton PROJET). */
export async function atomizeProject(audioText) {
  const model = getGenerativeModel();
  log('atomizeProject.start', {
    inputChars: audioText?.length ?? 0,
    model: getModelId(),
  });

  const prompt = `SYSTEM:
Tu es un planificateur d'exécution. L'utilisateur décrit un PROJET ou une intention large (voix transcrite).
Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte autour).

Schema JSON strict:
{
  "projectTitle": "string (nom court du projet ou de l'objectif)",
  "tasks": [
    {
      "title": "string (action concrète, verbe d'action)",
      "order": 1,
      "metadata": { "estimate_minutes"?: number }
    }
  ]
}

Règles:
- 3 à 12 tâches maximum, ordonnées (order croissant).
- Chaque titre est actionnable seul (pas de sous-points dans le titre).
- Si le texte est flou, déduis les étapes logiques les plus probables.
- projectTitle : une seule ligne, pas un paragraphe.

TRANSCRIPT:
${audioText}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  const rawText = result.response.text()?.trim();
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
    throw e;
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
      metadata: { ...t.metadata, order: t.order },
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
