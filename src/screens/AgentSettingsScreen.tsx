import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  List,
  RadioButton,
  SegmentedButtons,
  useTheme,
} from 'react-native-paper';

import { SafeExternalLink } from '../components/SafeExternalLink';
import { NeumorphicCard } from '../components';
import type { AgentStackParamList } from '../navigation/AgentStack';
import { useAlly, type AllyTone, type AllyVoice } from '../context/AllyContext';
import type { AppLanguage } from '../context/LanguageContext';
import { useLanguage } from '../context/LanguageContext';

const LANGS: AppLanguage[] = ['fr', 'en', 'es', 'de', 'it', 'ja', 'zh'];

export function AgentSettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<AgentStackParamList>>();
  const { t } = useTranslation();
  const theme = useTheme();
  const { language, setLanguage, interactionLanguage, setInteractionLanguage } =
    useLanguage();
  const { voice, tone, setVoice, setTone } = useAlly();

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
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.lead, { color: theme.colors.onSurfaceVariant }]}>
        {t('ally.settingsLead')}
      </Text>

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

      <View style={styles.linkBox}>
        <SafeExternalLink href="https://example.com/tellyouto-focus">
          <Text style={[styles.linkText, { color: theme.colors.primary }]}>
            {t('ally.externalHelp')}
          </Text>
        </SafeExternalLink>
      </View>

      <Pressable
        onPress={() => navigation.navigate('Debug')}
        style={({ pressed }) => [styles.debugTap, { opacity: pressed ? 0.5 : 0.35 }]}
        hitSlop={12}
      >
        <Text style={[styles.debugLabel, { color: theme.colors.outline }]}>
          ·
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 32 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  block: { marginBottom: 14 },
  section: { fontSize: 13, fontWeight: '700', marginBottom: 8, letterSpacing: 0.3 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  segment: { marginTop: 4 },
  linkBox: { paddingVertical: 12, alignItems: 'center' },
  linkText: { fontSize: 15, textDecorationLine: 'underline' },
  debugTap: {
    marginTop: 24,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  debugLabel: { fontSize: 11, letterSpacing: 2 },
});
