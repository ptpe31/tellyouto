/**
 * Normalise les transcripts issus de la vision (JSON lab, fences markdown) en prose injectable Pass 1.
 * @module visionTranscriptNormalize
 */

function stripJsonFences(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const s = stripJsonFences(raw);
  if (!s.startsWith('{') && !s.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function flattenVisionIntentBlock(block: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const name = String(block.name ?? block.title ?? '').trim();
  const description = String(block.description ?? block.content ?? '').trim();
  if (description) lines.push(description);
  else if (name) lines.push(name.replace(/_/g, ' '));

  const entities = block.entities;
  if (entities && typeof entities === 'object' && !Array.isArray(entities)) {
    for (const [key, value] of Object.entries(entities as Record<string, unknown>)) {
      if (value == null || value === '') continue;
      if (Array.isArray(value)) {
        lines.push(`${key.replace(/_/g, ' ')}: ${value.join(', ')}`);
      } else {
        lines.push(`${key.replace(/_/g, ' ')}: ${String(value).trim()}`);
      }
    }
  }
  return lines.filter(Boolean);
}

function flattenVisionJsonToProse(obj: Record<string, unknown>): string | null {
  const intentsRaw = obj.intents;
  if (!Array.isArray(intentsRaw) || intentsRaw.length === 0) return null;
  const paragraphs: string[] = [];
  for (const item of intentsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const lines = flattenVisionIntentBlock(item as Record<string, unknown>);
    if (lines.length) paragraphs.push(lines.join('. '));
  }
  return paragraphs.length ? paragraphs.join('\n\n') : null;
}

/** True si le texte ressemble à un blob JSON structuré (vision / lab), pas à une dictée. */
export function looksLikeStructuredCaptureTranscript(raw: string): boolean {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return false;
  if (/^```(?:json)?/i.test(trimmed)) return true;
  if (/^\s*[{[]/.test(trimmed) && /"intents"\s*:/.test(trimmed)) return true;
  if (/^\s*[{[]/.test(trimmed) && /"(name|description|entities)"\s*:/.test(trimmed)) return true;
  return false;
}

/**
 * Convertit markdown/JSON vision → prose ; laisse le texte brut inchangé sinon.
 */
export function normalizeCaptureTranscript(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  const obj = tryParseJsonObject(trimmed);
  if (obj) {
    const flat = flattenVisionJsonToProse(obj);
    if (flat) return flat.trim();
  }

  const unfenced = stripJsonFences(trimmed);
  if (unfenced !== trimmed) {
    const obj2 = tryParseJsonObject(unfenced);
    if (obj2) {
      const flat = flattenVisionJsonToProse(obj2);
      if (flat) return flat.trim();
    }
  }

  return unfenced || trimmed;
}
