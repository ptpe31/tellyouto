import type { GeminiExpertIntention } from './GeminiExpert';

const ALLOWED_TYPES = new Set<GeminiExpertIntention['type']>(['TASK', 'HABIT', 'NOTE', 'PROJECT']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Garde-fou léger sur le JSON « expert » : évite de planter la Timeline si le modèle renvoie du bruit.
 */
export function safeParseGeminiExpertRows(input: unknown): GeminiExpertIntention[] {
  if (!Array.isArray(input)) return [];
  const out: GeminiExpertIntention[] = [];
  for (const item of input) {
    if (!isPlainObject(item)) continue;
    const type = item.type;
    if (typeof type !== 'string' || !ALLOWED_TYPES.has(type as GeminiExpertIntention['type'])) continue;
    const title = String(item.title ?? '').trim();
    if (!title) continue;
    const metadata = isPlainObject(item.metadata) ? item.metadata : {};
    const suggested_category =
      typeof item.suggested_category === 'string' && item.suggested_category.trim()
        ? item.suggested_category.trim()
        : 'a_trier';
    out.push({
      type: type as GeminiExpertIntention['type'],
      title,
      metadata,
      suggested_category,
    });
  }
  return out;
}
