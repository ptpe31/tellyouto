import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Banner, useTheme } from 'react-native-paper';

import { runStartupHealthCheck } from '../services/healthCheck';

/**
 * Alerte non intrusive si la sync cloud, la base locale ou les notifications ne sont pas optimales.
 */
export function SystemHealthBanner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runStartupHealthCheck();
      if (cancelled || r.warnings.length === 0) return;
      const parts = r.warnings.map((k) =>
        k === 'health.warnNotifications'
          ? t(k)
          : `${t('health.bannerLead')} ${t(k)}`.trim(),
      );
      setMessage(parts.join(' · '));
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (!visible || !message) return null;

  return (
    <View style={{ backgroundColor: theme.colors.background }}>
      <Banner
        visible={visible}
        icon="information-outline"
        style={{ backgroundColor: theme.colors.surfaceVariant }}
        contentStyle={{ paddingVertical: 4 }}
        actions={[
          {
            label: t('health.dismiss'),
            onPress: () => setVisible(false),
          },
        ]}
      >
        {message}
      </Banner>
    </View>
  );
}
