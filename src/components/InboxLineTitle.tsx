import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { categoryPastelTabBackground } from '../utils/categoryPastel';
import { resolveInboxLinePresentation } from '../utils/inboxLineModel';

type Props = {
  row: TrankilV2TimelineItemRow;
  textPrimary: string;
  textSecondary: string;
  locale?: string;
  sourcingChildCount?: number;
};

export function InboxLineTitle({ row, textPrimary, textSecondary, locale, sourcingChildCount }: Props) {
  const { t, i18n } = useTranslation();
  const loc = locale || i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;

  const { line1, line2 } = useMemo(
    () =>
      resolveInboxLinePresentation({
        row,
        locale: loc,
        t,
        sourcingChildCount,
      }),
    [loc, row, sourcingChildCount, t],
  );

  const pastel = categoryPastelTabBackground(row.category_id);

  return (
    <View style={styles.root}>
      <View style={[styles.pastille, { backgroundColor: pastel }]} />
      <View style={styles.textCol}>
        <Text style={[styles.line1, { color: textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
          {line1}
        </Text>
        <Text style={[styles.line2, { color: textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
          {line2}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    maxHeight: 36,
    gap: 8,
  },
  pastille: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  line1: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 18,
  },
  line2: {
    fontSize: 12,
    lineHeight: 16,
  },
});
