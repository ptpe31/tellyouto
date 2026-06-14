/**
 * Réparation de JSON Gemini tronqué (fermeture de chaînes / accolades manquantes).
 * @module jsonSalvage
 */

/** Ferme les `{` / `[` ouverts si la réponse a été tronquée en cours de génération. */
export function salvageTruncatedJsonText(text: string): string {
  let s = text.replace(/,?\s*$/, '');
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if ((ch === '}' || ch === ']') && closers.length > 0 && closers[closers.length - 1] === ch) {
      closers.pop();
    }
  }
  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');
  while (closers.length > 0) s += closers.pop();
  return s;
}

/** Parse JSON avec repli sur salvage si tronqué. */
export function parseJsonObjectBestEffort(cleanText: string): Record<string, unknown> {
  try {
    return JSON.parse(cleanText) as Record<string, unknown>;
  } catch {
    const salvaged = salvageTruncatedJsonText(cleanText);
    return JSON.parse(salvaged) as Record<string, unknown>;
  }
}

/** Extrait le bloc `{…}` principal d'une réponse brute (fences markdown tolérées). */
export function extractJsonObjectText(raw: string): string {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const startIdx = stripped.indexOf('{');
  if (startIdx < 0) throw new Error('JSON_MISSING_OBJECT');
  let cleanText = stripped.slice(startIdx);
  if (/[}\]]\s*$/.test(stripped)) {
    const endIdx = cleanText.lastIndexOf('}');
    if (endIdx > 0) cleanText = cleanText.slice(0, endIdx + 1);
  }
  return cleanText;
}
