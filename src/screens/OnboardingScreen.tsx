import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import {
  listPrivateChannelIds,
  type PrivateChannelId,
  resolvePrivateChannelBotUrl,
  savePrivateChannelChoice,
} from '../data/privateChannels';
import { NeumorphicCard, NeumorphicSurface } from '../components';
import { useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  getBotInitializationMessage,
  getAppLinkForConnector,
  buildWhatsAppRailDeepLink,
} from '../services/connectorLinks';
import { pushDeviceProfileToFirestore } from '../api/userProfile';
import { getOrCreateDeviceId } from '../api/syncService';

type Props = {
  onComplete: () => void;
};

const SITUATION_COUNT = ONBOARDING_SITUATIONS.length;
/** 0 = prénom, 1..SITUATION_COUNT = situations, puis canal privé */
const FIRST_NAME_STEP = 0;
const PRIVATE_CHANNEL_STEP = 1 + SITUATION_COUNT;
const TOTAL_STEPS = 1 + SITUATION_COUNT + 1;

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
  const [selectedChannel, setSelectedChannel] =
    useState<PrivateChannelId | null>(null);
  const [initCopied, setInitCopied] = useState(false);
  const [waitingConnection, setWaitingConnection] = useState(false);
  const [waLinkPreview, setWaLinkPreview] = useState<string | null>(null);

  useEffect(() => {
    if (selectedChannel !== 'whatsapp') {
      setWaLinkPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const uid = await getOrCreateDeviceId();
      const name = (spectrum.first_name || firstNameInput).trim() || 'toi';
      if (!cancelled) {
        setWaLinkPreview(buildWhatsAppRailDeepLink(name, uid));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedChannel, spectrum.first_name, firstNameInput]);

  const finishOnboarding = async (finalWeights = weights) => {
    await applyWeightsAndPersist(finalWeights);
    setLocale(language);
    await persist();
    await pushDeviceProfileToFirestore({
      first_name: (firstNameInput.trim() || spectrum.first_name).trim(),
      intentions_quota: spectrum.intentions_quota,
      locale: language,
      messenger_reminders_enabled: true,
      messenger_reminder_lead_minutes: 5,
    });
    onComplete();
  };

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
      >
        <Text style={[styles.kicker, { color: theme.colors.primary }]}>
          {t('onboarding.progress', { current: 1, total: TOTAL_STEPS })}
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

  if (step === PRIVATE_CHANNEL_STEP) {
    if (waitingConnection) {
      return (
        <View
          style={[
            styles.flex,
            styles.waitingWrap,
            { backgroundColor: theme.colors.background },
          ]}
        >
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text
            style={[styles.waitingText, { color: theme.colors.onSurface }]}
          >
            {t('onboarding.privateChannel.waitingConnection')}
          </Text>
        </View>
      );
    }

    const appLink = getAppLinkForConnector('radar');
    const initMsg = getBotInitializationMessage(
      language,
      spectrum.first_name || firstNameInput.trim(),
      appLink,
    );

    return (
      <ScrollView
        style={[styles.flex, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={styles.pad}
      >
        <Text style={[styles.kicker, { color: theme.colors.primary }]}>
          {t('onboarding.progress', { current: TOTAL_STEPS, total: TOTAL_STEPS })}
        </Text>
        <Text style={[styles.title, { color: theme.colors.onBackground }]}>
          {t('onboarding.privateChannel.title')}
        </Text>
        <Text style={[styles.sub, { color: theme.colors.onSurfaceVariant }]}>
          {t('onboarding.privateChannel.subtitle')}
        </Text>
        <Text style={[styles.explain, { color: theme.colors.onSurfaceVariant }]}>
          {t('onboarding.privateChannel.explainBot')}
        </Text>

        <NeumorphicCard style={styles.card}>
          <Text
            style={[styles.initLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            {t('onboarding.privateChannel.initMessageLabel')}
          </Text>
          <Text
            style={[styles.initBody, { color: theme.colors.onSurface }]}
            selectable
          >
            {initMsg}
          </Text>
          <Button
            mode="outlined"
            style={styles.channelCta}
            onPress={async () => {
              await Clipboard.setStringAsync(initMsg);
              setInitCopied(true);
              setTimeout(() => setInitCopied(false), 2500);
            }}
          >
            {initCopied
              ? t('onboarding.privateChannel.copied')
              : t('onboarding.privateChannel.copyInit')}
          </Button>

          {listPrivateChannelIds().map((id) => {
            const selected = selectedChannel === id;
            return (
              <Pressable
                key={id}
                onPress={() => setSelectedChannel(id)}
                style={({ pressed }) => [
                  styles.channelRow,
                  {
                    borderColor: selected
                      ? theme.colors.primary
                      : theme.colors.outline,
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.channelLabel, { color: theme.colors.onSurface }]}
                >
                  {t(`onboarding.privateChannel.platforms.${id}`)}
                </Text>
                {selected ? (
                  <Text
                    style={[styles.channelHint, { color: theme.colors.primary }]}
                    numberOfLines={4}
                  >
                    {id === 'whatsapp' && waLinkPreview
                      ? waLinkPreview
                      : resolvePrivateChannelBotUrl(id) ||
                        t('onboarding.privateChannel.urlPending')}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          <Button
            mode="contained"
            style={styles.channelCta}
            disabled={selectedChannel === null}
            onPress={async () => {
              if (!selectedChannel) return;
              await savePrivateChannelChoice(selectedChannel);

              if (selectedChannel === 'whatsapp') {
                const uid = await getOrCreateDeviceId();
                const name = (spectrum.first_name || firstNameInput).trim() || 'toi';
                const url = buildWhatsAppRailDeepLink(name, uid);
                try {
                  await Linking.openURL(url);
                  setWaitingConnection(true);
                  setTimeout(() => {
                    setWaitingConnection(false);
                    void finishOnboarding();
                  }, 3200);
                } catch {
                  Alert.alert(
                    t('onboarding.privateChannel.whatsappErrorTitle'),
                    t('onboarding.privateChannel.whatsappErrorBody'),
                  );
                }
                return;
              }

              const url = resolvePrivateChannelBotUrl(selectedChannel);
              try {
                if (url) await Linking.openURL(url);
              } catch {
                Alert.alert(
                  t('onboarding.privateChannel.whatsappErrorTitle'),
                  t('onboarding.privateChannel.genericOpenErrorBody'),
                );
              }
              void finishOnboarding();
            }}
          >
            {t('onboarding.privateChannel.cta')}
          </Button>

          <Button mode="text" compact onPress={() => void finishOnboarding()}>
            {t('onboarding.privateChannel.skip')}
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
    } else {
      setStep(PRIVATE_CHANNEL_STEP);
    }
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.kicker, { color: theme.colors.primary }]}>
        {t('onboarding.progress', {
          current: step + 1,
          total: TOTAL_STEPS,
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
  explain: { marginTop: 10, fontSize: 14, lineHeight: 21 },
  card: { marginTop: 16 },
  situationTitle: { fontSize: 18, fontWeight: '600', lineHeight: 26, marginBottom: 16 },
  answers: { gap: 12 },
  answerSurface: { paddingVertical: 14, paddingHorizontal: 14 },
  answerText: { fontSize: 15, lineHeight: 22 },
  hint: { marginTop: 16, fontSize: 13, lineHeight: 18 },
  channelRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  channelLabel: { fontSize: 16, fontWeight: '600' },
  channelHint: { fontSize: 12, marginTop: 6 },
  channelCta: { marginTop: 8, alignSelf: 'stretch' },
  initLabel: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  initBody: { fontSize: 14, lineHeight: 21, marginBottom: 12 },
  waitingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  waitingText: { marginTop: 20, fontSize: 16, textAlign: 'center' },
});
