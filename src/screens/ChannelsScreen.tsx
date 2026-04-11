import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

type Props = {
  style?: StyleProp<TextStyle>;
};

/**
 * Mention légale affichée sous le catalogue canaux (Réglages Agent & onboarding).
 */
export function ChannelsPrivacyFootnote({ style }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Text style={[styles.foot, { color: theme.colors.outline }, style]}>
      {t('settings.channelsPrivacyFootnote')}
    </Text>
  );
}

const styles = StyleSheet.create({
  foot: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 14,
    fontStyle: 'italic',
  },
});
