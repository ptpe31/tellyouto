import Constants from 'expo-constants';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useRef } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { List, RadioButton, SegmentedButtons, useTheme } from 'react-native-paper';
import { SafeExternalLink } from '../components/SafeExternalLink';
import { CalendarGranularSection, NeumorphicCard } from '../components';
import { IS_PRODUCTION } from '../config/appConfig';
import { useDebugUnlock } from '../context/DebugUnlockContext';
import { useAlly, type AllyTone, type AllyVoice } from '../context/AllyContext';
import type { AppLanguage } from '../context/LanguageContext';
import { useLanguage } from '../context/LanguageContext';
import { rootNavigationRef } from '../navigation/rootNavigationRef';
import type { AgentStackParamList } from '../navigation/AgentStack';

const LANGS: AppLanguage[] = [
  'fr',
  'en',
  'es',
  'de',
  'it',
  'ja',
  'zh',
  'ar',
  'ko',
  'nl',
  'sv',
];

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
  const { language, setLanguage, interactionLanguage, setInteractionLanguage } =
    useLanguage();
  const { voice, tone, setVoice, setTone } = useAlly();

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
            params: { screen: 'Tabs', params: { screen: 'Debug' } },
          } as never),
        );
      }
      if (IS_PRODUCTION) {
        Alert.alert(t('ally.debugUnlockTitle'), t('ally.debugUnlockBody'));
      }
    });
  }, [t, unlock]);

  const onVersionLongPress = useCallback(() => {
    void unlock().then(() => {
      if (rootNavigationRef.isReady()) {
        rootNavigationRef.dispatch(
          CommonActions.navigate({
            name: 'App',
            params: { screen: 'Tabs', params: { screen: 'Debug' } },
          } as never),
        );
      }
      if (IS_PRODUCTION) {
        Alert.alert(t('ally.debugUnlockTitle'), t('ally.debugUnlockBody'));
      }
    });
  }, [t, unlock]);

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
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.pad}>
        <Text style={[styles.lead, { color: theme.colors.onSurfaceVariant }]}>
          {t('ally.settingsLead')}
        </Text>

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
          onLongPress={onVersionLongPress}
          delayLongPress={3000}
          style={styles.versionTap}
          accessibilityRole="button"
          accessibilityLabel={t('ally.versionLabel', { version })}
        >
          <Text style={[styles.versionText, { color: theme.colors.outline }]}>
            {t('ally.versionLabel', { version })}
          </Text>
        </Pressable>
      </ScrollView>
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
  versionTap: { marginTop: 28, paddingVertical: 10, alignSelf: 'center' },
  versionText: { fontSize: 12, letterSpacing: 0.2 },
  legalRow: { paddingVertical: 4 },
  legalLink: { fontSize: 15, fontWeight: '600' },
});
