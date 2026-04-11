import { Send } from 'lucide-react-native';
import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { TELEGRAM_BRAND_BLUE } from '../config/telegramBrand';

type Props = {
  size?: number;
};

const OFFICIAL_ICON =
  'https://telegram.org/img/apple-touch-icon.png';

/**
 * Icône Telegram officielle (CDN telegram.org), repli : pastille bleue + pictogramme.
 */
export function TelegramLogoMark({ size = 56 }: Props) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed) {
    return (
      <View
        style={[
          styles.fallback,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: TELEGRAM_BRAND_BLUE,
          },
        ]}
        accessibilityRole="image"
        accessibilityLabel="Telegram"
      >
        <Send color="#fff" size={size * 0.42} strokeWidth={2.2} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: OFFICIAL_ICON }}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
      }}
      accessibilityRole="image"
      accessibilityLabel="Telegram"
      onError={() => setLoadFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
