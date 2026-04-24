import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, SegmentedButtons, Switch, useTheme } from 'react-native-paper';

import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import { NeumorphicCard } from './NeumorphicCard';

export function CalendarGranularSection() {
  const { t } = useTranslation();
  const theme = useTheme();
  const {
    connectEnabled,
    setConnectEnabled,
    deviceCalendars,
    calendarConfigs,
    calendarsListLoading,
    refreshDeviceCalendars,
    setCalendarConnected,
    setCalendarRailVisible,
  } = useCalendarIntegration();

  return (
    <View style={styles.wrap}>
      <View style={styles.switchRow}>
        <View style={styles.switchLabelCol}>
          <Text style={[styles.switchTitle, { color: theme.colors.onSurface }]}>
            {t('debug.calendarConnect')}
          </Text>
          <Text style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
            {t('debug.calendarConnectHelp')}
          </Text>
        </View>
        <Switch
          value={connectEnabled}
          onValueChange={(v) => {
            void (async () => {
              await setConnectEnabled(v);
            })();
          }}
        />
      </View>

      {connectEnabled ? (
        <>
          <Button
            mode="outlined"
            onPress={() => void refreshDeviceCalendars()}
            loading={calendarsListLoading}
            disabled={calendarsListLoading}
            style={[styles.refreshBtn, { borderColor: theme.colors.outline }]}
            textColor={theme.colors.primary}
          >
            {t('debug.calendarRefresh')}
          </Button>
          {calendarsListLoading && deviceCalendars.length === 0 ? (
            <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
          ) : null}
          {deviceCalendars.map((cal) => {
            const cfg = calendarConfigs[cal.id] ?? {
              connected: false,
              railVisible: true,
            };
            return (
              <NeumorphicCard key={cal.id} style={styles.calCard}>
                <Text
                  style={[styles.calTitle, { color: theme.colors.onSurface }]}
                  numberOfLines={2}
                >
                  {cal.title || t('debug.calendarUntitled')}
                </Text>
                {cal.source ? (
                  <Text
                    style={[styles.calSource, { color: theme.colors.onSurfaceVariant }]}
                    numberOfLines={1}
                  >
                    {cal.source}
                  </Text>
                ) : null}
                <View style={styles.row}>
                  <Text style={[styles.label, { color: theme.colors.onSurface }]}>
                    {t('debug.calendarConnectedToggle')}
                  </Text>
                  <Switch
                    value={cfg.connected}
                    onValueChange={(v) => void setCalendarConnected(cal.id, v)}
                  />
                </View>
                <Text
                  style={[styles.sublabel, { color: theme.colors.onSurfaceVariant }]}
                >
                  {t('debug.calendarRailVisibilityHelp')}
                </Text>
                <SegmentedButtons
                  value={cfg.railVisible ? 'show' : 'hide'}
                  onValueChange={(v) => {
                    if (!cfg.connected) return;
                    void setCalendarRailVisible(cal.id, v === 'show');
                  }}
                  buttons={[
                    {
                      value: 'hide',
                      label: t('debug.calendarRailHide'),
                      disabled: !cfg.connected,
                    },
                    {
                      value: 'show',
                      label: t('debug.calendarRailShow'),
                      disabled: !cfg.connected,
                    },
                  ]}
                  style={styles.segment}
                />
              </NeumorphicCard>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  switchLabelCol: { flex: 1 },
  switchTitle: { fontSize: 16, fontWeight: '600' },
  help: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  refreshBtn: { marginBottom: 12 },
  loader: { marginVertical: 12 },
  calCard: { marginBottom: 12, paddingVertical: 12 },
  calTitle: { fontSize: 16, fontWeight: '700' },
  calSource: { fontSize: 12, marginTop: 2, marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: { fontSize: 14, fontWeight: '600', flex: 1 },
  sublabel: { fontSize: 12, lineHeight: 16, marginBottom: 6 },
  segment: { marginTop: 4 },
});
