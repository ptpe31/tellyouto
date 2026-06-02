import { useMemo } from 'react';

import { useAppTheme } from '../context/ThemeContext';
import { getDesignTokens, type DesignTokens } from '../theme/TalkThemeRegistry';

/** Échelle typographique Zen — identique clair / sombre (tailles en px). */
export const ZEN_TYPOGRAPHY = {
  caption: 11, // Micro-badges, fragments
  label: 12, // Étiquettes, tags secondaires
  bodySmall: 13, // Métadonnées, descriptifs courts
  body: 14, // Texte principal, To-Do items
  bodyLarge: 15, // Textes d'emphase, messages IA
  title: 16, // En-têtes de cartes
  headline: 18, // Titres de modales et sheets
  hero: 24, // Titres majeurs (Pro, Error)
} as const;

export type ZenTypography = typeof ZEN_TYPOGRAPHY;

export type DesignTokensWithTypography = DesignTokens & {
  typography: ZenTypography;
};

/** Tokens visuels du design actif (réactif au switch Debug / AsyncStorage). */
export function useDesignTokens(): DesignTokensWithTypography {
  const { resolvedTheme, designVariant } = useAppTheme();
  return useMemo(
    () => ({
      ...getDesignTokens(designVariant, resolvedTheme),
      typography: ZEN_TYPOGRAPHY,
    }),
    [designVariant, resolvedTheme],
  );
}
