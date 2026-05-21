/**
 * Logs structurés Pass 1 / Pass 2 pour le prompt engineering (`__DEV__` uniquement).
 * Inactif en production / Release.
 *
 * @module logAiInteraction
 */

/** Continuation des blocs multi-lignes — alignement vertical dans Metro. */
const AI_LOG = '\n  | ';

export function isAiLoggingEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export type AiPassLabel = 'EXTRACTION' | 'REASONING';

export type LogAiInteractionParams = {
  pass: 1 | 2;
  label: AiPassLabel;
  modelId: string;
  latencyMs: number;
  systemInstruction?: string;
  userContent: string;
  rawResponse: string;
  parsedResult?: unknown;
  /** Titre de la section finale (défaut : PARSED INTENTS / PARSED RESULT). */
  parsedSectionTitle?: string;
};

function safeStringify(value: unknown, maxLen = 8000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}…`;
  } catch {
    return '[unserializable]';
  }
}

/**
 * Affiche un bloc audit IA complet (modèle, latence, prompt, réponse brute, résultat parsé).
 * Ne produit aucune sortie hors mode développement.
 */
export function logAiInteraction(params: LogAiInteractionParams): void {
  if (!isAiLoggingEnabled()) return;

  const emoji = params.pass === 1 ? '🤖' : '🧠';
  const parsedTitle =
    params.parsedSectionTitle ?? (params.pass === 1 ? 'PARSED INTENTS' : 'PARSED RESULT');
  const systemInstruction = params.systemInstruction?.trim() || '(none)';

  const lines: string[] = [
    `[${emoji} AI PASS ${params.pass} - ${params.label}]`,
    `Model: ${params.modelId}`,
    `Latency: ${Math.round(params.latencyMs)} ms`,
    '--- SYSTEM INSTRUCTION ---',
    systemInstruction,
    '--- USER CONTENT ---',
    params.userContent,
    '--- RAW RESPONSE ---',
    params.rawResponse,
  ];

  if (params.parsedResult !== undefined) {
    lines.push(`--- ${parsedTitle} ---`, safeStringify(params.parsedResult));
  }

  console.log(lines.join(AI_LOG));
}
