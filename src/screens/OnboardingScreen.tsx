import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Portal, TextInput, useTheme } from 'react-native-paper';
import {
  applyDelta,
  initialOnboardingWeights,
  normalizeSpectrumWeights,
  ONBOARDING_SITUATIONS,
} from '../data/onboardingSituations';
import {
  listPrivateChannelIds,
  isPremiumPrivateChannel,
  type PrivateChannelId,
  resolvePrivateChannelBotUrl,
  savePrivateChannelChoice,
} from '../data/privateChannels';
import { NeumorphicCard, NeumorphicSurface } from '../components';
import { PassProModal } from '../components/PassProModal';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import { useLanguage } from '../context/LanguageContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { TELEGRAM_BRAND_BLUE } from '../config/telegramBrand';
import {
  getBotInitializationMessage,
  getAppLinkForConnector,
  buildWhatsAppRailDeepLink,
  buildTelegramStartLink,
  getTelegramAllyWelcomeMessage,
} from '../services/connectorLinks';
import { pushDeviceProfileToFirestore } from '../api/userProfile';
import { getOrCreateDeviceId } from '../api/syncService';

type Props = {
  onComplete: () => void;
};

const TELEGRAM_STORE_URL = Platform.select({
  ios: 'https://apps.apple.com/app/telegram-messenger/id686449807',
  android:
    'https://play.google.com/store/apps/details?id=org.telegram.messenger',
  default: 'https://telegram.org/dl',
});

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
    grantAdFreeDays,
  } = useUserSpectrum();

  const [step, setStep] = useState(FIRST_NAME_STEP);
  const [firstNameInput, setFirstNameInput] = useState('');
  const [weights, setWeights] = useState(initialOnboardingWeights);
  const [selectedChannel, setSelectedChannel] =
    useState<PrivateChannelId | null>(null);
  const [initCopied, setInitCopied] = useState(false);
  const [waitingConnection, setWaitingConnection] = useState(false);
  const [waLinkPreview, setWaLinkPreview] = useState<string | null>(null);
  const [telegramStartUrl, setTelegramStartUrl] = useState<string | null>(null);
  const [telegramInstalled, setTelegramInstalled] = useState<boolean | null>(
    null,
  );
  const [showTelegramReward, setShowTelegramReward] = useState(false);
  const [passProVisible, setPassProVisible] = useState(false);
  const pendingTelegramInstallReward = useRef(false);
  const waHintOpacity = useRef(new Animated.Value(1)).current;

  const trySelectChannel = useCallback(
    (id: PrivateChannelId) => {
      if (isPremiumPrivateChannel(id) && !spectrum.isProUser) {
        setPassProVisible(true);
        return;
      }
      setSelectedChannel(id);
    },
    [spectrum.isProUser],
  );

  const checkTelegramInstalled = useCallback(async () => {
    try {
      const can = await Linking.canOpenURL('tg://');
      setTelegramInstalled(can);
    } catch {
      setTelegramInstalled(false);
    }
  }, []);

  useEffect(() => {
    void checkTelegramInstalled();
  }, [checkTelegramInstalled]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void (async () => {
        await checkTelegramInstalled();
        if (!pendingTelegramInstallReward.current) return;
        const can = await Linking.canOpenURL('tg://');
        if (can) {
          pendingTelegramInstallReward.current = false;
          setTelegramInstalled(true);
          await grantAdFreeDays(15);
          setShowTelegramReward(true);
        }
      })();
    });
    return () => sub.remove();
  }, [checkTelegramInstalled, grantAdFreeDays]);

  useEffect(() => {
    if (selectedChannel !== 'whatsapp') return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(waHintOpacity, {
          toValue: 0.62,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(waHintOpacity, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [selectedChannel, waHintOpacity]);

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

  useEffect(() => {
    if (selectedChannel !== 'telegram') {
      setTelegramStartUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const uid = await getOrCreateDeviceId();
      if (!cancelled) {
        setTelegramStartUrl(buildTelegramStartLink(uid));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedChannel]);

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
      ad_free_until_ms: spectrum.ad_free_until_ms ?? undefined,
      is_pro_user: spectrum.isProUser || undefined,
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
    const nameForBot = spectrum.first_name || firstNameInput.trim();
    const initMsg =
      selectedChannel === 'telegram'
        ? getTelegramAllyWelcomeMessage(language, nameForBot, appLink)
        : getBotInitializationMessage(language, nameForBot, appLink);

    return (
      <>
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
          {t('onboarding.privateChannel.telegramPitch')}
        </Text>
        {telegramInstalled === false ? (
          <View
            style={[
              styles.giftBadge,
              { borderColor: '#C9A227', backgroundColor: 'rgba(255, 193, 7, 0.2)' },
            ]}
          >
            <Text style={[styles.giftBadgeText, { color: theme.colors.onSurface }]}>
              {t('onboarding.privateChannel.telegramGiftBadge')}
            </Text>
          </View>
        ) : telegramInstalled === true ? (
          <Text
            style={[styles.telegramReady, { color: theme.colors.primary }]}
          >
            {t('onboarding.privateChannel.telegramReady')}
          </Text>
        ) : null}

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
            const isTelegram = id === 'telegram';
            const isWa = id === 'whatsapp';
            return (
              <Pressable
                key={id}
                onPress={() => trySelectChannel(id)}
                style={({ pressed }) => [
                  styles.channelRow,
                  {
                    borderColor: selected
                      ? isTelegram
                        ? TELEGRAM_BRAND_BLUE
                        : theme.colors.primary
                      : theme.colors.outline,
                    borderWidth: selected && isTelegram ? 2 : 1,
                    backgroundColor:
                      selected && isTelegram
                        ? 'rgba(0, 136, 204, 0.08)'
                        : 'transparent',
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
              >
                <View style={styles.channelTitleRow}>
                  <Text
                    style={[styles.channelLabel, { color: theme.colors.onSurface }]}
                  >
                    {t(`onboarding.privateChannel.platforms.${id}`)}
                  </Text>
                  {isTelegram ? (
                    <View
                      style={[
                        styles.recommendedPill,
                        { backgroundColor: TELEGRAM_BRAND_BLUE },
                      ]}
                    >
                      <Text style={styles.recommendedPillText}>
                        {t('onboarding.privateChannel.recommended')}
                      </Text>
                    </View>
                  ) : null}
                  {isPremiumPrivateChannel(id) && !spectrum.isProUser ? (
                    <NeumorphicSurface style={styles.lockChip}>
                      <Text style={styles.lockEmoji}>🔒</Text>
                    </NeumorphicSurface>
                  ) : null}
                </View>
                {isWa ? (
                  <Text
                    style={[styles.channelSecondary, { color: theme.colors.error }]}
                  >
                    {t('onboarding.privateChannel.whatsappCostHint')}
                  </Text>
                ) : null}
                {(id === 'line' || id === 'slack') && (
                  <Text
                    style={[
                      styles.channelSecondary,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {t('onboarding.privateChannel.proChannelsHint')}
                  </Text>
                )}
                {selected ? (
                  <Text
                    style={[
                      styles.channelHint,
                      {
                        color: isTelegram
                          ? TELEGRAM_BRAND_BLUE
                          : theme.colors.primary,
                      },
                    ]}
                    numberOfLines={6}
                  >
                    {isWa && waLinkPreview
                      ? waLinkPreview
                      : isTelegram && telegramStartUrl
                        ? telegramStartUrl
                        : resolvePrivateChannelBotUrl(id) ||
                          t('onboarding.privateChannel.urlPending')}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          {telegramInstalled === false ? (
            <Button
              mode="contained-tonal"
              icon="gift"
              style={styles.installTelegramBtn}
              buttonColor="rgba(201, 162, 39, 0.35)"
              textColor={theme.colors.onSurface}
              onPress={() => {
                pendingTelegramInstallReward.current = true;
                void Linking.openURL(TELEGRAM_STORE_URL);
              }}
            >
              {t('onboarding.privateChannel.installTelegram')}
            </Button>
          ) : null}

          {selectedChannel === 'whatsapp' ? (
            <Animated.Text
              style={[
                styles.dictationHint,
                {
                  color: theme.colors.primary,
                  opacity: waHintOpacity,
                },
              ]}
            >
              {t('onboarding.privateChannel.dictationHint')}
            </Animated.Text>
          ) : null}

          <Button
            mode="contained"
            style={styles.channelCta}
            disabled={selectedChannel === null}
            buttonColor={
              selectedChannel === 'telegram' ? TELEGRAM_BRAND_BLUE : undefined
            }
            textColor={selectedChannel === 'telegram' ? '#ffffff' : undefined}
            onPress={async () => {
              if (!selectedChannel) return;
              const uid = await getOrCreateDeviceId();

              if (selectedChannel === 'telegram') {
                const url = buildTelegramStartLink(uid);
                await savePrivateChannelChoice('telegram', url);
                try {
                  await Linking.openURL(url);
                } catch {
                  Alert.alert(
                    t('onboarding.privateChannel.whatsappErrorTitle'),
                    t('onboarding.privateChannel.genericOpenErrorBody'),
                  );
                }
                void finishOnboarding();
                return;
              }

              await savePrivateChannelChoice(selectedChannel);

              if (selectedChannel === 'whatsapp') {
                const name = (spectrum.first_name || firstNameInput).trim() || 'toi';
                const waUrl = buildWhatsAppRailDeepLink(name, uid);
                try {
                  await Linking.openURL(waUrl);
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
      <PassProModal
        visible={passProVisible}
        onDismiss={() => setPassProVisible(false)}
        onOpenSubscription={() => {
          setPassProVisible(false);
          if (rootNavigationRef.isReady()) {
            rootNavigationRef.navigate('ProSubscription');
          }
        }}
      />
      <Portal>
        {showTelegramReward ? (
          <View style={styles.rewardOverlay}>
            <NeumorphicCard style={styles.rewardCard}>
              <Text
                style={[styles.rewardTitle, { color: theme.colors.primary }]}
              >
                {t('onboarding.privateChannel.rewardTitle')}
              </Text>
              <Text
                style={[styles.rewardBody, { color: theme.colors.onSurface }]}
              >
                {t('onboarding.privateChannel.rewardBody')}
              </Text>
              <Button
                mode="contained"
                style={styles.channelCta}
                buttonColor={TELEGRAM_BRAND_BLUE}
                textColor="#ffffff"
                onPress={() => setShowTelegramReward(false)}
              >
                {t('onboarding.privateChannel.rewardDismiss')}
              </Button>
            </NeumorphicCard>
          </View>
        ) : null}
      </Portal>
      </>
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
  channelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  channelLabel: { fontSize: 16, fontWeight: '600' },
  recommendedPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  recommendedPillText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  lockChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  lockEmoji: { fontSize: 14 },
  channelSecondary: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  channelHint: { fontSize: 12, marginTop: 6 },
  giftBadge: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  giftBadgeText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  telegramReady: { fontSize: 14, fontWeight: '600', marginBottom: 10 },
  installTelegramBtn: { marginBottom: 8, alignSelf: 'stretch' },
  rewardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
    zIndex: 50,
  },
  rewardCard: { paddingVertical: 20 },
  rewardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  rewardBody: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  dictationHint: {
    marginTop: 4,
    marginBottom: 2,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
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
