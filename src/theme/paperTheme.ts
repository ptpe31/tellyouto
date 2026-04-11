import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import {
  MD3DarkTheme,
  MD3LightTheme,
  configureFonts,
  type MD3Theme,
} from 'react-native-paper';
import { palette } from './colors';

const fontConfig = configureFonts({ config: { fontFamily: 'System' } });

export function createTellYouToLightTheme(): MD3Theme {
  return {
    ...MD3LightTheme,
    fonts: fontConfig,
    colors: {
      ...MD3LightTheme.colors,
      primary: palette.teal,
      primaryContainer: palette.tealLight,
      secondary: palette.orange,
      secondaryContainer: palette.orangeLight,
      background: palette.offWhite,
      surface: palette.surfaceLight,
      surfaceVariant: palette.offWhiteDark,
      onPrimary: '#FFFFFF',
      onSecondary: '#1C1C1C',
      onBackground: palette.textOnLight,
      onSurface: palette.textOnLight,
      outline: palette.outline,
    },
  };
}

export function createTellYouToDarkTheme(): MD3Theme {
  return {
    ...MD3DarkTheme,
    fonts: fontConfig,
    colors: {
      ...MD3DarkTheme.colors,
      primary: palette.tealLight,
      primaryContainer: palette.tealDark,
      secondary: palette.orangeLight,
      secondaryContainer: palette.orangeDark,
      background: palette.surfaceDark,
      surface: '#242A2A',
      surfaceVariant: '#2E3636',
      onPrimary: '#003333',
      onSecondary: '#1C1C1C',
      onBackground: palette.textOnDark,
      onSurface: palette.textOnDark,
      outline: palette.tealLight,
    },
  };
}

export function navigationThemeFromPaper(paperTheme: MD3Theme): NavigationTheme {
  const base = paperTheme.dark ? NavigationDarkTheme : NavigationDefaultTheme;
  return {
    ...base,
    dark: !!paperTheme.dark,
    colors: {
      ...base.colors,
      primary: paperTheme.colors.primary,
      background: paperTheme.colors.background,
      card: paperTheme.colors.surface,
      text: paperTheme.colors.onSurface,
      border: paperTheme.colors.outline,
      notification: paperTheme.colors.secondary,
    },
  };
}
