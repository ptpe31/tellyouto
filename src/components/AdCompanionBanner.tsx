import { BlurView } from 'expo-blur';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getKindnessBones, getUserProfile } from '../services/userProfilingService';

export type AdCompanionBannerProps = {
  /** True pendant le chargement ou la lecture de la pub récompensée. */
  active: boolean;
  /** Masqué pour les comptes Pro (pas d’interruption pub). */
  isProUser: boolean;
  /** Interpolation {{name}} dans les briques de bienveillance. */
  displayName?: string;
  /** Décalage depuis le bas de l’écran (px), ex. au-dessus d’un dock micro. */
  bottomOffset?: number;
};

const SUBTITLE_FONT =
  Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: undefined,
  }) ?? undefined;

/**
 * Bandeau discret en bas d’écran pendant une pub : uniquement l’insight (bienveillance),
 * style sous-titre — fond flouté semi-transparent.
 */
export function AdCompanionBanner({ active, isProUser, displayName, bottomOffset = 0 }: AdCompanionBannerProps) {
  const { i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [insight, setInsight] = useState('');

  useEffect(() => {
    if (!active || isProUser) {
      setInsight('');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getUserProfile();
        const bones = getKindnessBones(profile.id, i18n.language, displayName);
        if (!cancelled) setInsight(bones.insight);
      } catch {
        if (!cancelled) setInsight('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, isProUser, displayName, i18n.language]);

  if (!active || isProUser) {
    return null;
  }

  const bottomPad = Math.max(insets.bottom, 14);

  return (
    <View
      pointerEvents="none"
      style={[styles.anchor, { paddingBottom: bottomPad, bottom: bottomOffset }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <BlurView intensity={48} tint="dark" style={styles.blur}>
        <Text
          style={[styles.line, SUBTITLE_FONT ? { fontFamily: SUBTITLE_FONT } : null]}
          numberOfLines={5}
        >
          {insight || ' '}
        </Text>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  blur: {
    maxWidth: 560,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  line: {
    color: 'rgba(245, 245, 240, 0.92)',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    fontStyle: 'italic',
    letterSpacing: 0.35,
    fontWeight: '400',
  },
});
