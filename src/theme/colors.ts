/**
 * TellYouTo — palette Adaptive-Agent (Teal / Orange / Off-white)
 */
export const palette = {
  teal: '#008080',
  tealDark: '#006666',
  tealLight: '#4DB3B3',
  orange: '#FF8C00',
  orangeDark: '#CC7000',
  orangeLight: '#FFB84D',
  offWhite: '#F5F5F0',
  offWhiteDark: '#E8E8E0',
  surfaceLight: '#FAFAF7',
  surfaceDark: '#1A1F1F',
  textOnLight: '#1C2424',
  textOnDark: '#EEF4F4',
  outline: '#B0C4C4',
} as const;

export type Palette = typeof palette;
