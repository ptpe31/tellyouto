import { Platform, type ViewStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { palette } from './colors';

/**
 * Variantes visuelles interchangeables — persistées via AsyncStorage (Debug) ou défaut `CURRENT`.
 * Rollback instantané : sélectionner `CURRENT` dans l'écran Debug (0 % régression).
 */
export type DesignVariant =
  | 'CURRENT'
  | 'ZEN_NEUMORPHIC'
  | 'CYBER_MINIMALIST'
  | 'BENTO_MODERN'
  | 'NORDIC_FOREST'
  | 'SUNSET_PASTEL';

/** Clé AsyncStorage — variante active (showroom Debug). */
export const DESIGN_VARIANT_STORAGE_KEY = '@trankil_debug_theme_variant';

/** Variante par défaut si rien n'est persisté (filet de sécurité). */
export const DEFAULT_DESIGN_VARIANT: DesignVariant = 'CURRENT';

/** @deprecated Préférer `DEFAULT_DESIGN_VARIANT` ou `designVariant` depuis ThemeContext. */
export const ACTIVE_DESIGN_VARIANT: DesignVariant = DEFAULT_DESIGN_VARIANT;

export const ALL_DESIGN_VARIANTS: DesignVariant[] = [
  'CURRENT',
  'ZEN_NEUMORPHIC',
  'CYBER_MINIMALIST',
  'BENTO_MODERN',
  'NORDIC_FOREST',
  'SUNSET_PASTEL',
];

export const DESIGN_VARIANT_LABELS: Record<DesignVariant, string> = {
  CURRENT: 'Actuel (TellYouTo)',
  ZEN_NEUMORPHIC: 'Zen Neumorphique',
  CYBER_MINIMALIST: 'Cyber-Minimaliste',
  BENTO_MODERN: 'Bento / Apple Style',
  NORDIC_FOREST: 'Nordic Forest',
  SUNSET_PASTEL: 'Sunset Pastel',
};

export function isDesignVariant(value: string): value is DesignVariant {
  return (ALL_DESIGN_VARIANTS as string[]).includes(value);
}

/** Lit la variante persistée ; retourne `DEFAULT_DESIGN_VARIANT` si absente ou invalide. */
export async function readPersistedDesignVariant(): Promise<DesignVariant> {
  try {
    const raw = await AsyncStorage.getItem(DESIGN_VARIANT_STORAGE_KEY);
    if (raw && isDesignVariant(raw)) return raw;
  } catch {
    /* ignore — fallback CURRENT */
  }
  return DEFAULT_DESIGN_VARIANT;
}

/** Persiste la variante sélectionnée (showroom Debug). */
export async function persistDesignVariant(variant: DesignVariant): Promise<void> {
  await AsyncStorage.setItem(DESIGN_VARIANT_STORAGE_KEY, variant);
}

/** Tokens identiques pour tous les thèmes — les composants consomment toujours la même API. */
export type DesignTokens = {
  variant: DesignVariant;
  backgroundColor: string;
  cardBackground: string;
  textPrimary: string;
  textSecondary: string;
  accentColor: string;
  borderRadius: number;
  shadowStyle: ViewStyle;
  cardShadowStyle: ViewStyle;
};

type TokenPalette = Omit<DesignTokens, 'variant' | 'shadowStyle' | 'cardShadowStyle'>;

function buildNeumorphicShadow(
  surfaceColor: string,
  borderRadius: number,
  isDark: boolean,
  kind: 'raised' | 'inset',
  intensity: 'soft' | 'standard' | 'flat' | 'card',
): ViewStyle {
  if (intensity === 'flat') {
    return {
      backgroundColor: surfaceColor,
      borderRadius,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    };
  }

  if (intensity === 'card') {
    return {
      backgroundColor: surfaceColor,
      borderRadius,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.35 : 0.08,
          shadowRadius: 12,
        },
        android: { elevation: 4 },
        default: {},
      }),
    };
  }

  const raised = kind === 'raised';
  const soft = intensity === 'soft';
  return {
    backgroundColor: surfaceColor,
    borderRadius,
    ...Platform.select({
      ios: {
        shadowColor: isDark ? '#000' : soft ? '#B8B0A8' : '#8A9E9E',
        shadowOffset: {
          width: raised ? (soft ? 5 : 6) : 4,
          height: raised ? (soft ? 5 : 6) : 4,
        },
        shadowOpacity: isDark
          ? raised
            ? soft
              ? 0.4
              : 0.45
            : 0.35
          : raised
            ? soft
              ? 0.14
              : 0.22
            : 0.18,
        shadowRadius: raised ? (soft ? 14 : 12) : 8,
      },
      android: { elevation: raised ? (soft ? 5 : 6) : 3 },
      default: {},
    }),
  };
}

function withShadows(
  variant: DesignVariant,
  colors: TokenPalette,
  colorScheme: 'light' | 'dark',
): DesignTokens {
  const isDark = colorScheme === 'dark';
  const shadowProfile: Record<
    DesignVariant,
    { raised: 'soft' | 'standard' | 'flat' | 'card'; inset: 'soft' | 'standard' | 'flat' | 'card' }
  > = {
    CURRENT: { raised: 'standard', inset: 'standard' },
    ZEN_NEUMORPHIC: { raised: 'soft', inset: 'soft' },
    CYBER_MINIMALIST: { raised: 'flat', inset: 'flat' },
    BENTO_MODERN: { raised: 'card', inset: 'card' },
    NORDIC_FOREST: { raised: 'soft', inset: 'soft' },
    SUNSET_PASTEL: { raised: 'soft', inset: 'soft' },
  };

  const profile = shadowProfile[variant];
  return {
    variant,
    ...colors,
    shadowStyle: buildNeumorphicShadow(
      colors.cardBackground,
      colors.borderRadius,
      isDark,
      'raised',
      profile.raised,
    ),
    cardShadowStyle: buildNeumorphicShadow(
      colors.cardBackground,
      colors.borderRadius,
      isDark,
      'inset',
      profile.inset,
    ),
  };
}

/** Palette CURRENT — calquée sur `palette` + `paperTheme.ts` (light & dark). */
function currentPalette(colorScheme: 'light' | 'dark'): TokenPalette {
  if (colorScheme === 'dark') {
    return {
      backgroundColor: palette.surfaceDark,
      cardBackground: '#242A2A',
      textPrimary: palette.textOnDark,
      textSecondary: '#A8B4B4',
      accentColor: palette.tealLight,
      borderRadius: 16,
    };
  }
  return {
    backgroundColor: palette.offWhite,
    cardBackground: palette.surfaceLight,
    textPrimary: palette.textOnLight,
    textSecondary: '#5C6B6B',
    accentColor: palette.teal,
    borderRadius: 16,
  };
}

const VARIANT_PALETTES: Record<Exclude<DesignVariant, 'CURRENT'>, TokenPalette> = {
  ZEN_NEUMORPHIC: {
    backgroundColor: '#F2F0EB',
    cardBackground: '#F8F6F2',
    textPrimary: '#3D3D3A',
    textSecondary: '#8A8880',
    accentColor: '#7BA098',
    borderRadius: 20,
  },
  CYBER_MINIMALIST: {
    backgroundColor: '#000000',
    cardBackground: '#0A0A0A',
    textPrimary: '#F0F0F0',
    textSecondary: '#6B6B6B',
    accentColor: '#00FFD5',
    borderRadius: 12,
  },
  BENTO_MODERN: {
    backgroundColor: '#F5F5F7',
    cardBackground: '#FFFFFF',
    textPrimary: '#1D1D1F',
    textSecondary: '#86868B',
    accentColor: '#0071E3',
    borderRadius: 24,
  },
  NORDIC_FOREST: {
    backgroundColor: '#F5F3ED',
    cardBackground: '#E8EDE4',
    textPrimary: '#2C3E2D',
    textSecondary: '#5C6B5E',
    accentColor: '#4A6741',
    borderRadius: 18,
  },
  SUNSET_PASTEL: {
    backgroundColor: '#FAF0F5',
    cardBackground: '#FFF5F0',
    textPrimary: '#4A3F55',
    textSecondary: '#8B7A90',
    accentColor: '#E8849A',
    borderRadius: 20,
  },
};

/**
 * Retourne les tokens du design actif pour le schéma clair/sombre courant.
 * `CURRENT` reproduit exactement la palette TellYouTo existante.
 */
export function getDesignTokens(
  variant: DesignVariant = DEFAULT_DESIGN_VARIANT,
  colorScheme: 'light' | 'dark' = 'light',
): DesignTokens {
  const colors =
    variant === 'CURRENT' ? currentPalette(colorScheme) : VARIANT_PALETTES[variant];
  return withShadows(variant, colors, colorScheme);
}

/** Fusionne les tokens dans un thème Paper MD3 (no-op si `CURRENT`). */
export function applyDesignVariantToPaperTheme(
  base: MD3Theme,
  variant: DesignVariant = DEFAULT_DESIGN_VARIANT,
): MD3Theme {
  if (variant === 'CURRENT') return base;

  const scheme = base.dark ? 'dark' : 'light';
  const tokens = getDesignTokens(variant, scheme);

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: tokens.accentColor,
      background: tokens.backgroundColor,
      surface: tokens.cardBackground,
      surfaceVariant: tokens.cardBackground,
      onBackground: tokens.textPrimary,
      onSurface: tokens.textPrimary,
      onSurfaceVariant: tokens.textSecondary,
    },
  };
}

export function isDesignVariantActive(
  variant: DesignVariant,
  activeVariant: DesignVariant = DEFAULT_DESIGN_VARIANT,
): boolean {
  return activeVariant === variant;
}
