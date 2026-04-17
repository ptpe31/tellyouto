const LEADING_FILLERS = [
  /^euh[\s,.:;-]*/i,
  /^alors[\s,.:;-]*/i,
  /^je pense que[\s,.:;-]*/i,
];

function stripLeadingFillers(input: string): string {
  let out = input.trim().replace(/\s+/g, ' ');
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

export function shouldLockSmartTitle(transcript: string): boolean {
  const text = String(transcript || '').trim();
  if (!text) return false;
  return /[\n.!?]/.test(text) || text.length >= 50;
}

export function generateSmartTitle(rawTranscript: string, locale?: string): string {
  const cleaned = stripLeadingFillers(String(rawTranscript || ''));
  if (!cleaned) return '';

  const firstBreak = cleaned.search(/[\n.!?]/);
  let base = firstBreak >= 0 ? cleaned.slice(0, firstBreak).trim() : cleaned;

  if (firstBreak < 0 && base.length > 50) {
    const hard = base.slice(0, 40);
    const lastSpace = hard.lastIndexOf(' ');
    base = (lastSpace > 12 ? hard.slice(0, lastSpace) : hard).trim();
  }

  if (!base) return '';
  const head = base.charAt(0).toLocaleUpperCase(locale);
  return `${head}${base.slice(1)}`;
}
