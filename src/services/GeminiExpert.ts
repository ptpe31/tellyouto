import Constants from 'expo-constants';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3-flash-preview';

type GeminiExtra = {
  geminiApiKey?: string;
  geminiModel?: string;
};

type GeminiGeneratePart = {
  text: string;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiGeneratePart[];
    };
  }>;
};

export type GeminiExpertIntention = {
  type: 'TASK' | 'HABIT' | 'NOTE' | 'PROJECT';
  title: string;
  metadata: Record<string, unknown>;
  suggested_category: string;
};

function readGeminiExtra(): GeminiExtra {
  return (Constants.expoConfig?.extra ?? {}) as GeminiExtra;
}

function getGeminiApiKey(): string {
  const fromExtra = readGeminiExtra().geminiApiKey?.trim();
  const fromEnv = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
  const key = fromExtra || fromEnv;
  if (!key) {
    throw new Error(
      'GeminiExpert: EXPO_PUBLIC_GEMINI_API_KEY manquante (.env / env).',
    );
  }
  return key;
}

function getGeminiModel(): string {
  const fromExtra = readGeminiExtra().geminiModel?.trim();
  const fromEnv = process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim();
  return fromExtra || fromEnv || DEFAULT_MODEL;
}

/**
 * Boilerplate de base : envoie le texte brut au modele expert.
 * Brancher ensuite sur un prompt metier dedie.
 */
function extractJsonBlock(raw: string): string {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence?.[1]?.trim() || t;
}

function normalizeExpertArray(raw: unknown): GeminiExpertIntention[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      const obj = item as Record<string, unknown>;
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
            ? (obj.metadata as Record<string, unknown>)
            : {},
        suggested_category: String(obj.suggested_category || '').trim(),
      } satisfies GeminiExpertIntention;
    })
    .filter((v): v is GeminiExpertIntention => Boolean(v));
}

/**
 * Prompt master Expert:
 * force un tableau JSON pur d'objets intentions.
 */
export async function askGeminiExpert(input: string): Promise<GeminiExpertIntention[]> {
  const key = getGeminiApiKey();
  const model = getGeminiModel();
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${encodeURIComponent(
    key,
  )}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `SYSTEM:
Tu es Expert Trankil. Transforme l'entree utilisateur en tableau JSON pur.
Tu dois retourner UNIQUEMENT un array JSON valide.

Schema strict par objet:
{
  "type": "TASK" | "HABIT" | "NOTE" | "PROJECT",
  "title": "string",
  "metadata": { "date"?: string, "time"?: string, "location"?: string, ... },
  "suggested_category": "string"
}

Regles:
- Ne retourne aucun texte explicatif.
- Si plusieurs intentions sont detectees, cree plusieurs objets.
- Extrait date/heure/lieu quand present dans metadata.
- Garde un titre court, actionnable.

USER_INPUT:
${input}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 600,
        response_mime_type: 'application/json',
      },
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `GeminiExpert HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
    );
  }

  const envelope = JSON.parse(bodyText) as GeminiGenerateResponse;
  const rawText = envelope.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!rawText) return [];
  const parsed = JSON.parse(extractJsonBlock(rawText)) as unknown;
  return normalizeExpertArray(parsed);
}

