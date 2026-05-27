import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import {
  PaperProvider,
  type MD3Theme,
} from 'react-native-paper';
import {
  createTellYouToDarkTheme,
  createTellYouToLightTheme,
} from '../theme/paperTheme';
import {
  DEFAULT_TIMELINE_LAYOUT_MODE,
  persistTimelineLayoutMode,
  readPersistedTimelineLayoutMode,
  type TimelineLayoutMode,
} from '../features/livingHub/timelineLayoutRegistry';
import {
  applyDesignVariantToPaperTheme,
  DEFAULT_DESIGN_VARIANT,
  persistDesignVariant,
  readPersistedDesignVariant,
  type DesignVariant,
} from '../theme/TalkThemeRegistry';
import { AppToastHost } from '../components/AppToastHost';

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  paperTheme: MD3Theme;
  designVariant: DesignVariant;
  designVariantHydrated: boolean;
  timelineLayoutMode: TimelineLayoutMode;
  timelineLayoutHydrated: boolean;
  setMode: (m: ThemeMode) => void;
  toggleLightDark: () => void;
  setDesignVariant: (variant: DesignVariant) => Promise<void>;
  setTimelineLayoutMode: (mode: TimelineLayoutMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');
  const [designVariant, setDesignVariantState] = useState<DesignVariant>(DEFAULT_DESIGN_VARIANT);
  const [designVariantHydrated, setDesignVariantHydrated] = useState(false);
  const [timelineLayoutMode, setTimelineLayoutModeState] = useState<TimelineLayoutMode>(
    DEFAULT_TIMELINE_LAYOUT_MODE,
  );
  const [timelineLayoutHydrated, setTimelineLayoutHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readPersistedDesignVariant(), readPersistedTimelineLayoutMode()]).then(
      ([variant, layoutMode]) => {
        if (cancelled) return;
        setDesignVariantState(variant);
        setDesignVariantHydrated(true);
        setTimelineLayoutModeState(layoutMode);
        setTimelineLayoutHydrated(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const paperTheme = useMemo(() => {
    const base =
      resolvedTheme === 'dark'
        ? createTellYouToDarkTheme()
        : createTellYouToLightTheme();
    return applyDesignVariantToPaperTheme(base, designVariant);
  }, [designVariant, resolvedTheme]);

  const setDesignVariant = useCallback(async (variant: DesignVariant) => {
    await persistDesignVariant(variant);
    setDesignVariantState(variant);
  }, []);

  const setTimelineLayoutMode = useCallback(async (mode: TimelineLayoutMode) => {
    await persistTimelineLayoutMode(mode);
    setTimelineLayoutModeState(mode);
  }, []);

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
      designVariant,
      designVariantHydrated,
      timelineLayoutMode,
      timelineLayoutHydrated,
      setMode,
      toggleLightDark,
      setDesignVariant,
      setTimelineLayoutMode,
    }),
    [
      designVariant,
      designVariantHydrated,
      mode,
      paperTheme,
      resolvedTheme,
      setDesignVariant,
      setTimelineLayoutMode,
      timelineLayoutHydrated,
      timelineLayoutMode,
      toggleLightDark,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>
        {children}
        <AppToastHost />
      </PaperProvider>
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
