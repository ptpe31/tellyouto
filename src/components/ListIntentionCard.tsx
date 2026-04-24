import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { Minus, Plus } from 'lucide-react-native';

import type { TrankilV2TimelineItemRow } from '../api';
import { updateTrankilV2IntentionMetadataJson } from '../api/trankilV2Db';
import {
  mergeListPayloadIntoMetadataJson,
  parseListScalablePayloadFromMetadataJson,
  type ListScalablePayload,
} from '../services/listIntentionModel';
import { neumorphicInset } from '../theme/neumorphism';

/**
 * Formate une quantité + unité avec **pluriel** selon `Intl.PluralRules` et i18n.
 *
 * @param t — Fonction `react-i18next` pour les clés `listIntention.units.*`.
 * @param lng — Code langue BCP‑47 (ex. `fr`, `en`).
 * @param unit — Clé unité normalisée (`g`, `kg`, `piece`, …).
 * @param qty — Quantité affichée (peut être décimale).
 * @returns Libellé localisé ou repli `"{qty} {unit}"`.
 */
function formatUnitLabel(
  t: (k: string, o?: Record<string, string | number>) => string,
  lng: string,
  unit: string,
  qty: number,
): string {
  const u = String(unit || 'piece').toLowerCase();
  const n = Number.isFinite(qty) ? qty : 0;
  const rounded = Math.round(n * 1000) / 1000;
  let rule: string;
  try {
    rule = new Intl.PluralRules(lng).select(rounded);
  } catch {
    rule = rounded === 1 ? 'one' : 'other';
  }
  const key = `listIntention.units.${u}.${rule}`;
  const translated = t(key, { count: rounded });
  if (translated !== key) return translated;
  const fallbackKey = `listIntention.units.${u}.other`;
  const fb = t(fallbackKey, { count: rounded });
  if (fb !== fallbackKey) return fb;
  return `${rounded} ${u}`;
}

export type ListIntentionCardProps = {
  row: TrankilV2TimelineItemRow;
  theme: MD3Theme;
  spectrumIsPro: boolean;
};

/**
 * Carte **Timeline** pour une intention `LIST` : multiplicateur (Pro), lignes cochables,
 * persistance du JSON liste dans `metadata_json`.
 *
 * @param props.row — Ligne timeline / intention SQLite.
 * @param props.theme — Thème Paper MD3 pour les surfaces.
 * @param props.spectrumIsPro — Active le recalcul quantités ; sinon teaser Pro sur ±.
 * @returns Arbre React de la carte liste.
 */
export function ListIntentionCard({ row, theme, spectrumIsPro }: ListIntentionCardProps) {
  const { t, i18n } = useTranslation();
  const [payload, setPayload] = useState<ListScalablePayload | null>(() =>
    parseListScalablePayloadFromMetadataJson(row.metadata_json),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPayload(parseListScalablePayloadFromMetadataJson(row.metadata_json));
  }, [row.metadata_json]);

  const persist = useCallback(
    (next: ListScalablePayload, silent: boolean) => {
      const json = mergeListPayloadIntoMetadataJson(row.metadata_json, next);
      void updateTrankilV2IntentionMetadataJson(row.id, json, { silent });
    },
    [row.id, row.metadata_json],
  );

  const schedulePersist = useCallback(
    (next: ListScalablePayload) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        persist(next, true);
      }, 320);
    },
    [persist],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const onProTeaser = useCallback(() => {
    Alert.alert(t('listIntention.proTeaserTitle'), t('listIntention.proTeaserBody'));
  }, [t]);

  const bumpMultiplier = useCallback(
    (delta: number) => {
      if (!payload) return;
      if (!spectrumIsPro) {
        onProTeaser();
        return;
      }
      const nextMult = Math.max(1, payload.multiplier + delta);
      const next = { ...payload, multiplier: nextMult };
      setPayload(next);
      persist(next, true);
    },
    [onProTeaser, payload, persist, spectrumIsPro],
  );

  const toggleItem = useCallback(
    (uid: string) => {
      if (!payload) return;
      const next: ListScalablePayload = {
        ...payload,
        categories: payload.categories.map((cat) => ({
          ...cat,
          items: cat.items.map((it) =>
            it.uid === uid ? { ...it, checked: !it.checked } : it,
          ),
        })),
      };
      setPayload(next);
      schedulePersist(next);
    },
    [payload, schedulePersist],
  );

  const cardStyle = useMemo(
    () => [
      styles.card,
      neumorphicInset(theme),
      {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.outlineVariant,
      },
    ],
    [theme],
  );

  if (!payload) {
    return (
      <View style={cardStyle}>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('listIntention.unreadable')}</Text>
      </View>
    );
  }

  return (
    <View style={cardStyle}>
      <Text style={[styles.title, { color: theme.colors.primary }]}>{payload.title}</Text>
      <View style={styles.multiplierRow}>
        <Pressable
          onPress={() => bumpMultiplier(-1)}
          style={[
            styles.stepBtn,
            { borderColor: theme.colors.outline, opacity: spectrumIsPro ? 1 : 0.55 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('listIntention.a11yDecrease')}
        >
          <Minus size={18} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={[styles.multiplierText, { color: theme.colors.onSurface }]}>
          {payload.multiplier} {payload.unitLabel}
        </Text>
        <Pressable
          onPress={() => bumpMultiplier(1)}
          style={[
            styles.stepBtn,
            { borderColor: theme.colors.outline, opacity: spectrumIsPro ? 1 : 0.55 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('listIntention.a11yIncrease')}
        >
          <Plus size={18} color={theme.colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {payload.categories.map((cat) => (
          <View key={cat.name} style={styles.catBlock}>
            <Text style={[styles.catTitle, { color: theme.colors.tertiary }]}>{cat.name}</Text>
            {cat.items.map((it) => {
              const base = it.scalable ? it.qty * payload.multiplier : it.qty;
              const qtyLabel = formatUnitLabel(t, i18n.language, it.unit, base);
              return (
                <Pressable
                  key={it.uid}
                  onPress={() => toggleItem(it.uid)}
                  style={styles.itemRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: Boolean(it.checked) }}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: it.checked ? theme.colors.primary : theme.colors.outline,
                        backgroundColor: it.checked ? theme.colors.primaryContainer : 'transparent',
                      },
                    ]}
                  >
                    {it.checked ? <Text style={{ color: theme.colors.primary, fontWeight: '900' }}>✓</Text> : null}
                  </View>
                  <View style={styles.itemTextCol}>
                    <Text
                      style={[
                        styles.itemName,
                        {
                          color: it.checked ? theme.colors.onSurfaceVariant : theme.colors.onSurface,
                          textDecorationLine: it.checked ? 'line-through' : 'none',
                        },
                      ]}
                    >
                      {it.name}
                    </Text>
                    <Text style={[styles.itemQty, { color: theme.colors.onSurfaceVariant }]}>{qtyLabel}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  title: { fontSize: 16, fontWeight: '800' },
  multiplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 4,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiplierText: { fontSize: 15, fontWeight: '700', minWidth: 120, textAlign: 'center' },
  scroll: { maxHeight: 260 },
  catBlock: { marginTop: 6, gap: 6 },
  catTitle: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTextCol: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600' },
  itemQty: { fontSize: 12, marginTop: 2 },
});
