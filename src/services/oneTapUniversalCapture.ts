/**
 * Analyse **one-tap** : dictée → inférence locale instantanée + affinage Gemini (ligne compacte / flux).
 *
 * @module oneTapUniversalCapture
 */

import * as chrono from 'chrono-node';

import { geminiGenerateOneTapCompressedLine, geminiStreamOneTapCompressedLine } from './geminiSemanticLab';
import { cleanTranscriptText, generateSmartTitle } from './smartTitle';

export const ONE_TAP_PREDICTED_TYPES = [
  'TASK',
  'RECURRING_TASK',
  'HABIT',
  'LIST',
  'ANNIVERSARY',
  'NOTE',
] as const;

export type OneTapPredictedType = (typeof ONE_TAP_PREDICTED_TYPES)[number];

export type OneTapUniversalResult = {
  predictedType: OneTapPredictedType;
  /** Étiquette courte (domaine : cuisine, pro, perso, logistique, etc.). */
  categoryTag: string;
  /** Titre court affichable. */
  title: string;
  /** Champs spécifiques au type (dates, liste inventaire, récurrence, etc.). */
  data: Record<string, unknown>;
};

function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function universalTemporalDefaults(): Record<string, unknown> {
  return { dueDateTime: null, recurrence: null };
}

function normalizeUniversalTemporalInData(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  const due = next.dueDateTime;
  if (due === undefined || due === null || due === '') {
    next.dueDateTime = null;
  } else if (typeof due === 'string') {
    const trimmed = due.trim();
    if (!trimmed) {
      next.dueDateTime = null;
    } else {
      const dt = new Date(trimmed);
      next.dueDateTime = Number.isNaN(dt.getTime()) ? null : dt.toISOString();
    }
  } else {
    next.dueDateTime = null;
  }

  const rec = next.recurrence;
  if (rec === undefined || rec === null) {
    next.recurrence = null;
  } else if (typeof rec === 'object' && !Array.isArray(rec)) {
    const ro = rec as Record<string, unknown>;
    const summary = String(ro.summary ?? ro.description ?? ro.naturalLanguage ?? '').trim();
    const frequency = String(ro.frequency ?? ro.cadence ?? '').trim().toLowerCase() || null;
    const byWeekday = ro.byWeekday;
    const hasBy =
      byWeekday !== undefined && byWeekday !== null && String(byWeekday).trim() !== '';
    const hasSignal = Boolean(summary) || Boolean(frequency) || hasBy;
    if (!hasSignal) {
      next.recurrence = null;
    } else {
      next.recurrence = {
        ...(summary ? { summary } : {}),
        ...(frequency ? { frequency } : {}),
        ...(hasBy ? { byWeekday: Number(byWeekday) } : {}),
      };
    }
  } else {
    next.recurrence = null;
  }
  return next;
}

function universalTailFromPrev(prevData: Record<string, unknown>): Record<string, unknown> {
  const dueDateTime =
    prevData.dueDateTime === undefined || prevData.dueDateTime === null
      ? null
      : typeof prevData.dueDateTime === 'string'
        ? prevData.dueDateTime.trim() || null
        : null;
  const recurrence =
    prevData.recurrence === undefined || prevData.recurrence === null
      ? null
      : typeof prevData.recurrence === 'object' && !Array.isArray(prevData.recurrence)
        ? (prevData.recurrence as Record<string, unknown>)
        : null;
  return { dueDateTime, recurrence };
}

function stripJsonFences(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Segments KEY:value d’une ligne compacte (Path B). */
export type OneTapWireFields = Record<string, string>;

function wireLineFromSkeleton(s: OneTapUniversalResult): string {
  const safeTitle = s.title.replace(/\|/g, ' ').trim().slice(0, 90);
  const parts = [`P:${s.predictedType}`, `K:${s.categoryTag}`, `T:${safeTitle}`];
  const d = s.data;
  if (s.predictedType === 'TASK') {
    const y = typeof d.dueDateYmd === 'string' ? d.dueDateYmd.trim() : '';
    const h = typeof d.dueTimeHm === 'string' ? d.dueTimeHm.trim() : '';
    if (y) parts.push(`D:${y}`);
    if (h) parts.push(`H:${h}`);
    const notes = typeof d.notes === 'string' ? d.notes.trim().slice(0, 120) : '';
    if (notes) parts.push(`N:${notes.replace(/\|/g, ' ')}`);
  }
  if (s.predictedType === 'ANNIVERSARY') {
    const pn = typeof d.personName === 'string' ? d.personName.trim() : '';
    const g = typeof d.monthDay === 'string' ? d.monthDay.trim() : '';
    if (pn) parts.push(`A:${pn.replace(/\|/g, ' ')}`);
    if (g) parts.push(`G:${g}`);
  }
  if (s.predictedType === 'HABIT' || s.predictedType === 'RECURRING_TASK') {
    const c =
      typeof d.cadenceDescription === 'string' ? d.cadenceDescription.trim().slice(0, 120) : '';
    if (c) parts.push(`C:${c.replace(/\|/g, ' ')}`);
  }
  if (s.predictedType === 'LIST') {
    const list = d.list && typeof d.list === 'object' ? (d.list as Record<string, unknown>) : null;
    const cats = list && Array.isArray(list.categories) ? list.categories : [];
    const names: string[] = [];
    for (const c of cats) {
      const items = (c as { items?: unknown[] })?.items;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        const n = typeof (it as { name?: string })?.name === 'string' ? String((it as { name: string }).name).trim() : '';
        if (n && n !== '—') names.push(n);
      }
    }
    if (names.length) parts.push(`L:${names.join(';').slice(0, 400)}`);
  }
  return parts.join('|');
}

export function parseOneTapWireLine(line: string): OneTapWireFields {
  const s = String(line || '')
    .trim()
    .replace(/^[`"'«»\s]+/, '')
    .replace(/[`"'«»\s]+$/, '');
  const out: OneTapWireFields = {};
  for (const seg of s.split('|')) {
    const idx = seg.indexOf(':');
    if (idx <= 0) continue;
    const k = seg.slice(0, idx).trim().toUpperCase();
    const v = seg.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/** Parse incrémental (streaming) : n’utilise que les segments complets KEY:value. */
export function parsePartialWireLine(buffer: string): OneTapWireFields {
  const segments = String(buffer || '').split('|');
  const out: OneTapWireFields = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === segments.length - 1 && !seg.includes(':')) break;
    const idx = seg.indexOf(':');
    if (idx <= 0) continue;
    const k = seg.slice(0, idx).trim().toUpperCase();
    const v = seg.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function tryParseJsonObjectBestEffort(raw: string): Record<string, unknown> | null {
  const s = stripJsonFences(raw);
  if (!s || s[0] !== '{') return null;
  const tryOnce = (t: string) => {
    try {
      const o = JSON.parse(t) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* */
    }
    return null;
  };
  let hit = tryOnce(s);
  if (hit) return hit;
  let pad = s;
  for (let i = 0; i < 20 && !hit; i++) {
    pad += '}';
    hit = tryOnce(pad);
  }
  return hit;
}

function buildListDataFromWireItems(items: string[], title: string): Record<string, unknown> {
  const clean = items.map((x) => x.trim()).filter(Boolean).slice(0, 48);
  if (clean.length === 0) return defaultOneTapDataForType('LIST');
  return {
    ...universalTemporalDefaults(),
    list: {
      title: title.slice(0, 120) || 'Liste',
      baseCount: 1,
      unitLabel: 'personne',
      categories: [
        {
          name: '—',
          items: clean.map((name) => ({
            name,
            baseQuantity: 1,
            unit: 'piece',
            scalable: true,
          })),
        },
      ],
    },
  };
}

function normalizeWireHm(h: string): string | null {
  const m = h.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function patchDataFromWire(predictedType: OneTapPredictedType, wire: OneTapWireFields): Record<string, unknown> {
  if (predictedType === 'TASK') {
    const notes = wire.N ? wire.N.replace(/\|/g, ' ').slice(0, 2000) : undefined;
    const hm = wire.H ? normalizeWireHm(wire.H) : null;
    return {
      ...(wire.D && /^\d{4}-\d{2}-\d{2}$/.test(wire.D) ? { dueDateYmd: wire.D } : {}),
      ...(hm ? { dueTimeHm: hm } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
  }
  if (predictedType === 'RECURRING_TASK') {
    return {
      ...(wire.C ? { cadenceDescription: wire.C.slice(0, 500) } : {}),
      ...(wire.D && /^\d{4}-\d{2}-\d{2}$/.test(wire.D) ? { nextDueYmd: wire.D } : {}),
      ...(wire.N ? { anchorNotes: wire.N.slice(0, 2000) } : {}),
    };
  }
  if (predictedType === 'HABIT') {
    const hmH = wire.H ? normalizeWireHm(wire.H) : null;
    return {
      ...(wire.C ? { cadenceDescription: wire.C.slice(0, 500) } : {}),
      ...(hmH ? { preferredTimeHm: hmH } : {}),
      ...(wire.N ? { notes: wire.N.slice(0, 2000) } : {}),
    };
  }
  if (predictedType === 'LIST' && wire.L) {
    const items = wire.L.split(';').map((x) => x.trim()).filter(Boolean);
    return buildListDataFromWireItems(items, wire.T || '');
  }
  if (predictedType === 'ANNIVERSARY') {
    return {
      ...(wire.A ? { personName: wire.A.slice(0, 200) } : {}),
      ...(wire.G ? { monthDay: wire.G.slice(0, 32) } : {}),
    };
  }
  if (predictedType === 'NOTE' && wire.N) {
    return { memo: wire.N.slice(0, 4000) };
  }
  return {};
}

export function mergeWireIntoOneTapSkeleton(
  skeleton: OneTapUniversalResult,
  wire: OneTapWireFields,
): OneTapUniversalResult {
  const pRaw = wire.P?.trim().toUpperCase() ?? '';
  const predictedType = ONE_TAP_PREDICTED_TYPES.includes(pRaw as OneTapPredictedType)
    ? (pRaw as OneTapPredictedType)
    : skeleton.predictedType;
  const categoryTag = (wire.K?.trim() || skeleton.categoryTag || 'Perso').slice(0, 80) || 'Perso';
  const title = (wire.T?.trim() || skeleton.title || 'Note').trim().slice(0, 200);
  const mergedBase = mergeOneTapDataOnTypeChange(skeleton.predictedType, predictedType, skeleton.data, title);
  const wirePatch = patchDataFromWire(predictedType, wire);
  const data = normalizeUniversalTemporalInData({ ...mergedBase, ...wirePatch });
  return { predictedType, categoryTag, title, data };
}

function buildCompressedGeminiPrompt(transcript: string, seedLine: string, uiLocale: string): string {
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  const loc = String(uiLocale || 'fr').toLowerCase().startsWith('en')
    ? 'Prefer English for K, T, N, C, R text when natural.'
    : 'Préfère le français pour K, T, N, C, R quand c’est naturel.';
  return `${loc}
Local heuristic (refine or override if wrong):
${seedLine}

Dictation:
"""${safe.replace(/"/g, '\\"')}"""

Reply ONLY one KEY:value|KEY:value line (same key vocabulary as the guess).`;
}

/**
 * Path A — inférence locale ultra-rapide pour ouvrir la modale sans attendre le réseau.
 */
export function inferOneTapSkeletonFromTranscript(
  transcript: string,
  options: { uiLocale: string; titleHint?: string },
): OneTapUniversalResult {
  const cleaned = cleanTranscriptText(transcript);
  const lower = cleaned.toLowerCase();
  let predictedType: OneTapPredictedType = 'NOTE';

  if (/\b(courses|liste de|liste d'|acheter|ingrédients|ingredients|valise|packing|matériel pour|caddie)\b/i.test(cleaned)) {
    predictedType = 'LIST';
  } else if (/\b(anniversaire|fête de|fete de|né le|nee le)\b/i.test(cleaned) || /\b(mamie|papy|grand-mère|grand-père)\b/i.test(lower)) {
    predictedType = 'ANNIVERSARY';
  } else if (
    /\b(chaque jour|tous les jours|chaque matin|tous les matins|habitude|routine|quotidien)\b/i.test(cleaned) &&
    !/\b(demain|après-demain|à \d{1,2}[:h]\d{2})\b/i.test(cleaned)
  ) {
    predictedType = 'HABIT';
  } else if (/\b(chaque semaine|tous les lundis|toutes les semaines|récurrent|recurrent)\b/i.test(cleaned)) {
    predictedType = 'RECURRING_TASK';
  } else if (
    /\b(rappel|demain|après-demain|dans \d+\s*minutes?|à \d{1,2}[:h]\d{2}|rendez-vous|rdv)\b/i.test(cleaned) ||
    /\b(tâche|task)\b/i.test(lower)
  ) {
    predictedType = 'TASK';
  }

  let categoryTag = 'Perso';
  if (/\b(travail|bureau|réunion|client|linkedin|pro)\b/i.test(lower)) categoryTag = 'Travail';
  else if (/\b(famille|mamie|papa|maman|enfants|couple)\b/i.test(lower)) categoryTag = 'Famille';

  const title =
    (options.titleHint || generateSmartTitle(cleaned, options.uiLocale) || cleaned).trim().slice(0, 200) || 'Note';

  let base = defaultOneTapDataForType(predictedType);
  const ref = new Date();
  const chronoResults = chrono.parse(cleaned, ref, { forwardDate: true });
  if (chronoResults.length > 0 && (predictedType === 'TASK' || predictedType === 'NOTE' || predictedType === 'HABIT')) {
    const start = chronoResults[0].start?.date();
    if (start && !Number.isNaN(start.getTime())) {
      const y = start.getFullYear();
      const m = String(start.getMonth() + 1).padStart(2, '0');
      const day = String(start.getDate()).padStart(2, '0');
      const ymd = `${y}-${m}-${day}`;
      const hh = String(start.getHours()).padStart(2, '0');
      const mm = String(start.getMinutes()).padStart(2, '0');
      const hm = `${hh}:${mm}`;
      if (predictedType === 'TASK') {
        base = { ...base, dueDateYmd: ymd, dueTimeHm: hm, notes: cleaned.slice(0, 2000) };
      } else if (predictedType === 'HABIT') {
        base = { ...base, preferredTimeHm: hm, cadenceDescription: base.cadenceDescription || 'Quotidien' };
      }
    }
  }

  if (predictedType === 'LIST') {
    const items = cleaned
      .split(/[,;]|(?:\bpuis\b)|(?:\bet\b)/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 80)
      .slice(0, 24);
    if (items.length >= 1) {
      base = buildListDataFromWireItems(items, title) as Record<string, unknown>;
    }
  }

  if (predictedType === 'ANNIVERSARY') {
    const mPerson = cleaned.match(/(?:anniversaire|fête)\s+(?:de\s+)?(.+?)(?:\.|,|$)/i);
    const person = mPerson?.[1]?.trim().slice(0, 120) || title;
    base = { ...base, personName: person, monthDay: typeof base.monthDay === 'string' ? base.monthDay : '' };
  }

  if (predictedType === 'NOTE') {
    base = { ...base, memo: cleaned.slice(0, 4000) };
  }

  return {
    predictedType,
    categoryTag,
    title,
    data: normalizeUniversalTemporalInData(base),
  };
}

export type OneTapRefineOptions = {
  uiLocale: string;
  /** Si défini, appelé à chaque chunk utile (streaming). */
  onPartial?: (draft: OneTapUniversalResult) => void;
  /** false = un seul aller-retour HTTP (ex. machine à intentions). */
  useStream?: boolean;
};

/**
 * Path B — affinage Gemini (ligne compacte), avec option streaming pour l’UI optimiste.
 */
export async function refineOneTapWithGeminiCompressed(
  transcript: string,
  skeleton: OneTapUniversalResult,
  options: OneTapRefineOptions,
): Promise<{ parsed: OneTapUniversalResult; rawModelText: string }> {
  const seed = wireLineFromSkeleton(skeleton);
  const prompt = buildCompressedGeminiPrompt(transcript, seed, options.uiLocale);
  const useStream = options.useStream !== false;

  const applyBuffer = (buf: string) => {
    const wire = useStream ? parsePartialWireLine(buf) : parseOneTapWireLine(buf);
    if (Object.keys(wire).length === 0) return;
    const merged = mergeWireIntoOneTapSkeleton(skeleton, wire);
    options.onPartial?.(merged);
  };

  let rawModelText: string;
  if (useStream) {
    rawModelText = await geminiStreamOneTapCompressedLine(prompt, (acc) => applyBuffer(acc));
  } else {
    rawModelText = await geminiGenerateOneTapCompressedLine(prompt);
    applyBuffer(rawModelText);
  }

  let parsed = mergeWireIntoOneTapSkeleton(skeleton, parseOneTapWireLine(rawModelText));
  const jsonObj = tryParseJsonObjectBestEffort(rawModelText);
  if (jsonObj) {
    try {
      parsed = parseOneTapUniversalJson(JSON.stringify(jsonObj));
    } catch {
      /* keep wire merge */
    }
  }
  if (!parsed.title.trim()) {
    parsed = { ...parsed, title: skeleton.title };
  }
  return { parsed, rawModelText };
}

/**
 * Valide et normalise le JSON renvoyé par Gemini pour le flux one-tap.
 *
 * @param raw — Texte brut (JSON éventuellement entouré de ```).
 * @returns Objet {@link OneTapUniversalResult}.
 * @throws {Error} Si le JSON est invalide ou le type inconnu.
 */
export function parseOneTapUniversalJson(raw: string): OneTapUniversalResult {
  const s = stripJsonFences(raw);
  const obj = JSON.parse(s) as Record<string, unknown>;
  const predictedType = String(obj.predictedType || '').trim().toUpperCase();
  if (!ONE_TAP_PREDICTED_TYPES.includes(predictedType as OneTapPredictedType)) {
    throw new Error(`ONE_TAP_INVALID_TYPE:${predictedType}`);
  }
  const title = String(obj.title || '').trim();
  if (!title) {
    throw new Error('ONE_TAP_MISSING_TITLE');
  }
  const categoryTag = String(obj.categoryTag || 'Perso').trim() || 'Perso';
  const rawData =
    obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? (obj.data as Record<string, unknown>) : {};
  const data = normalizeUniversalTemporalInData(rawData);
  return {
    predictedType: predictedType as OneTapPredictedType,
    categoryTag,
    title,
    data,
  };
}

/**
 * Appelle Gemini Flash pour classifier et structurer la dictée en un coup.
 *
 * @param transcript — Texte final de la capture.
 * @param options.uiLocale — Locale UI pour orienter la langue des libellés.
 * @returns Résultat parsé + texte brut modèle (debug).
 */
export async function geminiOneTapUniversalFromTranscript(
  transcript: string,
  options: { uiLocale: string },
): Promise<{
  parsed: OneTapUniversalResult;
  rawModelText: string;
  timings: { promptChars: number; geminiStartMs: number; geminiEndMs: number; parseEndMs: number };
}> {
  const skeleton = inferOneTapSkeletonFromTranscript(transcript, { uiLocale: options.uiLocale });
  const geminiStartMs = perfNowMs();
  const { parsed, rawModelText } = await refineOneTapWithGeminiCompressed(transcript, skeleton, {
    uiLocale: options.uiLocale,
    useStream: false,
  });
  const geminiEndMs = perfNowMs();
  const parseEndMs = perfNowMs();
  const promptLen = buildCompressedGeminiPrompt(transcript, wireLineFromSkeleton(skeleton), options.uiLocale).length;
  console.log('[OneTapPerf] prompt.metrics', {
    promptChars: promptLen,
    geminiMs: Math.round(geminiEndMs - geminiStartMs),
    parseMs: Math.round(parseEndMs - geminiEndMs),
  });
  return { parsed, rawModelText, timings: { promptChars: promptLen, geminiStartMs, geminiEndMs, parseEndMs } };
}

/**
 * Données minimales par type lorsque l’utilisateur change le type dans l’UI.
 *
 * @param type — Type sélectionné.
 * @returns Objet **data** par défaut (non null).
 */
export function defaultOneTapDataForType(type: OneTapPredictedType): Record<string, unknown> {
  const u = universalTemporalDefaults();
  switch (type) {
    case 'TASK':
      return { ...u, dueDateYmd: null, dueTimeHm: null, reminderMinutesBefore: null, notes: '' };
    case 'RECURRING_TASK':
      return { ...u, cadenceDescription: '', nextDueYmd: null, anchorNotes: '' };
    case 'HABIT':
      return { ...u, cadenceDescription: '', preferredTimeHm: null, notes: '' };
    case 'LIST':
      return {
        ...u,
        list: {
          title: '',
          baseCount: 1,
          unitLabel: 'personne',
          categories: [
            { name: '—', items: [{ name: '—', baseQuantity: 1, unit: 'piece', scalable: true }] },
          ],
        },
      };
    case 'ANNIVERSARY':
      return { ...u, personName: '', monthDay: '', reminderDaysBefore: 7 };
    case 'NOTE':
    default:
      return { ...u, memo: '' };
  }
}

/**
 * Fusionne une ancienne charge **data** avec un nouveau type en conservant les champs compatibles (ex. titres implicites).
 *
 * @param prevType — Type précédent.
 * @param nextType — Type choisi dans le menu.
 * @param prevData — Données précédentes.
 * @param title — Titre courant (injecté dans list.title si liste vide).
 */
export function mergeOneTapDataOnTypeChange(
  prevType: OneTapPredictedType,
  nextType: OneTapPredictedType,
  prevData: Record<string, unknown>,
  title: string,
): Record<string, unknown> {
  if (prevType === nextType) return { ...prevData };
  const base = defaultOneTapDataForType(nextType);
  const tail = universalTailFromPrev(prevData);
  if (nextType === 'LIST') {
    const list = prevData.list && typeof prevData.list === 'object' ? (prevData.list as Record<string, unknown>) : null;
    if (list && Array.isArray(list.categories)) {
      return { list, ...tail };
    }
    const b = base.list as Record<string, unknown>;
    return { list: { ...b, title: title || String(b.title || '') }, ...tail };
  }
  if (nextType === 'TASK') {
    return {
      ...base,
      dueDateYmd: typeof prevData.dueDateYmd === 'string' ? prevData.dueDateYmd : prevData.nextDueYmd ?? null,
      notes: String(prevData.notes || prevData.memo || prevData.anchorNotes || ''),
      ...tail,
    };
  }
  if (nextType === 'NOTE') {
    return { memo: String(prevData.memo || prevData.notes || ''), ...tail };
  }
  return { ...base, ...prevData, ...tail };
}
