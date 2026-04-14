import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert, Pressable } from 'react-native';
import Share from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

import {
  getTrankilV2UserStats,
  grantViralBonus,
  listHerbierEntries,
  type HerbierRow,
} from '../api/trankilV2Db';
import { STRINGS } from '../constants/Strings';
import { flowerGlyphForType, flowerImageUri, flowerLabelForType } from '../constants/Seasons';

function organizedFromAchievements(rawJson: string): number {
  try {
    const parsed = JSON.parse(rawJson) as { organized_count?: number };
    return Number(parsed.organized_count ?? 0);
  } catch {
    return 0;
  }
}

export function HerbierCollectionScreen() {
  const [rows, setRows] = useState<HerbierRow[]>([]);
  const [serenityDays, setSerenityDays] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [captureNode, setCaptureNode] = useState<View | null>(null);

  const load = useCallback(async () => {
    const list = await listHerbierEntries();
    const stats = await getTrankilV2UserStats();
    const days = Math.max(
      0,
      Math.floor((Date.now() - (stats.current_flower_started_at || Date.now())) / (24 * 60 * 60 * 1000)),
    );
    setSerenityDays(days);
    setRows(list);
    await Promise.all(list.map((row) => Image.prefetch(flowerImageUri(row.flower_type))));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const prestigeActive = useMemo(() => rows.length > 3, [rows.length]);

  const shareGardenSnapshot = useCallback(async () => {
    if (!captureNode || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(captureNode, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      const result = await Share.open({
        title: 'Trankil',
        message: `${STRINGS.SHARE_MESSAGE} https://trankil.app`,
        url: `file://${uri}`,
        failOnCancel: false,
      });
      const didShare =
        Boolean((result as { finished?: boolean }).finished) ||
        Boolean((result as { success?: boolean }).success) ||
        Boolean((result as { dismissedAction?: boolean }).dismissedAction === false);
      if (didShare) {
        const bonus = await grantViralBonus();
        if (bonus.granted) {
          Alert.alert(STRINGS.COMMON.APP_NAME, STRINGS.herbier.viralBonusGranted);
        }
      }
    } finally {
      setSharing(false);
    }
  }, [captureNode, sharing]);

  return (
    <LinearGradient
      colors={['#f4f4ee', '#f8f6f2', '#fefcf9']}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.root}
    >
      <Text style={styles.title}>{STRINGS.herbier.screenTitle}</Text>
      {prestigeActive ? <Text style={styles.prestige}>{STRINGS.herbier.prestigeUnlocked}</Text> : null}
      <View
        ref={(node) => setCaptureNode(node)}
        collapsable={false}
        style={styles.captureZone}
      >
        <LinearGradient
          colors={['#b7ebcd', '#e0f6cf', '#fff6dc']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.captureSky}
        >
          <Text style={styles.captureFlower}>🌸</Text>
          <Text style={styles.captureStats}>{serenityDays} jours de serenite</Text>
          <Text style={styles.captureBrand}>Trankil</Text>
        </LinearGradient>
      </View>
      <Pressable
        style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
        onPress={() => void shareGardenSnapshot()}
        disabled={sharing}
      >
        <Text style={styles.shareBtnText}>
          {sharing ? STRINGS.herbier.sharing : STRINGS.herbier.shareButton}
        </Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.grid}>
        {rows.length === 0 ? <Text style={styles.empty}>{STRINGS.herbier.emptyState}</Text> : null}
        {rows.map((row) => {
          const organized = organizedFromAchievements(row.achievements_json);
          const month = new Date(row.harvested_at).toLocaleString('fr-FR', { month: 'long' });
          return (
            <View key={row.id} style={styles.card}>
              <Image
                source={{ uri: flowerImageUri(row.flower_type), cache: 'force-cache' }}
                style={styles.thumb}
              />
              <Text style={styles.glyph}>{flowerGlyphForType(row.flower_type)}</Text>
              <Text style={styles.cardTitle}>{flowerLabelForType(row.flower_type)}</Text>
              <Text style={styles.statText}>
                Fleur de {month}: {organized} intentions organisees
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 58, paddingHorizontal: 18 },
  title: { fontSize: 28, fontWeight: '800', color: '#2f4f5a', textAlign: 'center' },
  captureZone: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.14)',
  },
  captureSky: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  captureFlower: { fontSize: 56 },
  captureStats: { marginTop: 8, fontSize: 14, color: '#2f4f5a', fontWeight: '700' },
  captureBrand: {
    position: 'absolute',
    right: 10,
    bottom: 8,
    fontSize: 12,
    color: 'rgba(47,79,90,0.75)',
    fontWeight: '800',
  },
  shareBtn: {
    marginTop: 10,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.36)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'transparent',
  },
  shareBtnPressed: { opacity: 0.82 },
  shareBtnText: { fontSize: 13, color: '#2f4f5a', fontWeight: '700' },
  prestige: {
    marginTop: 8,
    textAlign: 'center',
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '700',
  },
  grid: { paddingTop: 18, paddingBottom: 28, gap: 12 },
  empty: { textAlign: 'center', color: '#64748b', marginTop: 24 },
  card: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.16)',
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  glyph: { fontSize: 38 },
  thumb: { width: 86, height: 86, borderRadius: 12, marginBottom: 8 },
  cardTitle: { marginTop: 8, fontSize: 16, color: '#2f4f5a', fontWeight: '800' },
  statText: { marginTop: 6, fontSize: 12, color: '#475569', textAlign: 'center' },
});

