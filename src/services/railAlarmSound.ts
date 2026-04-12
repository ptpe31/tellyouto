/**
 * Préférences de **sonnerie rail** : identifiants stables, noms de fichiers bundlés (expo-notifications),
 * et identifiants de canal Android (un canal par variante pour forcer le bon fichier .wav).
 *
 * @module railAlarmSound
 */

/** Clé SQLite `app_prefs` / miroir profil pour l’alarme rail. */
export const APP_PREF_RAIL_ALARM_SOUND_KEY = 'preferred_alarm_sound';

export const RAIL_ALARM_SOUND_IDS = ['default', 'zen', 'digital'] as const;

/** Variante de sonnerie choisie par l’utilisateur (Debug / futur écran réglages). */
export type RailAlarmSoundId = (typeof RAIL_ALARM_SOUND_IDS)[number];

/**
 * Normalise une valeur persistée vers un identifiant connu.
 *
 * @param raw Valeur AsyncStorage / SQLite / saisie.
 * @returns Toujours l’un des trois identifiants ; inconnu → `default`.
 */
export function normalizeRailAlarmSoundId(
  raw: string | null | undefined,
): RailAlarmSoundId {
  const r = (raw ?? '').trim().toLowerCase();
  if (r === 'zen' || r === 'digital' || r === 'default') return r;
  return 'default';
}

/**
 * Nom de fichier **sans chemin**, présent dans `app.json` → plugin expo-notifications `sounds`.
 * `null` = laisser le **son système** par défaut (aucun asset bundlé utilisable).
 */
export function bundledSoundFilenameForPreference(
  id: RailAlarmSoundId,
): string | null {
  switch (id) {
    case 'default':
      return 'rail_alarm.wav';
    case 'zen':
      return 'rail_alarm_zen.wav';
    case 'digital':
      return 'rail_alarm_digital.wav';
    default:
      return 'rail_alarm.wav';
  }
}

/**
 * Identifiant de canal Android unique par variante — obligatoire pour changer le `.wav` réellement
 * entendu après la première création (Android met en cache le son par canal).
 */
export function androidNotificationChannelIdForSound(
  soundId: RailAlarmSoundId,
): string {
  return `tellyouto_rail_alarm_${soundId}_v2`;
}
