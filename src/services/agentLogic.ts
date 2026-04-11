import type { AppLanguage } from '../context/LanguageContext';
import type { SpectrumWeights } from '../context/UserSpectrumContext';
import type { IntentionRow } from '../api/localDb';

/** Mots-clés multilingues (FR/EN + racines communes) pour estimer l’alignement par dimension */
const STRUCTURE_KEYS = [
  'plan',
  'liste',
  'ordre',
  'priorité',
  'priorite',
  'bloc',
  'deadline',
  'agenda',
  'calendar',
  'structure',
  'organ',
  'cadre',
  'outline',
  'roadmap',
  'routine',
];

const MOMENTUM_KEYS = [
  'vite',
  'now',
  'immédiat',
  'immediate',
  'lancer',
  'rush',
  'action',
  'dynamic',
  'sprint',
  'rapid',
  'today',
];

const ZEN_KEYS = [
  'pause',
  'calme',
  'respir',
  'slow',
  'espace',
  'clarté',
  'clarte',
  'mindful',
  'calm',
  'quiet',
];

const STATS_KEYS = [
  'mesure',
  'chiffre',
  'metric',
  'kpi',
  'data',
  'nombre',
  'score',
  'analytics',
  'graph',
  'number',
];

function scoreDimension(text: string, keys: string[]): number {
  const t = text.toLowerCase();
  let hits = 0;
  for (const k of keys) {
    if (t.includes(k.toLowerCase())) hits += 1;
  }
  return Math.min(1, hits / 4);
}

/** Amorce stable 85–90 pour les urgences utilisateur */
function stableHashForPriority(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Indices d’importance (multilingues) — inférence légère, pas de liste FR figée seule.
 */
const HIGH_IMPORTANCE_STEMS = [
  'exam',
  'examen',
  'révis',
  'revis',
  'revision',
  'deadline',
  'urgent',
  'interview',
  'santé',
  'medical',
  'présentation',
  'presentation',
  'dossier',
  'impôt',
  'steuer',
  'taxes',
  'contrat',
  'licenci',
  'board',
  'qbr',
];

const LOW_IMPORTANCE_STEMS = [
  'arroser',
  'fleur',
  'flower',
  'plante',
  'plant',
  'nettoyer',
  'ménage',
  'menage',
  'netflix',
  'serie',
  'series',
  'jeu',
  'game',
  'détente',
  'detente',
  'promenade',
  'walk',
];

function scoreSemanticImportance(textRaw: string, now: Date): number {
  const text = textRaw.toLowerCase();
  let high = 0;
  let low = 0;
  for (const w of HIGH_IMPORTANCE_STEMS) {
    if (text.includes(w)) high += 1;
  }
  for (const w of LOW_IMPORTANCE_STEMS) {
    if (text.includes(w)) low += 1;
  }
  let score = 0.28 + Math.min(0.42, high * 0.07) - Math.min(0.22, low * 0.09);
  if (
    /\b(demain|tomorrow|morgen|mañana|明日|明天)\b/i.test(text) &&
    /révis|revis|stud|exam|test|examen|presentation|présent/i.test(text)
  ) {
    score += 0.18;
  }
  const h = now.getHours();
  if (h >= 11 && h <= 16 && /\b(aujourd|today|heute|hoy|今日|今天)\b/i.test(text)) {
    if (/révis|revis|exam|deadline|rendu|due/i.test(text)) score += 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

export type ComputePriorityOptions = {
  userForcedUrgent?: boolean;
};

/** Embedding léger (n-grammes de caractères) — aucune liste lexicale figée. */
const SEM_DIM = 14;

function textEmbeddingVector(raw: string): number[] {
  const v = new Array(SEM_DIM).fill(0);
  const norm = raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (norm.length < 2) {
    const m = Math.sqrt(SEM_DIM) || 1;
    return v.map(() => 1 / m);
  }
  for (let i = 0; i <= norm.length - 2; i++) {
    const a = norm.charCodeAt(i);
    const b = norm.charCodeAt(i + 1);
    const g = (Math.imul(a, 1315423911) ^ Math.imul(b, 2654435761)) >>> 0;
    for (let d = 0; d < SEM_DIM; d++) {
      v[d] += Math.sin(((g + d * 9973) % 6283) / 1000);
    }
  }
  const scale = norm.length * 0.085;
  for (let d = 0; d < SEM_DIM; d++) v[d] /= scale;
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

/** Ancre « bien-être / entretien » dérivée du spectre — l’agent projette le profil utilisateur. */
function spectrumWellnessAnchor(s: SpectrumWeights): number[] {
  const v = new Array(SEM_DIM).fill(0);
  v[0] = s.zen * 1.15;
  v[1] = (s.structure + s.zen) * 0.35;
  v[2] = (1 - s.momentum) * 0.55;
  v[3] = s.stats * 0.25;
  for (let d = 4; d < SEM_DIM; d++) {
    v[d] = Math.sin((s.zen * 6.2 + s.structure * 3.1 + d * 0.37) % 6.283) * 0.42;
  }
  const m = Math.sqrt(v.reduce((s2, x) => s2 + x * x, 0)) || 1;
  return v.map((x) => x / m);
}

function cosineSim(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Détecte une micro-habitude (soin répété, léger) par alignement texte ↔ ancre spectrale,
 * brièveté et absence de jalons « projet » — pas de liste de mots-clés en dur.
 */
export function inferIsMicroHabit(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
  now: Date,
): boolean {
  const full = `${title}\n${description}`;
  const emb = textEmbeddingVector(full);
  const anchor = spectrumWellnessAnchor(spectrum);
  const align = (cosineSim(emb, anchor) + 1) / 2;
  const compact =
    title.length <= 72 && title.split(/\s+/).filter(Boolean).length <= 10
      ? 0.22
      : 0.08;
  const calmPrior = spectrum.zen * 0.14 + (1 - spectrum.momentum) * 0.06;
  const hourSpread = 1 - Math.min(1, Math.abs(now.getHours() - 14) / 12) * 0.04;
  let deadlinePenalty = 0;
  if (/\b20[2-3]\d\b/.test(full)) deadlinePenalty += 0.12;
  if (/\b(?:q[1-4]|sprint|milestone|jalon|deadline|due date)\b/i.test(full)) {
    deadlinePenalty += 0.1;
  }
  const score =
    align * 0.52 + compact + calmPrior + hourSpread * 0.06 - deadlinePenalty;
  return score > 0.54;
}

/**
 * Priorité 1–100 : combinaison alignement spectre + importance sémantique contextuelle (heure réelle).
 */
export function computeIntentionPriority(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
  now: Date,
  options?: ComputePriorityOptions,
): number {
  if (options?.userForcedUrgent) {
    return 85 + (stableHashForPriority(`${title}\n${description}`) % 6);
  }
  const text = `${title}\n${description}`;
  const dim = {
    structure: scoreDimension(text, STRUCTURE_KEYS),
    momentum: scoreDimension(text, MOMENTUM_KEYS),
    zen: scoreDimension(text, ZEN_KEYS),
    stats: scoreDimension(text, STATS_KEYS),
  };
  const alignment =
    dim.structure * spectrum.structure +
    dim.momentum * spectrum.momentum +
    dim.zen * spectrum.zen +
    dim.stats * spectrum.stats;
  const semantic = scoreSemanticImportance(text, now);
  const blended = alignment * 0.4 + semantic * 0.6;
  let p = Math.max(1, Math.min(100, Math.round(blended * 92 + 4)));
  if (inferIsMicroHabit(title, description, spectrum, now)) {
    p = Math.max(1, Math.round(p * 0.86));
  }
  return p;
}

/**
 * Heures tardives explicites dans le texte (22h–02h, formats variés).
 */
const LATE_HOUR_IN_TEXT =
  /(?:\b(?:2[0-3]|0?[0-2])\s*[:h]\s*[0-5]?\d\b)|(?:\b(?:22|23|24|0|1|2)\s*h\b)|(?:\b1[01]\s*(?:pm|p\.m\.)\b)/i;

/**
 * Amorce sémantique « fin de journée / sommeil » — grappe multilingue extensible (pas une liste FR unique).
 */
const LATE_NIGHT_SEMANTIC_BUNDLES = [
  'dormir',
  'sleep',
  'schlaf',
  'coucher',
  'couché',
  'couche',
  'soirée',
  'soiree',
  'evening',
  'night',
  'tonight',
  'ce soir',
  'ce-soir',
  'ton soir',
  'yoga nidra',
  'brush teeth',
  'brosser',
  'détente',
  'wind down',
  'routine du soir',
  'night routine',
  'bedtime',
  '寝る',
  '睡眠',
  '睡觉',
  '就寝',
];

/**
 * Détecte une intention typique de la fin de journée / nuit (motifs horaires + sémantique douce).
 */
export function inferIsLateNightIntent(
  title: string,
  description: string,
  now: Date,
): boolean {
  const text = `${title}\n${description}`.toLowerCase();
  if (LATE_HOUR_IN_TEXT.test(text)) return true;
  let hits = 0;
  for (const stem of LATE_NIGHT_SEMANTIC_BUNDLES) {
    if (text.includes(stem.toLowerCase())) hits += 1;
  }
  if (hits >= 2) return true;
  if (hits === 1 && /\b(tonight|soir|night|nuit|tonight|今晚|今夜)\b/i.test(text)) {
    return true;
  }
  const nh = now.getHours();
  if (nh >= 20 && nh <= 23 && hits >= 1) return true;
  return false;
}

/**
 * Analyse complète à l’insertion : priorité, nature micro-habitude, segment nuit.
 */
export function analyzeNewIntentionSemantics(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
  now: Date,
  options?: ComputePriorityOptions,
): { priority: number; isMicroHabit: boolean; isLateNight: boolean } {
  const priority = computeIntentionPriority(
    title,
    description,
    spectrum,
    now,
    options,
  );
  const isMicroHabit = inferIsMicroHabit(title, description, spectrum, now);
  let isLateNight = inferIsLateNightIntent(title, description, now);
  if (isMicroHabit) isLateNight = false;
  return { priority, isMicroHabit, isLateNight };
}

/**
 * Durée estimée (minutes) — ajustée au spectre (Momentum → blocs plus longs, Zen → plus courts).
 */
export function estimateDurationMinutes(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
): number {
  const base = 25;
  const lenBoost = Math.min(20, (title.length + description.length) / 5);
  const momentumBoost = spectrum.momentum * 18;
  const zenTrim = spectrum.zen * 12;
  const structureBoost = spectrum.structure * 8;
  const raw = base + lenBoost + momentumBoost - zenTrim + structureBoost;
  return Math.max(10, Math.min(95, Math.round(raw)));
}

export type TimelineSlot = {
  intention: IntentionRow;
  startMinutes: number;
  endMinutes: number;
  /** Libellés HH:mm pour affichage */
  startLabel: string;
  endLabel: string;
  /** Pastilles micro-habitudes (fragments courts) */
  railVariant?: 'default' | 'micro_pastille';
  microFragmentIndex?: number;
  microFragmentTotal?: number;
};

/** Durée d’un fragment micro-habitude (minutes). */
export const MICRO_FRAGMENT_DURATION_MIN = 2;
const MICRO_FRAGMENTS_MIN = 6;
const MICRO_FRAGMENTS_MAX = 8;

function microFragmentCountForIntention(id: string): number {
  const h = stableHashForPriority(id);
  return MICRO_FRAGMENTS_MIN + (h % (MICRO_FRAGMENTS_MAX - MICRO_FRAGMENTS_MIN + 1));
}

function findFreeGapsInRange(
  blocks: BusyInterval[],
  rangeStart: number,
  rangeEnd: number,
  minChunk: number,
): { start: number; end: number }[] {
  const merged = mergeBusyIntervalsForRail(blocks).filter(
    (b) => b.endMinutes > rangeStart && b.startMinutes < rangeEnd,
  );
  const gaps: { start: number; end: number }[] = [];
  let cur = rangeStart;
  for (const b of merged) {
    const bs = Math.max(rangeStart, b.startMinutes);
    const be = Math.min(rangeEnd, b.endMinutes);
    if (bs > cur && bs - cur >= minChunk) {
      gaps.push({ start: cur, end: bs });
    }
    cur = Math.max(cur, be);
    if (cur >= rangeEnd) break;
  }
  if (rangeEnd > cur && rangeEnd - cur >= minChunk) {
    gaps.push({ start: cur, end: rangeEnd });
  }
  return gaps;
}

function allocateMicroInGapsRoundRobin(
  gaps: { start: number; end: number }[],
  count: number,
  chunk: number,
): { start: number; end: number }[] {
  const work = gaps
    .filter((g) => g.end - g.start >= chunk)
    .map((g) => ({ start: g.start, end: g.end }));
  const out: { start: number; end: number }[] = [];
  let need = count;
  let idx = 0;
  let guard = 0;
  while (need > 0 && work.length > 0 && guard < 4000) {
    guard++;
    let placedRound = false;
    const len = work.length;
    for (let r = 0; r < len && need > 0; r++) {
      const gi = (idx + r) % work.length;
      const g = work[gi]!;
      if (g.end - g.start >= chunk) {
        const s = g.start;
        const e = s + chunk;
        out.push({ start: s, end: e });
        g.start = e;
        need--;
        placedRound = true;
        idx = (gi + 1) % work.length;
      }
    }
    if (!placedRound) break;
    for (let i = work.length - 1; i >= 0; i--) {
      if (work[i]!.end - work[i]!.start < chunk) work.splice(i, 1);
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Créneaux indisponibles (calendrier externe, etc.) — minutes depuis minuit, sans données sensibles. */
export type BusyInterval = {
  startMinutes: number;
  endMinutes: number;
};

function mergeBusyIntervalsForRail(
  intervals: BusyInterval[],
): BusyInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMinutes - b.startMinutes);
  const out: BusyInterval[] = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.startMinutes <= cur.endMinutes) {
      cur.endMinutes = Math.max(cur.endMinutes, n.endMinutes);
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

/**
 * Trouve un placement [start, start+dur] dans [segmentStart, segmentEnd) en évitant les busy.
 */
function placeBlockAvoidingBusy(
  cursor: number,
  duration: number,
  busy: BusyInterval[],
  segmentEnd: number,
): { start: number; end: number } | null {
  let start = cursor;
  let end = start + duration;
  let guard = 0;
  while (guard++ < 64) {
    let moved = false;
    for (const b of busy) {
      if (start < b.endMinutes && end > b.startMinutes) {
        start = b.endMinutes;
        end = start + duration;
        moved = true;
        if (start >= segmentEnd) return null;
        if (end > segmentEnd) return null;
      }
    }
    if (!moved) break;
  }
  if (end > segmentEnd || start >= segmentEnd) return null;
  return { start, end };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatMinutesAsClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.floor(totalMinutes % 60);
  return `${pad2(h)}:${pad2(m)}`;
}

/** Minutes depuis minuit (heure locale) */
function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

const DAY_START_MIN = 8 * 60;
/** Fin des créneaux « journée » (avant le segment fin de soirée). */
const REGULAR_RAIL_END_MIN = 20 * 60;
/** Intentions fin de nuit : à partir de 21h (heure locale). */
const LATE_SEGMENT_START_MIN = 21 * 60;
const LATE_RAIL_END_MIN = 23 * 60 + 45;

function spectrumEnergyHigh(spectrum: SpectrumWeights): boolean {
  return spectrum.momentum + spectrum.stats >= spectrum.structure + spectrum.zen;
}

/**
 * Ordre rail : priorité décroissante, puis densité (blocs plus lourds en premier si l’énergie
 * Momentum+Stats domine ; sinon blocs plus légers en premier).
 */
export function orderIntentionsBySpectrum(
  intentions: IntentionRow[],
  spectrum: SpectrumWeights,
): IntentionRow[] {
  const heavyFirst = spectrumEnergyHigh(spectrum);
  return [...intentions].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const da = a.estimated_duration;
    const db = b.estimated_duration;
    if (db !== da) return heavyFirst ? db - da : da - db;
    return b.created_at - a.created_at;
  });
}

/**
 * Répartit les intentions : jamais dans le passé ; jour jusqu’à 20h ; fin de nuit après 21h.
 * Les micro-habitudes sont fragmentées en 6–8 créneaux de 2 min dans les creux du rail.
 * `busyIntervals` : blocs indisponibles (ex. calendrier système **connectés** dans les réglages) —
 * traités **uniquement en local**. Les calendriers « masqués sur le rail » mais connectés doivent
 * être inclus ici pour le placement ; l’affichage séparé est géré par l’écran (créneaux visibles).
 */
export function buildTimelineSlots(
  intentions: IntentionRow[],
  spectrum: SpectrumWeights,
  now: Date = new Date(),
  options?: { busyIntervals?: BusyInterval[] },
): TimelineSlot[] {
  const busy = mergeBusyIntervalsForRail(options?.busyIntervals ?? []);

  const regular = intentions.filter((i) => !i.is_late_night && !i.is_micro_habit);
  const microList = intentions.filter((i) => i.is_micro_habit && !i.is_late_night);
  const late = intentions.filter((i) => i.is_late_night && !i.is_micro_habit);

  const orderedRegular = orderIntentionsBySpectrum(regular, spectrum);
  const orderedMicro = orderIntentionsBySpectrum(microList, spectrum);
  const orderedLate = orderIntentionsBySpectrum(late, spectrum);

  const momentumStretch = spectrum.momentum > 0.52 ? 1.12 : 1;
  const railOpenMin = DAY_START_MIN + Math.round(spectrum.structure * 15);
  const nowMin = minutesSinceMidnight(now);
  let cursor = Math.max(nowMin, railOpenMin);

  const slots: TimelineSlot[] = [];

  const pushList = (
    list: IntentionRow[],
    segmentEnd: number,
    busyForPlace: BusyInterval[],
  ) => {
    for (const intention of list) {
      if (cursor >= segmentEnd) break;

      const maxDur = segmentEnd - cursor;
      if (maxDur < 10) break;

      let dur = Math.round(intention.estimated_duration * momentumStretch);
      dur = Math.max(10, Math.min(maxDur, dur));

      const placed = placeBlockAvoidingBusy(cursor, dur, busyForPlace, segmentEnd);
      if (!placed) break;

      const startMinutes = placed.start;
      const endMinutes = placed.end;

      slots.push({
        intention,
        startMinutes,
        endMinutes,
        startLabel: formatMinutesAsClock(startMinutes),
        endLabel: formatMinutesAsClock(endMinutes),
      });

      cursor = endMinutes;
    }
  };

  pushList(orderedRegular, REGULAR_RAIL_END_MIN, busy);

  const occupiedForMicro: BusyInterval[] = [
    ...busy,
    ...slots.map((s) => ({
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
    })),
  ];

  const microSlots: TimelineSlot[] = [];
  let occMicro = mergeBusyIntervalsForRail(occupiedForMicro);

  for (const mInt of orderedMicro) {
    const nFrag = microFragmentCountForIntention(mInt.id);
    const rangeLo = Math.max(railOpenMin, nowMin);
    const gaps = findFreeGapsInRange(
      occMicro,
      rangeLo,
      REGULAR_RAIL_END_MIN,
      MICRO_FRAGMENT_DURATION_MIN,
    );
    const placements = allocateMicroInGapsRoundRobin(
      gaps,
      nFrag,
      MICRO_FRAGMENT_DURATION_MIN,
    );
    const total = placements.length;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]!;
      microSlots.push({
        intention: mInt,
        startMinutes: p.start,
        endMinutes: p.end,
        startLabel: formatMinutesAsClock(p.start),
        endLabel: formatMinutesAsClock(p.end),
        railVariant: 'micro_pastille',
        microFragmentIndex: i + 1,
        microFragmentTotal: total,
      });
      occMicro.push({
        startMinutes: p.start,
        endMinutes: p.end,
      });
    }
    occMicro = mergeBusyIntervalsForRail(occMicro);
  }

  if (orderedLate.length > 0) {
    let lateCursor = Math.max(LATE_SEGMENT_START_MIN, nowMin);
    for (const s of slots) lateCursor = Math.max(lateCursor, s.endMinutes);
    for (const s of microSlots) lateCursor = Math.max(lateCursor, s.endMinutes);
    cursor = lateCursor;
    pushList(orderedLate, LATE_RAIL_END_MIN, busy);
  }

  const merged = [...slots, ...microSlots].sort(
    (a, b) => a.startMinutes - b.startMinutes,
  );
  return merged;
}

/** Indique si un créneau [startMin, endMin] chevauche un intervalle occupé. */
export function slotOverlapsBusyIntervals(
  startMin: number,
  endMin: number,
  busy: BusyInterval[],
): boolean {
  for (const b of busy) {
    if (startMin < b.endMinutes && endMin > b.startMinutes) return true;
  }
  return false;
}

export type SpectrumAxis = 'structure' | 'momentum' | 'zen' | 'stats';

function dominantAxis(w: SpectrumWeights): SpectrumAxis {
  const entries: [SpectrumAxis, number][] = [
    ['structure', w.structure],
    ['momentum', w.momentum],
    ['zen', w.zen],
    ['stats', w.stats],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/** Axe le plus fort du spectre — pour la voix de l’Allié, stats, etc. */
export function getDominantSpectrumAxis(w: SpectrumWeights): SpectrumAxis {
  return dominantAxis(w);
}

/** Félicitations + tonalité : Zen = plus posé / long ; Momentum = plus court et dynamique */
const ENCOURAGEMENT: Record<
  AppLanguage,
  Record<SpectrumAxis, string>
> = {
  fr: {
    structure:
      'Bravo — ta navigation gagne en structure. Le co-pilote valide ta clarté sur la suite.',
    momentum:
      'Bravo — tu as tenu le tempo. Enchaîne quand tu veux, l’élan est là.',
    zen:
      'Magnifique présence. Tu as offert à ton intention un espace calme — respire, c’est bien avancé.',
    stats:
      'Félicitations : tes repères parlent. Continue à ajuster le cap avec cette précision.',
  },
  en: {
    structure:
      'Nice work — your navigation just got clearer. The co-pilot nods: you know what’s next.',
    momentum:
      'You kept the pace—high energy done right. Ready for the next push when you are.',
    zen:
      'Beautiful focus. You gave this intention room to breathe—soft, steady, well played.',
    stats:
      'Strong signals. Your course looks sharper—keep steering with that clarity.',
  },
  es: {
    structure:
      'Bravo: tu navegación gana estructura. El co-piloto valida tu claridad sobre lo próximo.',
    momentum:
      'Ritmo impecable. Motor caliente — el siguiente sprint cuando quieras.',
    zen:
      'Hermosa presencia. Diste espacio tranquilo a esta intención — bien jugado.',
    stats:
      'Felicidades: tus señales afilan el rumbo. Sigue con esa precisión.',
  },
  de: {
    structure:
      'Starke Leistung — mehr Struktur in deiner Navigation. Der Co-Pilot bestätigt: du weißt, was folgt.',
    momentum:
      'Tempo gehalten. Energie sauber eingesetzt — nächster Schub, wenn du willst.',
    zen:
      'Ruhige Präsenz. Du hast dieser Absicht Raum gegeben — weich, klar, gut gemacht.',
    stats:
      'Klare Kennzahlen. Dein Kurs wirkt schärfer — weiter so.',
  },
  it: {
    structure:
      'Bravo — più struttura nella tua navigazione. Il co-pilota conferma la chiarezza sul dopo.',
    momentum:
      'Hai tenuto il ritmo. Energia pulita — prossima spinta quando vuoi.',
    zen:
      'Presenza bellissima. Hai dato spazio calmo a questa intenzione — ben fatto.',
    stats:
      'Ottimi segnali. La rotta è più nitida — continua così.',
  },
  ja: {
    structure:
      'よくできました。ナビがより構造化されました。次への明瞭さ、コパイロットも肯定します。',
    momentum:
      'テンポ維持、ナイス。次の一押しは、あなたのタイミングで。',
    zen:
      '静かな集中、素晴らしい。この意図に余白を与えられました。',
    stats:
      '指標が冴えています。その精度で針路を保ってください。',
  },
  zh: {
    structure:
      '做得好——你的导航更有结构。副驾驶认可你对下一步的清晰。',
    momentum:
      '节奏稳、能量足。想推进时随时继续。',
    zen:
      '很棒的在场感。你为这条意图留出了安静的空间——温柔而稳。',
    stats:
      '信号清晰，路径更锐。保持这份精确。',
  },
};

/**
 * Notification de félicitations — ton calme si Zen domine, plus vif si Momentum domine (via texte).
 * Utiliser avec `useUserSpectrum().spectrum` pour les poids.
 */
export function generateEncouragement(
  spectrum: SpectrumWeights,
  language: AppLanguage,
): string {
  const axis = getDominantSpectrumAxis(spectrum);
  const pack = ENCOURAGEMENT[language] ?? ENCOURAGEMENT.en;
  return pack[axis] ?? pack.momentum;
}
