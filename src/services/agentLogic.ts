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

/**
 * Priorité 1–100 : Dispatcher aligné sur le spectre actuel (plus haut = plus prioritaire).
 */
export function computeIntentionPriority(
  title: string,
  description: string,
  spectrum: SpectrumWeights,
): number {
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
  return Math.max(1, Math.min(100, Math.round(alignment * 100 + 12)));
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatMinutesAsClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.floor(totalMinutes % 60);
  return `${pad2(h)}:${pad2(m)}`;
}

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 20 * 60;

/**
 * Ordre suggéré par l’agent : alignement intention ↔ spectre actuel, puis priorité.
 */
export function orderIntentionsBySpectrum(
  intentions: IntentionRow[],
  spectrum: SpectrumWeights,
): IntentionRow[] {
  const alignment = (row: IntentionRow) =>
    row.weights.structure * spectrum.structure +
    row.weights.momentum * spectrum.momentum +
    row.weights.zen * spectrum.zen +
    row.weights.stats * spectrum.stats;

  return [...intentions].sort((a, b) => {
    const da = alignment(a);
    const db = alignment(b);
    const scoreA = da * 100 + a.priority * 0.45;
    const scoreB = db * 100 + b.priority * 0.45;
    if (Math.abs(scoreB - scoreA) > 0.01) return scoreB - scoreA;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.created_at - a.created_at;
  });
}

/**
 * Répartit les intentions sur la journée selon le spectre (Momentum élevé → blocs plus longs, Zen → pauses plus larges).
 */
export function buildTimelineSlots(
  intentions: IntentionRow[],
  spectrum: SpectrumWeights,
): TimelineSlot[] {
  const sorted = orderIntentionsBySpectrum(intentions, spectrum);

  const gapBase = 6 + spectrum.zen * 18;
  const momentumStretch = spectrum.momentum > 0.52 ? 1.12 : 1;
  let cursor = DAY_START_MIN + Math.round(spectrum.structure * 15);
  const slots: TimelineSlot[] = [];

  for (const intention of sorted) {
    let dur = intention.estimated_duration;
    dur = Math.round(dur * momentumStretch);
    dur = Math.max(10, Math.min(DAY_END_MIN - cursor - 5, dur));

    const startMinutes = cursor;
    const endMinutes = cursor + dur;

    if (startMinutes >= DAY_END_MIN - 5) break;

    slots.push({
      intention,
      startMinutes,
      endMinutes,
      startLabel: formatMinutesAsClock(startMinutes),
      endLabel: formatMinutesAsClock(Math.min(endMinutes, DAY_END_MIN)),
    });

    const gap = gapBase + (spectrum.momentum > 0.55 ? 4 : 10);
    cursor = Math.min(endMinutes + gap, DAY_END_MIN);
  }

  return slots;
}

type Axis = 'structure' | 'momentum' | 'zen' | 'stats';

function dominantAxis(w: SpectrumWeights): Axis {
  const entries: [Axis, number][] = [
    ['structure', w.structure],
    ['momentum', w.momentum],
    ['zen', w.zen],
    ['stats', w.stats],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/** Félicitations + tonalité : Zen = plus posé / long ; Momentum = plus court et dynamique */
const ENCOURAGEMENT: Record<
  AppLanguage,
  Record<Axis, string>
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
  const axis = dominantAxis(spectrum);
  const pack = ENCOURAGEMENT[language] ?? ENCOURAGEMENT.en;
  return pack[axis] ?? pack.momentum;
}
