import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, TextInput, useTheme } from 'react-native-paper';
import {
  applyDelta,
  initialOnboardingWeights,
  normalizeSpectrumWeights,
  ONBOARDING_SITUATIONS,
} from '../data/onboardingSituations';
import { NeumorphicCard, NeumorphicSurface } from '../components';
import { useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  AD_FREE_UNTIL_MS_FIRESTORE_DEFAULT,
  pushDeviceProfileToFirestore,
  pushUserEntitlementsToFirestore,
} from '../api/userProfile';

type Props = {
  onComplete: () => void;
};

const SITUATION_COUNT = ONBOARDING_SITUATIONS.length;
/** 0 = prénom, 1..SITUATION_COUNT = situations */
const FIRST_NAME_STEP = 0;
const DIAGNOSTIC_STEPS = 1 + SITUATION_COUNT;

export function OnboardingScreen({ onComplete }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { language } = useLanguage();
  const {
    applyWeightsAndPersist,
    setFirstName,
    setLocale,
    persist,
    spectrum,
  } = useUserSpectrum();

  const [step, setStep] = useState(FIRST_NAME_STEP);
  const [firstNameInput, setFirstNameInput] = useState('');
  const [weights, setWeights] = useState(initialOnboardingWeights);
  const weightsRef = useRef(weights);
  weightsRef.current = weights;

  const finishOnboarding = useCallback(
    async (finalWeights?: typeof weights) => {
      const w = finalWeights ?? weightsRef.current;
      await applyWeightsAndPersist(w);
      setLocale(language);
      await persist();
      try {
        await pushDeviceProfileToFirestore({
          first_name: (firstNameInput.trim() || spectrum.first_name).trim(),
          intentions_quota: spectrum.intentions_quota,
          locale: language,
          messenger_reminders_enabled: true,
          messenger_reminder_lead_minutes: 5,
        });
        await pushUserEntitlementsToFirestore({
          ad_free_until_ms:
            typeof spectrum.ad_free_until_ms === 'number' &&
            Number.isFinite(spectrum.ad_free_until_ms)
              ? spectrum.ad_free_until_ms
              : AD_FREE_UNTIL_MS_FIRESTORE_DEFAULT,
          is_pro_user: spectrum.isProUser === true,
        });
      } catch (e: unknown) {
        if (__DEV__) {
          const code =
            typeof e === 'object' &&
            e !== null &&
            'code' in e &&
            typeof (e as { code: unknown }).code === 'string'
              ? (e as { code: string }).code
              : '';
          const message = e instanceof Error ? e.message : String(e);
          Alert.alert(
            'Firestore (debug)',
            [code, message].filter(Boolean).join('\n'),
          );
        }
      }
      onComplete();
    },
    [applyWeightsAndPersist, setLocale, persist, language, firstNameInput, spectrum, onComplete],
  );


  const onContinueFirstName = async () => {
    const trimmed = firstNameInput.trim();
    if (!trimmed) return;
    setFirstName(trimmed);
    await persist();
    setStep(1);
  };

  if (step === FIRST_NAME_STEP) {
    return (
      <ScrollView
        style={[styles.flex, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={styles.pad}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.kicker, { color: theme.colors.primary }]}>
          {t('onboarding.progress', { current: 1, total: DIAGNOSTIC_STEPS })}
        </Text>
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>
          {t('onboarding.firstName.title')}
        </Text>
        <Text style={[styles.sub, { color: theme.colors.onSurfaceVariant }]}>
          {t('onboarding.firstName.subtitle')}
        </Text>

        <NeumorphicCard style={styles.card}>
          <TextInput
            mode="outlined"
            label={t('onboarding.firstName.placeholder')}
            value={firstNameInput}
            onChangeText={setFirstNameInput}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (firstNameInput.trim()) void onContinueFirstName();
            }}
            style={{ backgroundColor: theme.colors.surface }}
          />
          <Button
            mode="contained"
            style={styles.channelCta}
            disabled={!firstNameInput.trim()}
            onPress={() => void onContinueFirstName()}
          >
            {t('onboarding.firstName.continue')}
          </Button>
        </NeumorphicCard>
      </ScrollView>
    );
  }


  const situation = ONBOARDING_SITUATIONS[step - 1];
  const titleKey = `onboarding.situations.${situation.id}.title`;
  const answerKeys = [0, 1, 2, 3].map(
    (i) => `onboarding.situations.${situation.id}.a${i}`,
  );

  const onPick = (answerIndex: 0 | 1 | 2 | 3) => {
    const delta = situation.deltas[answerIndex];
    const next = normalizeSpectrumWeights(applyDelta(weights, delta));
    setWeights(next);

    if (step < SITUATION_COUNT) {
      setStep((s) => s + 1);
      return;
    }

    void (async () => {
      await finishOnboarding(next);
    })();
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.kicker, { color: theme.colors.primary }]}>
        {t('onboarding.progress', {
          current: step + 1,
          total: DIAGNOSTIC_STEPS,
        })}
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
          onPress={() => void finishOnboarding()}
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
  channelCta: { marginTop: 8, alignSelf: 'stretch' },
  situationTitle: { fontSize: 18, fontWeight: '600', lineHeight: 26, marginBottom: 16 },
  answers: { gap: 12 },
  answerSurface: { paddingVertical: 14, paddingHorizontal: 14 },
  answerText: { fontSize: 15, lineHeight: 22 },
  hint: { marginTop: 16, fontSize: 13, lineHeight: 18 },
});
