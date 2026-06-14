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
  omitTravelMilestoneInLine2?: boolean;
  hidePastille?: boolean;
  titleDone?: boolean;
  /** Nombre de lignes pour le titre (défaut 1). */
  titleLines?: number;
  /** Masque la ligne 2 (sous-tâches zoom Inbox). */
  hideLine2?: boolean;
  omitNewBadge?: boolean;
};

export function InboxLineTitle({
  row,
  textPrimary,
  textSecondary,
  locale,
  sourcingChildCount,
  omitTravelMilestoneInLine2,
  hidePastille,
  titleDone,
  titleLines = 1,
  hideLine2 = false,
  omitNewBadge,
}: Props) {
  const { t, i18n } = useTranslation();
  const loc = locale || i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
  const multiline = titleLines > 1;

  const { line1, line2 } = useMemo(
    () =>
      resolveInboxLinePresentation({
        row,
        locale: loc,
        t,
        sourcingChildCount,
        omitTravelMilestoneInLine2,
        omitNewBadge,
      }),
    [loc, omitNewBadge, omitTravelMilestoneInLine2, row, sourcingChildCount, t],
  );

  const pastel = categoryPastelTabBackground(row.category_id);
  const done = titleDone ?? row.status === 'DONE';
  const showLine2 = !hideLine2 && Boolean(String(line2 ?? '').trim());

  return (
    <View style={[styles.root, multiline ? styles.rootMultiline : null]}>
      {!hidePastille ? <View style={[styles.pastille, { backgroundColor: pastel }]} /> : null}
      <View style={styles.textCol}>
        <Text
          style={[
            styles.line1,
            { color: textPrimary },
            done ? styles.line1Done : null,
          ]}
          numberOfLines={titleLines}
          ellipsizeMode="tail"
        >
          {line1}
        </Text>
        {showLine2 ? (
          <Text
            style={[
              styles.line2,
              { color: textSecondary },
              done ? styles.line2Done : null,
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {line2}
          </Text>
        ) : null}
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
  rootMultiline: {
    alignItems: 'flex-start',
    maxHeight: undefined,
    minHeight: 22,
  },
  pastille: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
    marginTop: 4,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  line1: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  line1Done: {
    textDecorationLine: 'line-through',
    opacity: 0.72,
  },
  line2: {
    fontSize: 11,
    marginTop: 2,
  },
  line2Done: {
    opacity: 0.72,
  },
});
