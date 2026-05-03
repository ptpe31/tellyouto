const LEADING_FILLERS = [
  /^[\s,.:;!?-]*(?:e+u+h+|alors)\b[\s,.:;!?-]*/i,
  /^[\s,.:;!?-]*(?:je\s+voudrais\s+me\s+souvenir\s+que|penser\s+a|il\s+faut\s+que)\b[\s,.:;!?-]*/i,
];

const GENERIC_LINKING_START =
  /^[\s,.:;!?-]*(?:avec|pour|de|du|des|le|la|les|un|une|a|au|aux|en)\b[\s,.:;!?-]*/i;

function normalizeInput(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingFillers(input: string): string {
  let out = normalizeInput(input);
  let changed = true;
  while (changed && out) {
    changed = false;
    for (const pattern of LEADING_FILLERS) {
      const next = out.replace(pattern, '').trimStart();
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
  }
  return out;
}

function stripWeakLeadingSegment(input: string): string {
  let out = normalizeInput(input);
  if (!out) return out;
  // Ignore weak linking chunks at title start (e.g. "Avec un...", "Pour le...")
  while (GENERIC_LINKING_START.test(out)) {
    const next = out.replace(GENERIC_LINKING_START, '').trimStart();
    if (!next || next === out) break;
    out = next;
  }
  return out;
}

function scrubTimeHints(input: string): string {
  let out = normalizeInput(input);
  if (!out) return out;

  out = out.replace(/\b(mdcin|medcin|medecin)\b/gi, 'médecin');

  out = out.replace(
    /\b(aujourd['’]hui|demain|après-demain|apres[- ]demain|ce\s+(?:matin|soir)|cet\s+apres[- ]midi|cet\s+apr[eè]s[- ]midi|cette\s+nuit|ce\s+week[- ]?end|cette\s+semaine)\b/gi,
    '',
  );

  out = out.replace(/\b(mat[iî]n|midi|soir|nuit|apr[eè]s[- ]midi|apres[- ]midi)\b/gi, '');

  out = out.replace(/\b(?:a|à)\s*(\d{1,2}(?::\d{2}|h\s*\d{0,2})?)\b/gi, '');
  out = out.replace(/\b\d{1,2}\s*h\s*\d{0,2}\b/gi, '');
  out = out.replace(/\b\d{1,2}:\d{2}\b/g, '');

  out = out.replace(/[\s,.:;!?-]{2,}/g, ' ');
  out = out.replace(/\s+([,.:;!?])/g, '$1');
  return normalizeInput(out);
}

export function cleanTranscriptText(rawTranscript: string): string {
  const cleaned = stripWeakLeadingSegment(stripLeadingFillers(rawTranscript));
  return normalizeInput(cleaned);
}

export function shouldLockSmartTitle(transcript: string): boolean {
  const text = String(transcript || '').trim();
  if (!text) return false;
  return /[\n.!?]/.test(text) || text.length >= 50;
}

export function generateSmartTitle(rawTranscript: string, locale?: string): string {
  const cleaned = cleanTranscriptText(rawTranscript);
  if (!cleaned) return '';

  const firstBreak = cleaned.search(/[\n.!?]/);
  let base = firstBreak >= 0 ? cleaned.slice(0, firstBreak).trim() : cleaned;

  if (firstBreak < 0 && base.length > 50) {
    const hard = base.slice(0, 40);
    const lastSpace = hard.lastIndexOf(' ');
    base = (lastSpace > 12 ? hard.slice(0, lastSpace) : hard).trim();
  }

  if (!base) return '';
  base = stripWeakLeadingSegment(base);
  base = scrubTimeHints(base);
  if (!base) return '';
  const head = base.charAt(0).toLocaleUpperCase(locale);
  return `${head}${base.slice(1)}`;
}
