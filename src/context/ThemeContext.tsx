import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import {
  PaperProvider,
  type MD3Theme,
} from 'react-native-paper';
import {
  createTellYouToDarkTheme,
  createTellYouToLightTheme,
} from '../theme/paperTheme';

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  paperTheme: MD3Theme;
  setMode: (m: ThemeMode) => void;
  toggleLightDark: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');

  const resolvedTheme: 'light' | 'dark' =
    mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const paperTheme = useMemo(
    () =>
      resolvedTheme === 'dark'
        ? createTellYouToDarkTheme()
        : createTellYouToLightTheme(),
    [resolvedTheme],
  );

  const toggleLightDark = useCallback(() => {
    setMode((m) => {
      if (m === 'system') return system === 'dark' ? 'light' : 'dark';
      return m === 'dark' ? 'light' : 'dark';
    });
  }, [system]);

  const value = useMemo(
    () => ({
      mode,
      resolvedTheme,
      paperTheme,
      setMode,
      toggleLightDark,
    }),
    [mode, resolvedTheme, paperTheme, toggleLightDark],
  );

  return (
    <ThemeContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>{children}</PaperProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }
  return ctx;
}
