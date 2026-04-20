import { Audio } from 'expo-av';

const hq = Audio.RecordingOptionsPresets.HIGH_QUALITY;

/**
 * Options d’enregistrement **léger** pour mémos vocaux + capture Talk (expo-av).
 * — Mono, ~22 kHz, AAC ~64 kb/s : fichier plus petit que `HIGH_QUALITY`, suffisant
 *   pour relecture humaine ou envoi futur vers un modèle audio.
 * — `isMeteringEnabled` : niveau pour l’animation d’ondes pendant la dictée.
 *
 * **Note flux One-Tap actuel** : la structuration Gemini part du **texte** issu de
 * `expo-speech-recognition`, pas de ce fichier ; l’audio sert surtout au mémo / pipeline audio.
 */
export const VOICE_MEMO_LIGHT_RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  android: {
    ...hq.android,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    ...hq.ios,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
    audioQuality: 64,
  },
  web: {
    ...hq.web,
    bitsPerSecond: 64000,
  },
} as const;
