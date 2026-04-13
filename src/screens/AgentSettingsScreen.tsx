import Constants from 'expo-constants';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import {
  List,
  RadioButton,
  SegmentedButtons,
  Snackbar,
  Switch,
  TextInput,
  useTheme,
} from 'react-native-paper';

import { SafeExternalLink } from '../components/SafeExternalLink';
import {
  CalendarGranularSection,
  NeumorphicCard,
} from '../components';
import { ChannelCatalogCard } from '../components/ChannelCatalogCard';
import { PassProModal } from '../components/PassProModal';
import { SingleChannelSwitchModal } from '../components/SingleChannelSwitchModal';
import { IS_PRODUCTION } from '../config/appConfig';
import { useDebugUnlock } from '../context/DebugUnlockContext';
import { useAlly, type AllyTone, type AllyVoice } from '../context/AllyContext';
import type { AppLanguage } from '../context/LanguageContext';
import { useLanguage } from '../context/LanguageContext';
import {
  isPremiumPrivateChannel,
  listPrivateChannelIds,
  type PrivateChannelId,
  savePrivateChannelChoice,
  clearPrivateChannelChoice,
  getStoredPrivateChannelBotUrl,
  getStoredPrivateChannelId,
} from '../data/privateChannels';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import type { AgentStackParamList } from '../navigation/AgentStack';
import { disconnectChannelRemote } from '../services/channelsService';
import { ChannelsPrivacyFootnote } from './ChannelsScreen';

const LANGS: AppLanguage[] = ['fr', 'en', 'es', 'de', 'it', 'ja', 'zh'];

export function AgentSettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<AgentStackParamList>>();
  const { t } = useTranslation();
  const theme = useTheme();
  const { unlock } = useDebugUnlock();
  const version = Constants.expoConfig?.version ?? '—';
  const tapCountRef = useRef(0);
  const tapWindowRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const VERSION_TAP_MAX_GAP_MS = 2000;

  const onVersionPress = useCallback(() => {
    if (tapWindowRef.current) clearTimeout(tapWindowRef.current);
    tapCountRef.current += 1;
    tapWindowRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, VERSION_TAP_MAX_GAP_MS);
    if (tapCountRef.current < 5) return;

    tapCountRef.current = 0;
    if (tapWindowRef.current) clearTimeout(tapWindowRef.current);

    void unlock().then(() => {
      if (rootNavigationRef.isReady()) {
        rootNavigationRef.dispatch(
          CommonActions.navigate({
            name: 'App',
            params: {
              screen: 'Tabs',
              params: { screen: 'Debug' },
            },
          } as never),
        );
      }
      if (IS_PRODUCTION) {
        Alert.alert(t('ally.debugUnlockTitle'), t('ally.debugUnlockBody'));
      }
    });
  }, [t, unlock]);
  const { language, setLanguage, interactionLanguage, setInteractionLanguage } =
    useLanguage();
  const { voice, tone, setVoice, setTone } = useAlly();
  const {
    spectrum,
    applyMessengerReminderPrefs,
    mergeRemoteProfile,
    persist,
  } = useUserSpectrum();
  const [passProVisible, setPassProVisible] = useState(false);
  const [switchVisible, setSwitchVisible] = useState(false);
  const [pendingChannelId, setPendingChannelId] =
    useState<PrivateChannelId | null>(null);
  const [channelChoice, setChannelChoice] = useState<PrivateChannelId | null>(
    null,
  );
  const [leadDraft, setLeadDraft] = useState(
    String(spectrum.messenger_reminder_lead_minutes),
  );
  const [channelLinkedSnackbar, setChannelLinkedSnackbar] = useState(false);
  const prevMessengerUidRef = useRef<string | null>(null);
  const handshakeMountRef = useRef(false);

  useEffect(() => {
    setLeadDraft(String(spectrum.messenger_reminder_lead_minutes));
  }, [spectrum.messenger_reminder_lead_minutes]);

  useEffect(() => {
    void (async () => {
      const id = await getStoredPrivateChannelId();
      setChannelChoice(id);
    })();
  }, []);

  const applyChannel = useCallback(async (id: PrivateChannelId) => {
    await savePrivateChannelChoice(id);
    setChannelChoice(id);
  }, []);

  const connectChannel = useCallback(
    async (
      id: PrivateChannelId,
    ) => {
      if (isPremiumPrivateChannel(id) && !spectrum.isProUser) {
        setPassProVisible(true);
        return;
      }
      await applyChannel(id);
    },
    [applyChannel, spectrum.isProUser],
  );

  useEffect(() => {
    const uid = spectrum.lastMessengerUserId ?? null;
    if (!handshakeMountRef.current) {
      handshakeMountRef.current = true;
      prevMessengerUidRef.current = uid;
      return;
    }
    if (uid && !prevMessengerUidRef.current) {
      setChannelLinkedSnackbar(true);
    }
    prevMessengerUidRef.current = uid;
  }, [spectrum.lastMessengerUserId]);

  const disconnectActiveChannel = useCallback(
    async (id: PrivateChannelId) => {
      if (
        spectrum.lastMessengerChannel === id &&
        spectrum.lastMessengerUserId
      ) {
        await disconnectChannelRemote(id);
      }
      await clearPrivateChannelChoice();
      mergeRemoteProfile({
        last_messenger_channel: null,
        last_messenger_user_id: null,
      });
      setChannelChoice(null);
      await persist();
    },
    [
      mergeRemoteProfile,
      persist,
      spectrum.lastMessengerChannel,
      spectrum.lastMessengerUserId,
    ],
  );

  const trySelectChannel = useCallback(
    (id: PrivateChannelId) => {
      if (isPremiumPrivateChannel(id) && !spectrum.isProUser) {
        setPassProVisible(true);
        return;
      }
      const otherLinked =
        spectrum.lastMessengerChannel &&
        spectrum.lastMessengerUserId &&
        spectrum.lastMessengerChannel !== id;
      if (otherLinked) {
        setPendingChannelId(id);
        setSwitchVisible(true);
        return;
      }
      if (channelChoice === id) {
        const live =
          spectrum.lastMessengerChannel === id &&
          !!spectrum.lastMessengerUserId;
        if (live) return;
        void connectChannel(id);
        return;
      }
      void connectChannel(id);
    },
    [
      channelChoice,
      connectChannel,
      spectrum.isProUser,
      spectrum.lastMessengerChannel,
      spectrum.lastMessengerUserId,
    ],
  );

  const confirmChannelSwitch = useCallback(async () => {
    const target = pendingChannelId;
    setSwitchVisible(false);
    setPendingChannelId(null);
    if (!target) return;
    const linkedCh = spectrum.lastMessengerChannel;
    const linkedUid = spectrum.lastMessengerUserId;
    if (linkedCh && linkedUid) {
      await disconnectChannelRemote(linkedCh as PrivateChannelId);
      await clearPrivateChannelChoice();
      mergeRemoteProfile({
        last_messenger_channel: null,
        last_messenger_user_id: null,
      });
      setChannelChoice(null);
      await persist();
    }
    void connectChannel(target);
  }, [
    pendingChannelId,
    spectrum.lastMessengerChannel,
    spectrum.lastMessengerUserId,
    connectChannel,
    mergeRemoteProfile,
    persist,
  ]);

  const dismissChannelSwitch = () => {
    setSwitchVisible(false);
    setPendingChannelId(null);
  };
  const voiceOptions: { value: AllyVoice; label: string }[] = [
    { value: 'balanced', label: t('ally.voice.balanced') },
    { value: 'warm', label: t('ally.voice.warm') },
    { value: 'crisp', label: t('ally.voice.crisp') },
  ];

  const toneButtons = [
    { value: 'clear', label: t('ally.tone.clear') },
    { value: 'calm', label: t('ally.tone.calm') },
    { value: 'dynamic', label: t('ally.tone.dynamic') },
  ];

  return (
    <View
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
    >
    <ScrollView style={styles.flex} contentContainerStyle={styles.pad}>
      <Text style={[styles.lead, { color: theme.colors.onSurfaceVariant }]}>
        {t('ally.settingsLead')}
      </Text>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('ally.messengerRemindersTitle')}
        </Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('ally.messengerRemindersSubtitle')}
        </Text>
        <View style={styles.reminderRow}>
          <Text
            style={[styles.reminderLabel, { color: theme.colors.onSurface }]}
          >
            {t('ally.messengerRemindersSwitch')}
          </Text>
          <Switch
            value={spectrum.messenger_reminders_enabled !== false}
            onValueChange={(v) =>
              void applyMessengerReminderPrefs(
                v,
                spectrum.messenger_reminder_lead_minutes,
              )
            }
          />
        </View>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('ally.messengerRemindersLead')}
        </Text>
        <TextInput
          mode="outlined"
          keyboardType="number-pad"
          value={leadDraft}
          onChangeText={setLeadDraft}
          onBlur={() => {
            const n = parseInt(leadDraft.replace(/[^0-9]/g, ''), 10);
            if (!Number.isFinite(n) || n < 1) {
              setLeadDraft(String(spectrum.messenger_reminder_lead_minutes));
              return;
            }
            void applyMessengerReminderPrefs(
              spectrum.messenger_reminders_enabled !== false,
              n,
            );
          }}
          style={{ marginTop: 8, backgroundColor: theme.colors.surface }}
        />
        <Text style={[styles.hint, { marginTop: 10, color: theme.colors.outline }]}>
          {t('ally.messengerRemindersHint')}
        </Text>
      </NeumorphicCard>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('settings.channelsCatalogTitle')}
        </Text>
        {listPrivateChannelIds().filter((id) => id !== 'telegram' && id !== 'whatsapp').map((id) => {
          const isPremium = isPremiumPrivateChannel(id);
          const locked = isPremium && !spectrum.isProUser;
          const connectionStatus = (() => {
            if (
              spectrum.lastMessengerChannel === id &&
              spectrum.lastMessengerUserId
            ) {
              return 'connected' as const;
            }
            if (channelChoice === id) return 'linking' as const;
            return 'disconnected' as const;
          })();
          return (
            <ChannelCatalogCard
              key={id}
              title={t(`channelCatalog.names.${id}`)}
              freeBadgeLabel={undefined}
              recommendedBadgeLabel={undefined}
              proBadgeLabel={t('channelCatalog.proBadge')}
              isPremiumChannel={isPremium}
              showProLock={locked}
              connectionStatus={connectionStatus}
              connectLabel={t('channels.action.create_private_conv')}
              disconnectLabel={t('channels.disconnect')}
              linkingLabel={t('channels.status.linking')}
              onConnect={() => trySelectChannel(id)}
              onDisconnect={() => void disconnectActiveChannel(id)}
              footerHint={
                id === 'slack' || id === 'teams'
                  ? t('channels.hints.pro_account_required')
                  : undefined
              }
            />
          );
        })}
        <ChannelsPrivacyFootnote style={styles.channelFootnote} />
      </NeumorphicCard>

      <SingleChannelSwitchModal
        visible={switchVisible}
        targetChannelName={
          pendingChannelId
            ? t(`channelCatalog.names.${pendingChannelId}`)
            : ''
        }
        onDismiss={dismissChannelSwitch}
        onConfirm={() => void confirmChannelSwitch()}
      />

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

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('debug.calendarSection')}
        </Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('debug.calendarConnectHelp')}
        </Text>
        <CalendarGranularSection />
      </NeumorphicCard>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('ally.sectionVoice')}
        </Text>
        <RadioButton.Group
          value={voice}
          onValueChange={(v) => void setVoice(v as AllyVoice)}
        >
          {voiceOptions.map((o) => (
            <List.Item
              key={o.value}
              title={o.label}
              onPress={() => void setVoice(o.value)}
              right={() => <RadioButton value={o.value} />}
            />
          ))}
        </RadioButton.Group>
      </NeumorphicCard>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('ally.sectionTone')}
        </Text>
        <SegmentedButtons
          value={tone}
          onValueChange={(v) => void setTone(v as AllyTone)}
          buttons={toneButtons}
          style={styles.segment}
        />
      </NeumorphicCard>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('ally.sectionUiLang')}
        </Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('ally.uiLangHint')}
        </Text>
        <RadioButton.Group
          value={language}
          onValueChange={(v) => void setLanguage(v as AppLanguage)}
        >
          {LANGS.map((lng) => (
            <List.Item
              key={lng}
              title={t(`ally.lang.${lng}`)}
              onPress={() => void setLanguage(lng)}
              right={() => <RadioButton value={lng} />}
            />
          ))}
        </RadioButton.Group>
      </NeumorphicCard>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('ally.sectionAiLang')}
        </Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('ally.aiLangHint')}
        </Text>
        <RadioButton.Group
          value={interactionLanguage}
          onValueChange={(v) => void setInteractionLanguage(v as AppLanguage)}
        >
          {LANGS.map((lng) => (
            <List.Item
              key={`ai-${lng}`}
              title={t(`ally.lang.${lng}`)}
              onPress={() => void setInteractionLanguage(lng)}
              right={() => <RadioButton value={lng} />}
            />
          ))}
        </RadioButton.Group>
      </NeumorphicCard>

      <NeumorphicCard style={styles.block}>
        <Text style={[styles.section, { color: theme.colors.primary }]}>
          {t('ally.sectionLegal')}
        </Text>
        <Pressable
          onPress={() => navigation.navigate('Legal')}
          accessibilityRole="button"
          accessibilityLabel={t('ally.legalNav')}
          style={styles.legalRow}
        >
          <Text style={[styles.legalLink, { color: theme.colors.primary }]}>
            {t('ally.legalNav')}
          </Text>
        </Pressable>
      </NeumorphicCard>

      <View style={styles.linkBox}>
        <SafeExternalLink href="https://example.com/talkndone-focus">
          <Text style={[styles.linkText, { color: theme.colors.primary }]}>
            {t('ally.externalHelp')}
          </Text>
        </SafeExternalLink>
      </View>

      <Pressable
        onPress={onVersionPress}
        style={styles.versionTap}
        accessibilityRole="button"
        accessibilityLabel={t('ally.versionLabel', { version })}
      >
        <Text style={[styles.versionText, { color: theme.colors.outline }]}>
          {t('ally.versionLabel', { version })}
        </Text>
      </Pressable>

    </ScrollView>
      <Snackbar
        visible={channelLinkedSnackbar}
        onDismiss={() => setChannelLinkedSnackbar(false)}
        duration={4000}
      >
        {t('channels.feedback.success')}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 32 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  block: { marginBottom: 14 },
  section: { fontSize: 13, fontWeight: '700', marginBottom: 8, letterSpacing: 0.3 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  segment: { marginTop: 4 },
  linkBox: { paddingVertical: 12, alignItems: 'center' },
  linkText: { fontSize: 15, textDecorationLine: 'underline' },
  versionTap: {
    marginTop: 28,
    paddingVertical: 10,
    alignSelf: 'center',
  },
  versionText: { fontSize: 12, letterSpacing: 0.2 },
  channelFootnote: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 14,
    fontStyle: 'italic',
  },
  legalRow: { paddingVertical: 4 },
  legalLink: { fontSize: 15, fontWeight: '600' },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  reminderLabel: { flex: 1, fontSize: 15, lineHeight: 22 },
});
