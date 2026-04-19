import { BlurView } from 'expo-blur';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SUGGESTIONS_FR: string[] = [
  'Je dois préparer un cassoulet pour 4 personnes pour samedi soir',
  'Chercher la colle à bois demain à 10h',
  'Anniversaire de Julie le 15 mai',
  'Chaque lundi, sortir les poubelles',
  'Liste de matériel pour un bivouac de 2 jours à la montagne',
  'Fais-moi la liste des courses pour une semaine de repas healthy',
  'Liste de bagages pour 3 jours à Londres avec un bébé',
  'Tous les lundis à 8h, rappelle-moi de sortir les poubelles jaunes',
  'Je veux faire 10 pompes chaque matin au réveil',
  'Penser à arroser les plantes un vendredi sur deux',
  'Rendez-vous chez le dentiste le 15 juin à 14h30, mets une alerte 1h avant',
  'Anniversaire de maman le 3 septembre, prévoir un cadeau 1 semaine avant',
  'Demain à 10h, appeler le comptable pour le bilan',
  'Il faudra que je regarde la série dont Paul m’a parlé',
];

const SUBTITLE_FONT =
  Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: undefined,
  }) ?? undefined;

export type IntentionSuggestionsBannerProps = {
  /** Affiche le bandeau (ex. écran Talk en veille). */
  visible: boolean;
  /** Décalage depuis le bas (px), au-dessus du dock micro. */
  bottomOffset?: number;
};

/**
 * Bandeau **Suggestions d’Intentions** : phrases d’exemple avec effet machine à écrire
 * (remplace l’ancien bandeau publicitaire).
 */
export function IntentionSuggestionsBanner({ visible, bottomOffset = 0 }: IntentionSuggestionsBannerProps) {
  const { i18n, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const phrases = useMemo(() => (i18n.language.startsWith('fr') ? SUGGESTIONS_FR : SUGGESTIONS_FR), [i18n.language]);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!visible) {
      setTyped('');
      return;
    }
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const clearAll = () => timeouts.forEach(clearTimeout);

    const runPhrase = (idx: number) => {
      const full = phrases[idx % phrases.length] ?? '';
      let c = 0;
      const step = () => {
        if (cancelled) return;
        c += 1;
        setTyped(full.slice(0, c));
        if (c < full.length) {
          timeouts.push(setTimeout(step, 38));
        } else {
          timeouts.push(
            setTimeout(() => {
              if (!cancelled) runPhrase(idx + 1);
            }, 2200),
          );
        }
      };
      step();
    };

    runPhrase(0);
    return () => {
      cancelled = true;
      clearAll();
    };
  }, [visible, phrases]);

  if (!visible) return null;

  const bottomPad = Math.max(insets.bottom, 12);

  return (
    <View
      pointerEvents="none"
      style={[styles.anchor, { paddingBottom: bottomPad, bottom: bottomOffset }]}
      accessibilityRole="text"
    >
      <BlurView intensity={42} tint="dark" style={styles.blur}>
        <Text style={styles.eyebrow}>{t('talkDebug.intentionSuggestionsEyebrow')}</Text>
        <Text
          style={[styles.line, SUBTITLE_FONT ? { fontFamily: SUBTITLE_FONT } : null]}
          numberOfLines={4}
        >
          {typed}
          <Text style={styles.cursor}>▍</Text>
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
    paddingHorizontal: 16,
  },
  blur: {
    maxWidth: 560,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  eyebrow: {
    color: 'rgba(0, 128, 128, 0.95)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    textAlign: 'center',
  },
  line: {
    color: 'rgba(245, 245, 240, 0.95)',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    fontStyle: 'italic',
    letterSpacing: 0.2,
    fontWeight: '500',
  },
  cursor: {
    color: '#FF8C00',
    fontStyle: 'normal',
    fontWeight: '300',
  },
});
