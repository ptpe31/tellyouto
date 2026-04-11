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
 * Répartit les intentions sur la journée selon le spectre (Momentum élevé → blocs plus longs, Zen → pauses plus larges).
 */
export function buildTimelineSlots(
  intentions: IntentionRow[],
  spectrum: SpectrumWeights,
): TimelineSlot[] {
  const sorted = [...intentions].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.created_at - a.created_at;
  });

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

const ENCOURAGEMENT: Record<
  AppLanguage,
  Record<Axis, string>
> = {
  fr: {
    structure:
      'Ta clarté sur la suite — c’est ton levier de performance.',
    momentum:
      'Un mouvement net. Le rythme porte, une intention à la fois.',
    zen:
      'Espace et présence : tu navigues avec plus de finesse qu’hier.',
    stats:
      'Les repères que tu choisis renforcent ton cap. Continue.',
  },
  en: {
    structure:
      'Clarity on what’s next is your performance edge.',
    momentum:
      'Clean motion. Let the pace carry you—one intention at a time.',
    zen:
      'Space and presence—you’re navigating with a lighter grip.',
    stats:
      'The signals you track sharpen your course. Keep going.',
  },
  es: {
    structure:
      'La claridad sobre lo próximo es tu palanca de rendimiento.',
    momentum:
      'Ritmo claro. Deja que el impulso lleve—una intención cada vez.',
    zen:
      'Espacio y presencia: navegas con más finura.',
    stats:
      'Las señales que eliges afilan tu rumbo. Sigue.',
  },
  de: {
    structure:
      'Klarheit über das Nächste ist dein Hebel für Performance.',
    momentum:
      'Saubere Bewegung. Tempo trägt—eine Absicht nach der anderen.',
    zen:
      'Raum und Präsenz—du navigierst mit mehr Feingefühl.',
    stats:
      'Die Kennzahlen, die du wählst, schärfen deinen Kurs. Weiter so.',
  },
  it: {
    structure:
      'La chiarezza sul prossimo passo è la tua leva di performance.',
    momentum:
      'Movimento netto. Il ritmo porta—un’intenzione alla volta.',
    zen:
      'Spazio e presenza: navighi con più finezza.',
    stats:
      'I segnali che segui affinano la rotta. Continua così.',
  },
  ja: {
    structure:
      '次の一歩への明瞭さが、あなたのパフォーマンスのレバーになる。',
    momentum:
      '潔い動き。ペースに乗せて、意図を一つずつ。',
    zen:
      '余白と在り方。より軽やかなナビゲーションへ。',
    stats:
      '選んだ指標が針路を研ぎ澄ます。その調子で。',
  },
  zh: {
    structure:
      '对下一步的清晰，是你发挥表现的杠杆。',
    momentum:
      '动作干脆。让节奏带着走——一次一个意图。',
    zen:
      '留白与在场，你的导航更轻盈。',
    stats:
      '你关注的信号让路径更清楚，继续。',
  },
};

/**
 * Phrase courte de motivation — personnalisée par le **Spectre** (dimension dominante) et la langue.
 * À appeler avec les poids issus de `useUserSpectrum().spectrum`.
 */
export function generateEncouragement(
  spectrum: SpectrumWeights,
  language: AppLanguage,
): string {
  const axis = dominantAxis(spectrum);
  const pack = ENCOURAGEMENT[language] ?? ENCOURAGEMENT.en;
  return pack[axis] ?? pack.momentum;
}
