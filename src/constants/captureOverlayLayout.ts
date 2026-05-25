import { Platform } from 'react-native';

/** Hauteur utile de la tab bar React Navigation (hors home indicator). */
export const TAB_BAR_CORE_HEIGHT = Platform.select({ ios: 49, android: 56, default: 49 }) ?? 49;

/** Espace entre le dock capture global et le haut de la tab bar. */
export const CAPTURE_OVERLAY_TAB_GAP = 80;

/** Zone minimale du micro Talk au repos (bouton 72 + marges). */
export const TALK_DEBUG_MIC_DOCK_MIN_HEIGHT = 88;

/**
 * `bottom` pour {@link GlobalCaptureOverlay} : flotte au-dessus de la tab bar.
 * L’overlay est monté hors `NavigationContainer` → le décalage tab bar est explicite.
 */
export function resolveGlobalCaptureOverlayBottom(safeAreaBottom: number): number {
  if (Platform.OS === 'web') {
    return Math.max(safeAreaBottom, 12);
  }
  return TAB_BAR_CORE_HEIGHT + Math.max(safeAreaBottom, 0) + CAPTURE_OVERLAY_TAB_GAP;
}

/** Offset bas du bandeau suggestions Talk (écran in-flow, au-dessus du dock micro). */
export function resolveTalkDebugSuggestionsBottomOffset(): number {
  return TALK_DEBUG_MIC_DOCK_MIN_HEIGHT + 24;
}
