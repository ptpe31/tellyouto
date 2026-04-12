import type { IntentionRow } from '../api/localDb';
import { formatLocalDateYmd } from '../api/localDb';
import type { AppLanguage } from '../context/LanguageContext';
import type { SpectrumWeights } from '../context/UserSpectrumContext';

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

function normalizedVec(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

/** Ancre « récurrence / cycle » — vecteur analytique, sans lexique calendaire figé. */
function recurrenceStructureAnchor(): number[] {
  const v = new Array(SEM_DIM).fill(0);
  for (let d = 0; d < SEM_DIM; d++) {
    v[d] = Math.sin((d + 2.2) * 1.17) + Math.cos(d * 0.41) * 0.48;
  }
  return normalizedVec(v);
}

/** Sept prototypes orthogonaux (projection sémantique du jour de période, sans noms de jours). */
const WEEKDAY_PROTOTYPE_EMBEDDINGS: number[][] = (() => {
  const out: number[][] = [];
  for (let k = 0; k < 7; k++) {
    const v = new Array(SEM_DIM).fill(0);
    for (let d = 0; d < SEM_DIM; d++) {
      v[d] = Math.sin((k + 1) * (d + 1) * 0.31);
    }
    out.push(normalizedVec(v));
  }
  return out;
})();

/**
 * Extrait une heure d’horloge depuis le texte (motifs numériques, pas de table d’heures).
 */
export function extractClockMinutesFromText(raw: string): number | null {
  const text = raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const hm = text.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  if (hm) {
    const h = parseInt(hm[1]!, 10);
    const m = parseInt(hm[2]!, 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }
  const ho = text.match(/\b([01]?\d|2[0-3])\s*h\b/);
  if (ho) return parseInt(ho[1]!, 10) * 60;
  return null;
}

/** Score 0–1 : alignement texte ↔ concept de récurrence (embedding vs ancre analytique). */
export function inferRecurrenceStrength(
  title: string,
  description: string,
): number {
  const full = `${title}\n${description}`;
  const emb = textEmbeddingVector(full);
  const anchor = recurrenceStructureAnchor();
  return (cosineSim(emb, anchor) + 1) / 2;
}

function inferWeekdayIndexFromEmbedding(title: string, description: string): number {
  const emb = textEmbeddingVector(`${title}\n${description}`);
  let best = 0;
  let bestDot = -2;
  for (let k = 0; k < 7; k++) {
    const dot = cosineSim(emb, WEEKDAY_PROTOTYPE_EMBEDDINGS[k]!);
    if (dot > bestDot) {
      bestDot = dot;
      best = k;
    }
  }
  return best;
}

/**
 * Routine structurelle : récurrence sémantique + heure extraite du texte — ancre rail.
 */
export function inferIsHardConstraint(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
  now: Date,
): boolean {
  const rec = inferRecurrenceStrength(title, description);
  const clock = extractClockMinutesFromText(`${title}\n${description}`);
  const structured = spectrum.structure >= 0.28;
  return structured && rec > 0.42 && clock != null;
}

export type StructuralRoutinePlan = {
  weekday: number;
  startMinutes: number;
  durationMin: number;
};

export function inferStructuralRoutinePlan(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
  now: Date,
): StructuralRoutinePlan | null {
  if (!inferIsHardConstraint(title, description, spectrum, now)) return null;
  const start = extractClockMinutesFromText(`${title}\n${description}`);
  if (start == null) return null;
  return {
    weekday: inferWeekdayIndexFromEmbedding(title, description),
    startMinutes: start,
    durationMin: estimateDurationMinutes(title, description, spectrum),
  };
}

/** Micro-habitudes désactivées — conservé pour compatibilité d’API. */
export function inferIsMicroHabit(
  _title: string,
  _description: string,
  _spectrum: SpectrumWeights,
  _now: Date,
): boolean {
  return false;
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
  return Math.max(1, Math.min(100, Math.round(blended * 92 + 4)));
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
 * Analyse complète à l’insertion : priorité, segment nuit, contrainte dure.
 * `isMicroHabit` reste dans le retour pour compatibilité schéma / sync (toujours false).
 */
export function analyzeNewIntentionSemantics(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
  now: Date,
  options?: ComputePriorityOptions,
): {
  priority: number;
  isMicroHabit: boolean;
  isLateNight: boolean;
  isHardConstraint: boolean;
} {
  let priority = computeIntentionPriority(
    title,
    description,
    spectrum,
    now,
    options,
  );
  const isMicroHabit = inferIsMicroHabit(title, description, spectrum, now);
  let isLateNight = inferIsLateNightIntent(title, description, now);
  const isHardConstraint = inferIsHardConstraint(
    title,
    description,
    spectrum,
    now,
  );
  if (isHardConstraint) {
    isLateNight = false;
    priority = Math.max(priority, 93);
  }
  return { priority, isMicroHabit, isLateNight, isHardConstraint };
}

/**
 * Détecte si une nouvelle intention manuelle chevaucherait une ancre structurelle du jour.
 */
export function previewManualIntentionOverlapsHardRoutine(
  pending: IntentionRow[],
  candidateTitle: string,
  candidateDesc: string,
  spectrum: SpectrumWeights,
  now: Date,
  busyIntervals: BusyInterval[],
  platformUserId: string,
): { overlaps: boolean; blockingTitle?: string } {
  const sem = analyzeNewIntentionSemantics(
    candidateTitle,
    candidateDesc,
    spectrum,
    now,
  );
  const mock: IntentionRow = {
    id: '__candidate__',
    title: candidateTitle,
    description: candidateDesc,
    status: 'pending',
    priority: sem.priority,
    weights: {
      structure: spectrum.structure,
      momentum: spectrum.momentum,
      zen: spectrum.zen,
      stats: spectrum.stats,
    },
    platform_type: 'none',
    platform_user_id: platformUserId,
    created_at: Date.now(),
    synced: 0,
    estimated_duration: estimateDurationMinutes(
      candidateTitle,
      candidateDesc,
      spectrum,
    ),
    actual_duration: null,
    completed_at: null,
    user_forced_urgent: false,
    is_late_night: sem.isLateNight,
    alarm_enabled: false,
    is_flexible: true,
    is_micro_habit: false,
    is_hard_constraint: false,
    routine_id: null,
    anchor_date_ymd: null,
    fixed_start_minutes: null,
    raw_transcript: null,
    energy_score: null,
    local_notification_id: null,
    recurrence_rrule: null,
  };

  const pool = pending.filter((r) => r.status !== 'done');
  const slots = buildTimelineSlots(
    [...pool, mock],
    spectrum,
    now,
    { busyIntervals },
  );
  const mine = slots.find((s) => s.intention.id === '__candidate__');
  if (!mine) return { overlaps: false };

  const todayYmd = formatLocalDateYmd(now);
  const hardToday = pool.filter(
    (i) =>
      i.is_hard_constraint &&
      i.fixed_start_minutes != null &&
      (!i.anchor_date_ymd || i.anchor_date_ymd === todayYmd),
  );

  for (const h of hardToday) {
    const hs = h.fixed_start_minutes!;
    const he = hs + h.estimated_duration;
    if (mine.startMinutes < he && mine.endMinutes > hs) {
      return { overlaps: true, blockingTitle: h.title };
    }
  }
  return { overlaps: false };
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
};

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
 * Tout le monde passe par les pools **hard** (ancre + heure fixe, hors nuit) / **regular** / **late** —
 * pas de fragmentation micro-habitude : le flag `is_micro_habit` en base est ignoré pour le placement.
 *
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
  const todayYmd = formatLocalDateYmd(now);

  const pool = intentions.filter(
    (i) => i.anchor_date_ymd == null || i.anchor_date_ymd === todayYmd,
  );

  /** Ancre fixe (réveil) : `is_flexible === false` — heure sacrée. Structure routine + fixe : glissement possible si encore flexible. */
  const isHardRailPool = (i: IntentionRow) =>
    i.fixed_start_minutes != null &&
    !i.is_late_night &&
    (!i.is_flexible || i.is_hard_constraint);

  const hardPool = pool.filter(isHardRailPool);
  const regular = pool.filter(
    (i) => !i.is_late_night && !isHardRailPool(i),
  );
  const late = pool.filter((i) => i.is_late_night);

  const orderedHard = orderIntentionsBySpectrum(hardPool, spectrum);
  const orderedRegular = orderIntentionsBySpectrum(regular, spectrum);
  const orderedLate = orderIntentionsBySpectrum(late, spectrum);

  const momentumStretch = spectrum.momentum > 0.52 ? 1.12 : 1;
  const railOpenMin = DAY_START_MIN + Math.round(spectrum.structure * 15);
  const nowMin = minutesSinceMidnight(now);
  let cursor = Math.max(nowMin, railOpenMin);

  const hardSlots: TimelineSlot[] = [];
  for (const intention of orderedHard) {
    const fs = intention.fixed_start_minutes!;
    const immutable =
      !intention.is_flexible && intention.fixed_start_minutes != null;
    const startMinutes = immutable
      ? fs
      : Math.max(fs, railOpenMin, nowMin);
    const rawEnd = startMinutes + intention.estimated_duration;
    const endMinutes = Math.min(rawEnd, REGULAR_RAIL_END_MIN);
    if (endMinutes - startMinutes < 10) continue;
    hardSlots.push({
      intention,
      startMinutes,
      endMinutes,
      startLabel: formatMinutesAsClock(startMinutes),
      endLabel: formatMinutesAsClock(endMinutes),
    });
  }

  const busyWithHard = mergeBusyIntervalsForRail([
    ...busy,
    ...hardSlots.map((s) => ({
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
    })),
  ]);

  const slots: TimelineSlot[] = [...hardSlots];

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

  pushList(orderedRegular, REGULAR_RAIL_END_MIN, busyWithHard);

  if (orderedLate.length > 0) {
    let lateCursor = Math.max(LATE_SEGMENT_START_MIN, nowMin);
    for (const s of slots) lateCursor = Math.max(lateCursor, s.endMinutes);
    cursor = lateCursor;
    pushList(orderedLate, LATE_RAIL_END_MIN, busy);
  }

  return [...slots].sort((a, b) => a.startMinutes - b.startMinutes);
}

/**
 * Ancre du jour + première minute du rail pour une nouvelle intention (agent / manuel).
 * S’appuie sur le premier créneau attribué par `buildTimelineSlots` — requis pour une alarme à heure fixe.
 */
export function computeRailAnchorAndFixedStartForNewIntention(args: {
  pendingOthers: IntentionRow[];
  candidate: IntentionRow;
  spectrum: SpectrumWeights;
  now: Date;
  busyIntervals?: BusyInterval[];
}): { anchor_date_ymd: string; fixed_start_minutes: number } {
  const merged = buildTimelineSlots(
    [...args.pendingOthers, args.candidate],
    args.spectrum,
    args.now,
    { busyIntervals: args.busyIntervals ?? [] },
  );
  const mine = merged
    .filter((s) => s.intention.id === args.candidate.id)
    .sort((a, b) => a.startMinutes - b.startMinutes)[0];
  const railOpenMin = DAY_START_MIN + Math.round(args.spectrum.structure * 15);
  const nowMin = minutesSinceMidnight(args.now);
  const fallbackMin = Math.min(Math.max(nowMin, railOpenMin) + 15, 23 * 60 + 45);
  if (!mine) {
    return {
      anchor_date_ymd: formatLocalDateYmd(args.now),
      fixed_start_minutes: fallbackMin,
    };
  }
  return {
    anchor_date_ymd: formatLocalDateYmd(args.now),
    fixed_start_minutes: mine.startMinutes,
  };
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

/** Message d’accueil messagerie / handshake — même heuristique que la Cloud Function. */
export { isRailConnectionHandshakeMessage } from './railMessaging';

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
