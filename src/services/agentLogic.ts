/**
 * Logique « agent » locale : priorisation, rail temporel, extraction d’heure, encouragement.
 *
 * **Pourquoi ce module existe** : tout le raisonnement sur les intentions doit rester **déterministe,
 * testable et hors réseau** pour que l’utilisateur garde confiance quand le cloud est absent.
 *
 * ---
 * ### Loi du système — priorité du titre et ancrage horaire (ne pas casser)
 *
 * Une intention peut contenir une **heure explicite** dans le libellé. Dans ce cas, la minute
 * retournée par {@link extractClockMinutesFromText} et {@link computeRailAnchorAndFixedStartForNewIntention}
 * est une **décision produit** : elle **prime** sur le placement fluide du rail (Momentum / Zen / busy).
 * Ne jamais « optimiser » par-dessus cette valeur pour coller au rail : c’était la source de
 * **dérive temporelle** (alarme décalée, utilisateur perd confiance).
 *
 * - Ne pas court-circuiter l’ordre **titre → minute fixe → rail** sans revue produit + tests alarme.
 * - Toute nouvelle heuristique de placement doit **ignorer** ou **respecter** `fixed_start_minutes`
 * selon `is_flexible`, pas les mélanger implicitement.
 *
 * @module agentLogic
 */
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

/**
 * Options communes pour l’analyse à l’insertion (priorité, extraction d’heure contextualisée).
 */
export type ComputePriorityOptions = {
  /** Priorité artificiellement haute si l’utilisateur a marqué l’intention comme urgente. */
  userForcedUrgent?: boolean;
  /** Tag BCP‑47 pour `Intl` / parsing (souvent `expo-localization`). */
  systemLocale?: string;
  /** Langue d’interaction (profil ou UI) — second recours si la locale système est absente. */
  aiLanguage?: string;
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

/** Contexte pour extraction : locales système / IA + instant de référence (désambiguïsation). */
export type UniversalTimeExtractOptions = {
  /** Ex. `expo-localization` `getLocales()[0].languageTag` */
  systemLocale?: string;
  /** Ex. langue d’interaction (chaîne courte ou BCP-47) */
  aiLanguage?: string;
  /** Référence pour « prochaine occurrence » ; défaut : maintenant */
  now?: Date;
};

function resolveEffectiveLocaleTag(
  systemLocale?: string,
  aiLanguage?: string,
): string {
  const a = systemLocale?.trim();
  if (a) return a;
  const b = aiLanguage?.trim();
  if (b) return b;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en-US';
  }
}

/** Indique si `Intl` attend un cycle 12h pour l’étiquetage (sans nommer de territoire). */
function resolvedHourCycleIs12(localeTag: string): boolean {
  try {
    const r = new Intl.DateTimeFormat(localeTag, {
      hour: 'numeric',
    }).resolvedOptions();
    return r.hourCycle === 'h11' || r.hourCycle === 'h12';
  } catch {
    return false;
  }
}

function clampMinuteOfDay(m: number): number {
  let x = Math.floor(m) % 1440;
  if (x < 0) x += 1440;
  return x;
}

/**
 * Parmi des minutes-jour 0..1439, retourne celle dont l’occurrence **strictement future**
 * est la plus proche (wrap lendemain si tout est passé aujourd’hui).
 */
function disambiguateClosestFutureMinuteOfDay(
  candidates: number[],
  now: Date,
): number {
  const uniq = [
    ...new Set(
      candidates.map((c) => clampMinuteOfDay(c)).filter((c) => c >= 0 && c < 1440),
    ),
  ];
  if (uniq.length === 0) return 0;
  const nowMin =
    now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  let best = uniq[0]!;
  let bestDelta = Infinity;
  for (const c of uniq) {
    let delta = c - nowMin;
    if (delta <= 0) delta += 1440;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }
  return best;
}

function minutesFrom12h(h: number, minute: number, isPm: boolean): number {
  let hh = h;
  if (hh === 12) {
    return isPm ? 12 * 60 + minute : minute;
  }
  if (isPm) return (hh + 12) * 60 + minute;
  return hh * 60 + minute;
}

/**
 * Calcule la date d’ancrage (AAAA-MM-JJ) pour une minute de journée donnée par rapport à `now`.
 *
 * **Pourquoi** : une alarme à 09:00 saisie le soir doit viser **demain**, pas un horaire déjà passé
 * le jour même — sans quoi le matériel annule ou se tait.
 *
 * @param now Horloge de référence (fuseau local de l’appareil).
 * @param minuteOfDay Minutes 0–1439 depuis minuit.
 * @returns Chaîne `YYYY-MM-DD` locale pour `anchor_date_ymd`.
 */
export function resolveAnchorDateYmdForClockMinute(
  now: Date,
  minuteOfDay: number,
): string {
  const m = clampMinuteOfDay(minuteOfDay);
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  d.setMinutes(m);
  if (d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return formatLocalDateYmd(d);
}

/**
 * Extrait une minute depuis minuit (0–1439) depuis le texte — motifs **structurels**
 * (chiffres + séparateurs / suffixes), sans tables linguistiques par pays.
 *
 * **Pourquoi** : l’heure tapée par l’utilisateur est l’engagement de confiance ; le moteur doit
 * être **agnostique** (structure + `Intl`) pour tenir un déploiement mondial sans maintenance
 * de listes par langue.
 *
 * **Loi du système** : le résultat **sanctifie** l’intention côté produit (ancrage non négociable).
 * Ne pas réinjecter ce résultat dans un second passage qui le remplace par un créneau « optimisé » du rail.
 *
 * @param raw Texte brut (titre + description concaténés en pratique).
 * @param options Locales + `now` pour désambiguïsation (prochaine occurrence future).
 * @returns Minutes depuis minuit, ou `null` si aucune horloge fiable n’a été détectée.
 */
export function extractClockMinutesFromText(
  raw: string,
  options?: UniversalTimeExtractOptions,
): number | null {
  const now = options?.now ?? new Date();
  const systemLocale = resolveEffectiveLocaleTag(
    options?.systemLocale,
    options?.aiLanguage,
  );

  const text = raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  type Hit = { min: number; label: string; ambiguous?: boolean; cands?: number[] };
  const hits: Hit[] = [];

  const tryPush = (h: Hit) => {
    hits.push(h);
  };

  // 1) Suffixes A/P + M (structure universelle, insensible à la casse)
  let m: RegExpExecArray | null;
  const reAmPmFull =
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*([ap])\s*\.?\s*m\.?\b/gi;
  while ((m = reAmPmFull.exec(text)) !== null) {
    const hh = parseInt(m[1]!, 10);
    const mm = parseInt(m[2]!, 10);
    const ap = m[3]!.toLowerCase();
    const isPm = ap === 'p';
    tryPush({
      min: minutesFrom12h(hh, mm, isPm),
      label: m[0]!,
    });
  }
  const reAmPmHour =
    /\b([01]?\d|2[0-3])\s*([ap])\s*\.?\s*m\.?\b/gi;
  while ((m = reAmPmHour.exec(text)) !== null) {
    const hh = parseInt(m[1]!, 10);
    const ap = m[2]!.toLowerCase();
    const isPm = ap === 'p';
    tryPush({
      min: minutesFrom12h(hh, 0, isPm),
      label: m[0]!,
    });
  }

  const followedByAmPm = (idx: number, len: number) =>
    /\s*([ap])\s*\.?\s*m\b/i.test(text.slice(idx + len, idx + len + 12));

  // 2) Séparateurs « horloge » larges : : . h @ _ - et espaces (motif structurel)
  const reStructHm =
    /\b([01]?\d|2[0-3])[\s.:_\-h@]+([0-5]\d)\b/gi;
  while ((m = reStructHm.exec(text)) !== null) {
    if (followedByAmPm(m.index, m[0]!.length)) continue;
    const hh = parseInt(m[1]!, 10);
    const mm = parseInt(m[2]!, 10);
    if (hh <= 23 && mm <= 59)
      tryPush({ min: hh * 60 + mm, label: m[0]! });
  }

  // 3) Point décimal HH.MM (24h)
  const reDot = /\b([01]?\d|2[0-3])\.([0-5]\d)\b/g;
  while ((m = reDot.exec(text)) !== null) {
    if (followedByAmPm(m.index, m[0]!.length)) continue;
    const hh = parseInt(m[1]!, 10);
    const mm = parseInt(m[2]!, 10);
    if (hh <= 23) tryPush({ min: hh * 60 + mm, label: m[0]! });
  }

  // 4) *uhr* (lettres contiguës, suffixe fréquent sur plusieurs régions)
  const reUhr =
    /\b([01]?\d|2[0-3])(?:[\s.:]([0-5]\d))?\s*uhr\b/gi;
  while ((m = reUhr.exec(text)) !== null) {
    const hh = parseInt(m[1]!, 10);
    const mm = m[2] != null ? parseInt(m[2]!, 10) : 0;
    if (hh <= 23 && mm <= 59)
      tryPush({ min: hh * 60 + mm, label: m[0]! });
  }

  // 5) Heure seule avec « h » sans minutes (ex. 9h fin de token)
  const reHOnly = /\b([01]?\d|2[0-3])\s*h\b/gi;
  while ((m = reHOnly.exec(text)) !== null) {
    const hh = parseInt(m[1]!, 10);
    if (hh <= 23) {
      const base = hh * 60;
      const cands: number[] =
        hh >= 0 && hh <= 12 && resolvedHourCycleIs12(systemLocale)
          ? hh === 12
            ? [0, 12 * 60]
            : [hh * 60, (hh + 12) * 60]
          : [base];
      tryPush({
        min: disambiguateClosestFutureMinuteOfDay(cands, now),
        label: m[0]!,
        ambiguous: cands.length > 1,
        cands,
      });
    }
  }

  // 6) Chiffre isolé (1–12) après séparateur non-chiffre (hors `-` pour éviter les fragments AAAA-MM-JJ)
  const reBare =
    /(?:^|[^\d\w-])([01]?\d|1[0-2])(?=\s*[,:;)!?.]*(?:\s|$))/gi;
  while ((m = reBare.exec(text)) !== null) {
    const hh = parseInt(m[1]!, 10);
    if (hh >= 1 && hh <= 12) {
      const cands =
        resolvedHourCycleIs12(systemLocale) && hh <= 12
          ? hh === 12
            ? [0, 12 * 60]
            : [hh * 60, (hh + 12) * 60]
          : [hh * 60];
      tryPush({
        min: disambiguateClosestFutureMinuteOfDay(cands, now),
        label: m[0]!.trim(),
        ambiguous: cands.length > 1,
        cands,
      });
    }
  }

  if (hits.length === 0) return null;

  // Priorité : correspondances les plus informatives (AM/PM ou deux chiffres avec séparateur) d’abord
  const scored = hits.map((h, i) => {
    const hasSep = /[:.]/i.test(h.label) || /\d{2}/.test(h.label);
    const hasAmPm = /[ap]\s*\.?\s*m/i.test(h.label);
    const score = (hasAmPm ? 4 : 0) + (hasSep ? 2 : 0) - (h.ambiguous ? 1 : 0);
    return { h, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const pick = scored[0]!.h;
  let result = pick.min;
  if (pick.cands && pick.cands.length > 1) {
    result = disambiguateClosestFutureMinuteOfDay(pick.cands, now);
  }

  result = clampMinuteOfDay(result);

  if (__DEV__) {
    console.log(
      '[UNIVERSAL-TIME] Locale: ' +
        systemLocale +
        " | Raw: '" +
        pick.label +
        "' -> FixedMinutes: " +
        result,
    );
  }

  return result;
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
  timeExtract?: UniversalTimeExtractOptions,
): boolean {
  const rec = inferRecurrenceStrength(title, description);
  const clock = extractClockMinutesFromText(`${title}\n${description}`, {
    ...timeExtract,
    now,
  });
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
  timeExtract?: UniversalTimeExtractOptions,
): StructuralRoutinePlan | null {
  if (!inferIsHardConstraint(title, description, spectrum, now, timeExtract))
    return null;
  const start = extractClockMinutesFromText(`${title}\n${description}`, {
    ...timeExtract,
    now,
  });
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
 * Agrège toutes les inférences nécessaires à la **première persistance** d’une intention (Radar, agents).
 *
 * **Pourquoi** : un seul point d’entrée évite les incohérences (priorité haute mais nuit mal détectée).
 * La détection d’heure dans le texte force une **contrainte dure** car l’utilisateur a exprimé une
 * obligation temporelle explicite.
 *
 * @param title Titre brut utilisateur.
 * @param description Détail optionnel.
 * @param spectrum Poids spectre courants.
 * @param now Horloge pour importance sémantique et nuit.
 * @param options Urgence utilisateur + locales pour {@link extractClockMinutesFromText}.
 * @returns Paquet sémantique prêt pour SQLite / Firestore.
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
  const timeOpts: UniversalTimeExtractOptions = {
    systemLocale: options?.systemLocale,
    aiLanguage: options?.aiLanguage,
    now,
  };
  const explicitClockMinutes = extractClockMinutesFromText(
    `${title}\n${description}`,
    timeOpts,
  );
  const isHardConstraint =
    explicitClockMinutes != null ||
    inferIsHardConstraint(title, description, spectrum, now, timeOpts);
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
  timeExtract?: UniversalTimeExtractOptions,
): { overlaps: boolean; blockingTitle?: string } {
  const sem = analyzeNewIntentionSemantics(
    candidateTitle,
    candidateDesc,
    spectrum,
    now,
    {
      systemLocale: timeExtract?.systemLocale,
      aiLanguage: timeExtract?.aiLanguage,
    },
  );
  const clockPin = extractClockMinutesFromText(
    `${candidateTitle}\n${candidateDesc}`,
    { ...timeExtract, now },
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
    is_flexible: clockPin != null ? false : true,
    is_micro_habit: false,
    is_hard_constraint: clockPin != null ? true : false,
    routine_id: null,
    anchor_date_ymd: null,
    fixed_start_minutes: clockPin,
    raw_transcript: null,
    energy_score: null,
    local_notification_id: null,
    recurrence_rrule: null,
    type: 'task',
    parent_id: null,
    semantic_cluster_id: null,
    semantic_tags: [],
    sentiment_score: null,
    ping_history: [],
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
 * Construit les créneaux affichables du « rail » pour une journée : ordre, durées, collisions busy.
 *
 * **Pourquoi** : offrir une **vue cohérente** (Timeline / Radar) sans serveur ; le spectre module
 * la densité (Momentum / Zen) pour que le rail reflète le profil utilisateur.
 *
 * **Important** : les intentions **non flexibles** avec `fixed_start_minutes` utilisent l’heure
 * comme **ancre immuable** (pas de glissement « intelligent »). Ne pas fusionner ce pool avec le
 * placement fluide sans respecter `is_flexible` / `is_hard_constraint`.
 *
 * @param intentions Lignes SQLite (ou mocks) du jour concerné.
 * @param spectrum Poids Structure / Momentum / Zen / Stats.
 * @param now Horloge de référence (évite les blocs entièrement dans le passé).
 * @param options.busyIntervals Indisponibilités locales (calendriers connectés, etc.).
 * @returns Créneaux triés avec libellés horaires pour l’UI.
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
 * Produit le couple (`anchor_date_ymd`, `fixed_start_minutes`) stocké en SQLite pour une nouvelle intention.
 *
 * **Pourquoi** : séparer **l’heure promise à l’utilisateur** du **placement fluide** du rail évite
 * la dérive (ex. 09h45 → 09h37) qui cassait les alarmes.
 *
 * **Loi du système — ordre contractuel (ne pas inverser)** :
 * 1. `candidate.fixed_start_minutes` si déjà défini (ex. prérempli après parsing titre) ;
 * 2. sinon {@link extractClockMinutesFromText} — **priorité absolue** sur le rail ;
 * 3. sinon seulement : premier créneau issu de {@link buildTimelineSlots} (fluide / busy / spectre).
 *
 * Toute modification de cet ordre doit être validée avec scénarios alarme + Timeline.
 *
 * @param args.pendingOthers Intentions déjà en base pour simulation du rail (mode fluide).
 * @param args.candidate Prototype d’intention (id, durée, flags…) utilisé pour le placement.
 * @param args.spectrum Poids spectre pour le placement fluide (étape 3 uniquement).
 * @param args.now Instant présent pour ancrage et rail.
 * @param args.busyIntervals Indisponibilités calendrier (optionnel).
 * @param args.systemLocale Tag passé au parseur d’heure (étape 2).
 * @param args.aiLanguage Seconde piste locale pour le parseur (étape 2).
 * @returns Ancre calendaire + minutes depuis minuit à persister.
 */
export function computeRailAnchorAndFixedStartForNewIntention(args: {
  pendingOthers: IntentionRow[];
  candidate: IntentionRow;
  spectrum: SpectrumWeights;
  now: Date;
  busyIntervals?: BusyInterval[];
  systemLocale?: string;
  aiLanguage?: string;
}): { anchor_date_ymd: string; fixed_start_minutes: number } {
  const timeCtx: UniversalTimeExtractOptions = {
    systemLocale: args.systemLocale,
    aiLanguage: args.aiLanguage,
    now: args.now,
  };
  if (args.candidate.fixed_start_minutes != null) {
    const m = args.candidate.fixed_start_minutes;
    return {
      anchor_date_ymd: resolveAnchorDateYmdForClockMinute(args.now, m),
      fixed_start_minutes: m,
    };
  }
  const fromTitle = extractClockMinutesFromText(
    `${args.candidate.title}\n${args.candidate.description ?? ''}`,
    timeCtx,
  );
  if (fromTitle != null) {
    return {
      anchor_date_ymd: resolveAnchorDateYmdForClockMinute(args.now, fromTitle),
      fixed_start_minutes: fromTitle,
    };
  }

  const anchor_date_ymd = formatLocalDateYmd(args.now);

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
      anchor_date_ymd,
      fixed_start_minutes: fallbackMin,
    };
  }
  return {
    anchor_date_ymd,
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
const ENCOURAGEMENT_CORE: Record<
  'fr' | 'en' | 'es' | 'de' | 'it' | 'ja' | 'zh',
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

/** Couvre toutes les {@link AppLanguage} ; les locales sans pack dédié réutilisent l’anglais. */
const ENCOURAGEMENT: Record<AppLanguage, Record<SpectrumAxis, string>> = {
  ...ENCOURAGEMENT_CORE,
  ar: ENCOURAGEMENT_CORE.en,
  ko: ENCOURAGEMENT_CORE.en,
  nl: ENCOURAGEMENT_CORE.en,
  sv: ENCOURAGEMENT_CORE.en,
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
