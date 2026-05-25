import { useMemo } from 'react';

import { useAppTheme } from '../context/ThemeContext';
import { getDesignTokens, type DesignTokens } from '../theme/TalkThemeRegistry';

/** Tokens visuels du design actif (réactif au switch Debug / AsyncStorage). */
export function useDesignTokens(): DesignTokens {
  const { resolvedTheme, designVariant } = useAppTheme();
  return useMemo(
    () => getDesignTokens(designVariant, resolvedTheme),
    [designVariant, resolvedTheme],
  );
}
