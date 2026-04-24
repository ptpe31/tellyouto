import type { SpectrumWeights } from '../context/UserSpectrumContext';

import { getDominantSpectrumAxis } from './agentLogic';
import { QUICK_COMPLETE_SUGGEST_THRESHOLD } from './focusHabits';

/** Tranches horaires pour les messages dynamiques (locale = heure appareil). */
export type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';

export function getTimeBucket(date: Date = new Date()): TimeBucket {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

/**
 * Logique partagée (fonction interne pour éviter un appel entre exports,
 * source possible de ReferenceError sous Hermes / chargement de module).
 */
function buildRadarAllyThoughtI18nKey(
  spectrum: SpectrumWeights,
  date: Date,
): string {
  const axis = getDominantSpectrumAxis(spectrum);
  const bucket = getTimeBucket(date);
  if (bucket === 'evening' || bucket === 'night') {
    return `allyVoice.farewell.${bucket}.${axis}`;
  }
  return `allyVoice.greet.${bucket}.${axis}`;
}

/**
 * Clé i18n pour une bulle discrète sur le Radar :
 * - matin / après-midi → accueil (`allyVoice.greet.*`)
 * - soir / nuit → fin de journée (`allyVoice.farewell.*`)
 */
export function getRadarAllyThoughtI18nKey(
  spectrum: SpectrumWeights,
  date: Date = new Date(),
): string {
  return buildRadarAllyThoughtI18nKey(spectrum, date);
}

/**
 * Bulle Radar : si l’utilisateur marque souvent « Fait » sans Capsule,
 * message dédié (sinon message horaire + spectre).
 */
export function getRadarAllyThoughtI18nKeyWithHabits(
  spectrum: SpectrumWeights,
  date: Date,
  quickCompleteStreak: number,
): string {
  if (quickCompleteStreak >= QUICK_COMPLETE_SUGGEST_THRESHOLD) {
    return 'allyVoice.suggestFocusCapsule';
  }
  return buildRadarAllyThoughtI18nKey(spectrum, date);
}
