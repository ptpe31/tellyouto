import { STRINGS } from '../constants/Strings';

/**
 * Config de correspondance sémantique → tags de domaines de vie.
 * Toute la logique multilingue est déclarative ici (zéro hardcoding moteur).
 */
export const TAG_MAP = {
  fr: [
    { concepts: ['pain', 'courses', 'maison', 'cuisine', 'menage'], tag: STRINGS.TAG_KEYS.MAISON },
    { concepts: ['reunion', 'client', 'rapport', 'deadline', 'travail'], tag: STRINGS.TAG_KEYS.TRAVAIL },
    { concepts: ['sport', 'courir', 'medecin', 'sommeil', 'sante'], tag: STRINGS.TAG_KEYS.SANTE },
    { concepts: ['mediter', 'respirer', 'journal', 'zen', 'calme'], tag: STRINGS.TAG_KEYS.ZEN },
    { concepts: ['projet', 'plan', 'roadmap', 'objectif'], tag: STRINGS.TAG_KEYS.PROJETS },
  ],
  en: [
    { concepts: ['home', 'grocery', 'kitchen', 'cleaning'], tag: STRINGS.TAG_KEYS.MAISON },
    { concepts: ['meeting', 'client', 'report', 'deadline', 'work'], tag: STRINGS.TAG_KEYS.TRAVAIL },
    { concepts: ['workout', 'run', 'doctor', 'sleep', 'health'], tag: STRINGS.TAG_KEYS.SANTE },
    { concepts: ['meditate', 'breathe', 'journal', 'calm', 'zen'], tag: STRINGS.TAG_KEYS.ZEN },
    { concepts: ['project', 'roadmap', 'goal', 'plan'], tag: STRINGS.TAG_KEYS.PROJETS },
  ],
};

export function suggestSemanticTags(text, locale = 'fr') {
  const lang = (locale || 'fr').toLowerCase().slice(0, 2);
  const conf = TAG_MAP[lang] ?? TAG_MAP.fr;
  const lower = (text || '').toLowerCase();
  const tags = conf
    .filter((row) => row.concepts.some((c) => lower.includes(c)))
    .map((row) => row.tag);
  if (tags.length === 0) return [STRINGS.TAG_KEYS.A_TRIER];
  return Array.from(new Set(tags));
}

