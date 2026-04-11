import React from 'react';
import { Alert, Linking, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

type Props = Omit<PressableProps, 'onPress'> & {
  href: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Safe-Click : confirmation douce avant d’ouvrir un lien externe (focus TellYouTo).
 */
export function SafeExternalLink({ href, children, style, ...rest }: Props) {
  const { t } = useTranslation();

  const onPress = () => {
    Alert.alert(
      t('safeExternal.title'),
      t('safeExternal.message'),
      [
        { text: t('safeExternal.stay'), style: 'cancel' },
        {
          text: t('safeExternal.leave'),
          onPress: () => {
            void Linking.openURL(href);
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={style} {...rest}>
      {children}
    </Pressable>
  );
}
