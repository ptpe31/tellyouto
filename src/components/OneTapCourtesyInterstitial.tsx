import type { TFunction } from 'i18next';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

/** Délai max avant d’ouvrir la modale avec le squelette Path A (lecture de la phrase de courtoisie). */
export const ONE_TAP_MODAL_OPEN_SAFETY_MS = 2200;

/**
 * Phrase de courtoisie (Bonjour/Bonsoir + prénom optionnel) — figée à l’instant T0.
 */
export function formatOneTapCourtesyLine(
  translate: TFunction,
  firstName: string | undefined,
  language: string,
): string {
  const fn = firstName?.trim();
  const h = new Date().getHours();
  const evening = h >= 18 || h < 5;
  const en = language.startsWith('en');
  const greeting = en
    ? evening
      ? 'Good evening'
      : 'Good morning'
    : evening
      ? 'Bonsoir'
      : 'Bonjour';
  if (fn) {
    return translate('talkDebug.oneTapCourtesyNamed', { greeting, name: fn });
  }
  return translate('talkDebug.oneTapCourtesyPlain', { greeting });
}

type OneTapCourtesyInterstitialProps = {
  /** Affichage + animation ; passer à false déclenche le fondu sortant. */
  visible: boolean;
  text: string;
};

/**
 * Overlay plein écran entre fin dictée et modale — fondu d’opacité (entrée / sortie).
 */
export function OneTapCourtesyInterstitial({ visible, text }: OneTapCourtesyInterstitialProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);
  const didShowRef = useRef(false);

  useEffect(() => {
    if (visible) {
      didShowRef.current = true;
      setMounted(true);
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 340,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!didShowRef.current) return;
    Animated.timing(opacity, {
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        didShowRef.current = false;
      }
    });
  }, [visible, opacity]);

  if (!mounted) return null;

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.wrap, StyleSheet.absoluteFill]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
    >
      <Animated.View style={[styles.panel, { opacity }]}>
        <Text style={styles.line}>{text}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    zIndex: 45,
    elevation: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  panel: {
    maxWidth: 360,
    paddingVertical: 28,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248, 250, 252, 0.12)',
  },
  line: {
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 27,
    color: '#f8fafc',
    fontWeight: '500',
  },
});
