import type { OneTapPredictedType, OneTapUniversalResult, UiLocale } from '../../types/oneTap';
import { t } from '../../i18n';

type PathAOptions = { uiLocale: UiLocale; titleHint?: string };

function normalizeText(raw: string): string {
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

const WEEKDAYS_FR: Record<string, number> = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 0,
};

function nextWeekday(from: Date, targetDow: number): Date {
  const dow = from.getDay();
  const delta = (targetDow - dow + 7) % 7;
  return addDays(from, delta === 0 ? 7 : delta);
}

function parseTimeHm(lower: string): string | null {
  if (/\bminuit\b/.test(lower)) return '00:00';
  if (/\bmidi\b/.test(lower)) return '12:00';
  const m1 = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m1) {
    const h = Math.min(23, Math.max(0, Number(m1[1])));
    const m = Math.min(59, Math.max(0, Number(m1[2])));
    return `${pad2(h)}:${pad2(m)}`;
  }
  const m2 = lower.match(/\b(\d{1,2})h(\d{2})\b/);
  if (m2) {
    const h = Math.min(23, Math.max(0, Number(m2[1])));
    const m = Math.min(59, Math.max(0, Number(m2[2])));
    return `${pad2(h)}:${pad2(m)}`;
  }
  const m3 = lower.match(/\b(\d{1,2})h\b/);
  if (m3) {
    const h = Math.min(23, Math.max(0, Number(m3[1])));
    return `${pad2(h)}:00`;
  }
  return null;
}

function parseDateYmd(lower: string, ref: Date): string | null {
  if (/\baujourd'hui\b/.test(lower) || /\btoday\b/.test(lower)) return ymdLocal(ref);
  if (/\bapres-demain\b/.test(lower) || /\baprès-demain\b/.test(lower)) return ymdLocal(addDays(ref, 2));
  if (/\bdemain\b/.test(lower) || /\btomorrow\b/.test(lower)) return ymdLocal(addDays(ref, 1));
  const mIso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
  const mFr = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (mFr) {
    const dd = Math.min(31, Math.max(1, Number(mFr[1])));
    const mm = Math.min(12, Math.max(1, Number(mFr[2])));
    const yRaw = mFr[3];
    const yyyy = yRaw ? (yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw)) : ref.getFullYear();
    return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
  }
  for (const [name, dow] of Object.entries(WEEKDAYS_FR)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return ymdLocal(nextWeekday(ref, dow));
  }
  return null;
}

function extractListItems(text: string): string[] {
  const items: string[] = [];
  const re = /(?:^|\n)\s*(?:[-•]|\d+[.)])\s*(.+?)(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[1].trim();
    if (v.length >= 2 && v.length <= 80) items.push(v);
    if (items.length >= 32) break;
  }
  if (items.length >= 2) return items;
  const colon = text.indexOf(':');
  const tail = colon >= 0 ? text.slice(colon + 1) : text;
  const merged = tail
    .split(/[,;]|(?:\bpuis\b)/i)
    .flatMap((seg) => seg.split(/\bet\b/i))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 80)
    .slice(0, 32);
  return merged;
}

function extractPlace(raw: string): string | null {
  const m =
    raw.match(
      /\b(?:chez|a?à|au|aux|à la|a la|à l'|a l')\s+([^,.;!?]+?)(?=(?:\s+\b(pour|vers|afin|demain|a?à|au)\b)|[,.!?]|$)/i,
    ) ?? null;
  const hit = m?.[1]?.trim() ?? '';
  if (!hit) return null;
  const norm = hit.toLowerCase();
  const dict: Record<string, string> = {
    maison: 'Maison',
    home: 'Maison',
    boulot: 'Travail',
    travail: 'Travail',
    bureau: 'Bureau',
    gare: 'Gare',
    aeroport: 'Aéroport',
    aéroport: 'Aéroport',
    dentiste: 'Dentiste',
    medecin: 'Médecin',
    médecin: 'Médecin',
    hopital: 'Hôpital',
    hôpital: 'Hôpital',
    pharmacie: 'Pharmacie',
  };
  const label = dict[norm] ?? hit;
  const safe = label.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  return safe.length <= 120 ? safe : safe.slice(0, 120);
}

function categoryFromText(lower: string): string {
  if (/\b(travail|bureau|réunion|reunion|client|linkedin|pro)\b/i.test(lower)) return 'Travail';
  if (/\b(famille|mamie|papa|maman|enfants|couple)\b/i.test(lower)) return 'Famille';
  if (/\b(course|courses|acheter|supermarché|supermarche|carrefour|intermarché|intermarche|lidl|leclerc)\b/i.test(lower))
    return 'Courses';
  if (/\b(médecin|medecin|dentiste|kiné|kine|hôpital|hopital|pharmacie|rdv)\b/i.test(lower)) return 'Santé';
  if (/\b(sport|tennis|foot|gym|piscine|yoga)\b/i.test(lower)) return 'Sport';
  return 'Perso';
}

function titleFromText(clean: string, predicted: OneTapPredictedType, hint?: string): string {
  if (hint && hint.trim()) return hint.trim().slice(0, 200);
  const s = clean.trim();
  if (!s) return predicted === 'LIST' ? t('DEFAULT_LIST_TITLE') : t('DEFAULT_NOTE_TITLE');
  const short = s.length <= 200 ? s : s.slice(0, 200);
  if (predicted === 'LIST') {
    const cut = short.replace(/^\b(liste|courses|acheter)\b[:\s-]*/i, '').trim();
    return (cut || t('DEFAULT_LIST_TITLE')).slice(0, 200);
  }
  return short;
}

function scoreType(lower: string, raw: string): OneTapPredictedType {
  const listMarker =
    /\b(courses|liste|acheter|ingrédients|ingredients|valise|packing|matériel|materiel|caddie)\b/i.test(raw) ||
    /[:\n]\s*(?:•|-|\d+[.)])\s*\S/.test(raw);
  const anniversaryMarker =
    /\b(anniversaire|fête|fete|né le|nee le)\b/i.test(raw) ||
    /\b(mamie|papy|grand-mère|grand-pere|grand-père)\b/i.test(lower);
  const recurringMarker =
    /\b(chaque semaine|tous les (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?|toutes les semaines|récurrent|recurrent)\b/i.test(
      lower,
    );
  const habitMarker =
    /\b(chaque jour|tous les jours|chaque matin|tous les matins|habitude|routine|quotidien)\b/i.test(raw) &&
    !/\b(demain|apres-demain|après-demain|a?à\s*\d{1,2}([:h]\d{2})?|midi|minuit)\b/i.test(lower);
  const taskMarker =
    /\b(rappel|demain|apres-demain|après-demain|dans\s+\d+\s*(min|minute|minutes|h|heure|heures)|rdv|rendez[-\s]?vous|call|appeler|envoyer|payer|réserver|book)\b/i.test(
      lower,
    ) || /\b(tâche|tache|task|todo)\b/i.test(lower);
  const score: Record<OneTapPredictedType, number> = {
    NOTE: 0,
    TASK: 0,
    RECURRING_TASK: 0,
    HABIT: 0,
    LIST: 0,
    ANNIVERSARY: 0,
  };
  if (listMarker) score.LIST += 6;
  if (anniversaryMarker) score.ANNIVERSARY += 6;
  if (recurringMarker) score.RECURRING_TASK += 5;
  if (habitMarker) score.HABIT += 4;
  if (taskMarker) score.TASK += 4;
  if (/\b\d{1,2}([:h]\d{2})\b/.test(lower) || /\b(midi|minuit)\b/.test(lower)) score.TASK += 2;
  let best: OneTapPredictedType = 'NOTE';
  for (const t of ['LIST', 'ANNIVERSARY', 'RECURRING_TASK', 'HABIT', 'TASK'] as const) {
    if (score[t] > score[best]) best = t;
  }
  return best;
}

export type PathAResult = { result: OneTapUniversalResult; perfMs: number };

export function inferOneTapPathA(transcript: string, options: PathAOptions): PathAResult {
  const t0 = nowMs();
  const clean = normalizeText(transcript);
  const lower = clean.toLowerCase();
  const timeHm = parseTimeHm(lower) ?? undefined;
  const predictedType: OneTapPredictedType = timeHm ? 'TASK' : 'NOTE';
  const title = (options.titleHint?.trim() || clean.trim() || t('DEFAULT_INTENTION_TITLE')).slice(0, 200);
  const data: OneTapUniversalResult['data'] = {};
  if (timeHm) data.dueTimeHm = timeHm;
  const result: OneTapUniversalResult = { predictedType, categoryTag: '—', title, data };
  const t1 = nowMs();
  return { result, perfMs: Math.max(0, Math.round(t1 - t0)) };
}
