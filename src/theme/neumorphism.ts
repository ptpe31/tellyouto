import { Platform, type ViewStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';

/**
 * Ombres douces type neumorphisme (compatible stores : pas d’API propriétaire).
 */
export function neumorphicInset(theme: MD3Theme): ViewStyle {
  const bg = theme.colors.surface;
  return {
    backgroundColor: bg,
    borderRadius: 16,
    ...Platform.select({
      ios: {
        shadowColor: theme.dark ? '#000' : '#8A9E9E',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: theme.dark ? 0.35 : 0.18,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
      default: {},
    }),
  };
}

export function neumorphicRaised(theme: MD3Theme): ViewStyle {
  const base = neumorphicInset(theme);
  return {
    ...base,
    ...Platform.select({
      ios: {
        ...base,
        shadowOffset: { width: 6, height: 6 },
        shadowOpacity: theme.dark ? 0.45 : 0.22,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
      default: {},
    }),
  };
}
