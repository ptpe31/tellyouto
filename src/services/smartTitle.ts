/**
 * Titres et nettoyage de transcript pour Path A (OneTap) : préparation avant
 * `inferOneTapSkeletonFromTranscript` (Path A) et affichage.
 *
 * @module smartTitle
 */
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

  out = out.replace(
    /\b(aujourd['’]hui|demain|après-demain|apres[- ]demain|hier|ce\s+(?:matin|soir)|cet\s+apr[eè]s[- ]midi|cet\s+apres[- ]midi|cette\s+nuit|ce\s+week[- ]?end|cette\s+semaine|semaine\s+prochaine|mois\s+prochain)\b/gi,
    '',
  );
  out = out.replace(
    /\b(today|tomorrow|tonight|yesterday|this\s+(?:morning|afternoon|evening|night)|next\s+(?:week|month))\b/gi,
    '',
  );
  out = out.replace(/\b(hoy|mañana|manana|esta\s+(?:tarde|noche|mañana|manana))\b/gi, '');

  out = out.replace(
    /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/gi,
    '',
  );

  out = out.replace(
    /\b(chaque|tous|toutes|every|each|cada)\s+(?:les?\s+)?\b(mat[iî]n|soir|semaine|jour|jours|morning|evening|day|days|mañana|manana|tarde|noche)\b/gi,
    '',
  );

  out = out.replace(/\b(ds|d['’]?ici|dans|in)\s*\d+\s*(?:j|jour|jours|day|days|semaine|semaines|week|weeks|mois|month|months)\b/gi, '');

  out = out.replace(/\b(mat[iî]n|midi|soir|nuit|apr[eè]s[- ]midi|apres[- ]midi|morning|afternoon|evening|night)\b/gi, '');

  out = out.replace(/\b(?:a|à|at)\s*(\d{1,2}(?::\d{2}|h\s*\d{0,2})?)\s*(?:am|pm)?\b/gi, '');
  out = out.replace(/\b\d{1,2}\s*h\s*\d{0,2}\b/gi, '');
  out = out.replace(/\b\d{1,2}:\d{2}\b/g, '');
  out = out.replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, '');

  out = out.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
  out = out.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '');

  out = out.replace(/[\s,.:;!?-]{2,}/g, ' ');
  out = out.replace(/\s+([,.:;!?])/g, '$1');
  out = out.replace(/[()[\]{}]+/g, ' ');
  return normalizeInput(out);
}

function expandAbbreviations(input: string, locale?: string): string {
  let out = normalizeInput(input);
  if (!out) return out;
  const l = String(locale || '').toLowerCase();
  if (l.startsWith('fr')) {
    out = out.replace(/\b(rdv|r\.d\.v\.|rdvs)\b/gi, 'Rendez-vous');
    out = out.replace(/\b(mdcin|medcin|medecin)\b/gi, 'Médecin');
    out = out.replace(/\b(mger|mangé|mange)\b/gi, (m) => (m.toLowerCase() === 'mger' ? 'Manger' : m));
  } else if (l.startsWith('en')) {
    out = out.replace(/\b(appt)\b/gi, 'Appointment');
  } else if (l.startsWith('es')) {
    out = out.replace(/\b(cita)\b/gi, 'Cita');
  }
  return normalizeInput(out);
}

/** Retire fillers en tête et segments faibles pour stabiliser classification / titre. */
export function cleanTranscriptText(rawTranscript: string): string {
  const cleaned = stripWeakLeadingSegment(stripLeadingFillers(rawTranscript));
  return normalizeInput(cleaned);
}

/** Heuristique : transcript long ou avec ponctuation forte → ne pas réécraser le titre automatiquement. */
export function shouldLockSmartTitle(transcript: string): boolean {
  const text = String(transcript || '').trim();
  if (!text) return false;
  return /[\n.!?]/.test(text) || text.length >= 50;
}

/**
 * Titre court dérivé du transcript : nettoyage, suppression des marqueurs temporels,
 * abréviations selon la locale, capitalisation.
 */
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
  base = expandAbbreviations(scrubTimeHints(base), locale);
  if (!base) return '';
  const head = base.charAt(0).toLocaleUpperCase(locale);
  return `${head}${base.slice(1)}`;
}

/** Assainit un titre déjà connu (affichage) : temps retiré, abréviations, trim. */
export function sanitizeDisplayTitle(input: string, locale?: string): string {
  const cleaned = normalizeInput(input);
  if (!cleaned) return '';
  let out = expandAbbreviations(scrubTimeHints(cleaned), locale);
  if (!out) return '';
  const head = out.charAt(0).toLocaleUpperCase(locale);
  out = `${head}${out.slice(1)}`;
  out = out.replace(/^[\s,.:;!?-]+/, '').replace(/[\s,.:;!?-]+$/, '');
  return normalizeInput(out);
}
