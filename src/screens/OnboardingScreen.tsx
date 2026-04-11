import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from 'react-native-paper';
import {
  applyDelta,
  initialOnboardingWeights,
  normalizeSpectrumWeights,
  ONBOARDING_SITUATIONS,
} from '../data/onboardingSituations';
import { NeumorphicCard, NeumorphicSurface } from '../components';
import { useUserSpectrum } from '../context/UserSpectrumContext';

type Props = {
  onComplete: () => void;
};

export function OnboardingScreen({ onComplete }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { applyWeightsAndPersist } = useUserSpectrum();

  const [step, setStep] = useState(0);
  const [weights, setWeights] = useState(initialOnboardingWeights);

  const situation = ONBOARDING_SITUATIONS[step];
  const total = ONBOARDING_SITUATIONS.length;

  const titleKey = `onboarding.situations.${situation.id}.title`;
  const answerKeys = [0, 1, 2, 3].map(
    (i) => `onboarding.situations.${situation.id}.a${i}`,
  );

  const onPick = (answerIndex: 0 | 1 | 2 | 3) => {
    const delta = situation.deltas[answerIndex];
    const next = normalizeSpectrumWeights(applyDelta(weights, delta));
    setWeights(next);

    if (step < total - 1) {
      setStep((s) => s + 1);
    } else {
      void applyWeightsAndPersist(next).then(() => onComplete());
    }
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.kicker, { color: theme.colors.primary }]}>
        {t('onboarding.progress', { current: step + 1, total })}
      </Text>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        {t('onboarding.title')}
      </Text>
      <Text style={[styles.sub, { color: theme.colors.onSurfaceVariant }]}>
        {t('onboarding.subtitle')}
      </Text>

      <NeumorphicCard style={styles.card}>
        <Text style={[styles.situationTitle, { color: theme.colors.onSurface }]}>
          {t(titleKey)}
        </Text>

        <View style={styles.answers}>
          {answerKeys.map((key, i) => (
            <Pressable
              key={key}
              onPress={() => onPick(i as 0 | 1 | 2 | 3)}
              style={({ pressed }) => [{ opacity: pressed ? 0.94 : 1 }]}
            >
              <NeumorphicSurface style={styles.answerSurface}>
                <Text
                  style={[styles.answerText, { color: theme.colors.onSurface }]}
                >
                  {t(key)}
                </Text>
              </NeumorphicSurface>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('onboarding.cardsHint')}
        </Text>

        <Button
          mode="text"
          compact
          onPress={() => {
            void applyWeightsAndPersist(weights).then(() => onComplete());
          }}
        >
          {t('onboarding.skip')}
        </Button>
      </NeumorphicCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 20, paddingBottom: 48 },
  kicker: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { marginTop: 8, fontSize: 15, lineHeight: 22 },
  card: { marginTop: 16 },
  situationTitle: { fontSize: 18, fontWeight: '600', lineHeight: 26, marginBottom: 16 },
  answers: { gap: 12 },
  answerSurface: { paddingVertical: 14, paddingHorizontal: 14 },
  answerText: { fontSize: 15, lineHeight: 22 },
  hint: { marginTop: 16, fontSize: 13, lineHeight: 18 },
});
