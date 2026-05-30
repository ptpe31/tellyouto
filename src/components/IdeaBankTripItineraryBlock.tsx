import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton, useTheme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { categoryPastelTabBackground } from '../utils/categoryPastel';
import { hasTripArrivalAddress, resolveTripArrivalLabel, resolveTripOriginLabel } from '../utils/tripItineraryDisplay';

type Props = {
  row: TrankilV2TimelineItemRow;
  trip: Record<string, unknown>;
  meta: Record<string, unknown> | null;
  textPrimary: string;
  textSecondary: string;
  onRequestArrivalSetup: (row: TrankilV2TimelineItemRow) => void;
};

export function IdeaBankTripItineraryBlock({
  row,
  trip,
  meta,
  textPrimary,
  textSecondary,
  onRequestArrivalSetup,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const originLabel = resolveTripOriginLabel(trip, t);
  const arrivalLabel = resolveTripArrivalLabel(row, trip, meta);
  const hasArrival = hasTripArrivalAddress(row, trip, meta);
  const pastelBg = categoryPastelTabBackground(row.category_id);

  return (
    <View style={[styles.container, { backgroundColor: pastelBg }]}>
      <View style={styles.addrRow}>
        <View pointerEvents="none" style={styles.addrIconWrap}>
          <IconButton
            icon="map-marker-radius"
            size={18}
            iconColor={theme.colors.onSurfaceVariant}
            style={styles.addrIcon}
          />
        </View>
        <Text style={[styles.addrValue, { color: textPrimary }]} numberOfLines={2}>
          {originLabel}
        </Text>
      </View>

      <View style={styles.connectorRow}>
        <View style={styles.connectorCol}>
          <View style={[styles.connectorLine, { borderColor: theme.colors.outlineVariant }]} />
        </View>
      </View>

      <View style={styles.addrRow}>
        <View pointerEvents="none" style={styles.addrIconWrap}>
          <IconButton
            icon="flag-checkered"
            size={18}
            iconColor={theme.colors.onSurfaceVariant}
            style={styles.addrIcon}
          />
        </View>
        {hasArrival && arrivalLabel ? (
          <Text style={[styles.addrValue, { color: textPrimary }]} numberOfLines={2}>
            {arrivalLabel}
          </Text>
        ) : (
          <Pressable
            onPress={() => onRequestArrivalSetup(row)}
            style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1, flex: 1, minWidth: 0 }]}
            accessibilityRole="button"
            accessibilityLabel={t('timeline.ideaBank.tripFillAddress')}
          >
            <Text style={[styles.fillBadge, { color: textSecondary }]} numberOfLines={2}>
              {t('timeline.ideaBank.tripFillAddress')}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  addrIconWrap: {
    width: 36,
    alignItems: 'center',
  },
  addrIcon: {
    margin: 0,
    width: 36,
    height: 36,
  },
  addrValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 8,
    fontWeight: '500',
  },
  fillBadge: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 8,
    fontWeight: '600',
    opacity: 0.82,
  },
  connectorRow: {
    flexDirection: 'row',
    paddingLeft: 17,
  },
  connectorCol: {
    width: 2,
    alignItems: 'center',
  },
  connectorLine: {
    width: 0,
    height: 14,
    borderLeftWidth: 1.5,
    borderStyle: 'dashed',
  },
});
