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

export type AiLogTokens = {
  in?: number;
  out?: number;
  total?: number;
};

export type LogAiInteractionParams = {
  pass: 1 | 2;
  label: AiPassLabel;
  modelId: string;
  latencyMs: number;
  systemInstruction?: string;
  userContent: string;
  rawResponse?: string;
  parsedResult?: unknown;
  /** Titre de la section finale (défaut : PARSED INTENTS / PARSED RESULT). */
  parsedSectionTitle?: string;
  error?: unknown;
  tokens?: AiLogTokens;
  temperature?: number;
  isJsonMode?: boolean;
  /** Nombre de messages dans l'historique (requêtes multi-turn). */
  historyLength?: number;
};

/** Extrait les compteurs de tokens depuis {@link GeminiHttpSettledMeta} ou usageMetadata proxy. */
export function aiLogTokensFromHttpMeta(meta?: {
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  tokensTotal?: number | null;
}): AiLogTokens | undefined {
  if (!meta) return undefined;
  const inCount = typeof meta.tokensPrompt === 'number' ? meta.tokensPrompt : undefined;
  const outCount = typeof meta.tokensCompletion === 'number' ? meta.tokensCompletion : undefined;
  const totalCount =
    typeof meta.tokensTotal === 'number'
      ? meta.tokensTotal
      : inCount !== undefined && outCount !== undefined
        ? inCount + outCount
        : undefined;
  if (inCount === undefined && outCount === undefined && totalCount === undefined) return undefined;
  return { in: inCount, out: outCount, total: totalCount };
}

function safeStringify(value: unknown, maxLen = 8000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}…`;
  } catch {
    return '[unserializable]';
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function buildConfigLine(
  params: Pick<LogAiInteractionParams, 'temperature' | 'isJsonMode' | 'historyLength'>,
): string | null {
  const parts: string[] = [];
  if (params.temperature !== undefined) parts.push(`Temp ${params.temperature}`);
  if (params.isJsonMode !== undefined) parts.push(`JSON Mode: ${params.isJsonMode ? 'Yes' : 'No'}`);
  if (params.historyLength !== undefined) {
    const n = params.historyLength;
    parts.push(`History: ${n} turn${n === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return null;
  return `Config: ${parts.join(' | ')}`;
}

function buildTokensLine(tokens?: AiLogTokens): string | null {
  if (!tokens) return null;
  const parts: string[] = [];
  if (tokens.in !== undefined) parts.push(`In ${tokens.in}`);
  if (tokens.out !== undefined) parts.push(`Out ${tokens.out}`);
  if (tokens.total !== undefined) parts.push(`Total ${tokens.total}`);
  if (parts.length === 0) return null;
  return `Tokens: ${parts.join(' | ')}`;
}

/**
 * Affiche un bloc audit IA complet (modèle, latence, prompt, réponse brute, résultat parsé).
 * Ne produit aucune sortie hors mode développement.
 */
export function logAiInteraction(params: LogAiInteractionParams): void {
  if (!isAiLoggingEnabled()) return;

  const failed = params.error != null;
  const emoji = failed ? '❌' : params.pass === 1 ? '🤖' : '🧠';
  const statusLabel = failed ? 'FAILED' : params.label;
  const parsedTitle =
    params.parsedSectionTitle ?? (params.pass === 1 ? 'PARSED INTENTS' : 'PARSED RESULT');
  const systemInstruction = params.systemInstruction?.trim() || '(none)';

  const lines: string[] = [
    `[${emoji} AI PASS ${params.pass} - ${statusLabel}]`,
    `Model: ${params.modelId}`,
    `Latency: ${Math.round(params.latencyMs)} ms`,
  ];

  const configLine = buildConfigLine(params);
  if (configLine) lines.push(configLine);

  const tokensLine = buildTokensLine(params.tokens);
  if (tokensLine) lines.push(tokensLine);

  lines.push('--- SYSTEM INSTRUCTION ---', systemInstruction, '--- USER CONTENT ---', params.userContent);

  if (params.rawResponse !== undefined) {
    lines.push('--- RAW RESPONSE ---', params.rawResponse);
  }

  if (failed) {
    lines.push('--- ERROR ---', formatError(params.error));
  }

  if (!failed && params.parsedResult !== undefined) {
    lines.push(`--- ${parsedTitle} ---`, safeStringify(params.parsedResult));
  }

  console.log(lines.join(AI_LOG));
}
