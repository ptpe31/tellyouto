import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addIaCredits, getTrankilV2UserStats, spendZenPoints, updateGrowth } from '../../api/trankilV2Db';
import { syncPendingIntentions } from '../../api/syncService';
import { STRINGS } from '../../constants/Strings';
import { useUserSpectrum } from '../../context/UserSpectrumContext';
import { claimDailyQuestBonus, getDailyQuestSnapshot, type DailyQuest } from '../../services/QuestManager';

export function ZenGardenScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { spectrum, grantAdFreeDays } = useUserSpectrum();

  const [loading, setLoading] = useState(true);
  const [zenPoints, setZenPoints] = useState(0);
  const [iaCredits, setIaCredits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dailyQuest, setDailyQuest] = useState<DailyQuest | null>(null);
  const [questProgress, setQuestProgress] = useState(0);
  const [questTarget, setQuestTarget] = useState(0);
  const [questCanClaim, setQuestCanClaim] = useState(false);
  const [questClaimed, setQuestClaimed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await getTrankilV2UserStats();
      setZenPoints(stats.growth_score);
      setIaCredits(stats.ia_credits);
      const quest = await getDailyQuestSnapshot();
      setDailyQuest(quest.quest);
      setQuestProgress(quest.progress);
      setQuestTarget(quest.target);
      setQuestCanClaim(quest.canClaim);
      setQuestClaimed(quest.claimed);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onDebugAddPoints = useCallback(async () => {
    setBusy(true);
    try {
      await updateGrowth(10);
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const onDebugAddCredits = useCallback(async () => {
    setBusy(true);
    try {
      await addIaCredits(1);
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const onClaimQuest = useCallback(async () => {
    if (!questCanClaim || busy) return;
    setBusy(true);
    try {
      const claim = await claimDailyQuestBonus();
      if (!claim.ok) {
        Alert.alert('Quete non prete', 'Objectif non atteint.');
        return;
      }
      await syncPendingIntentions();
      Alert.alert('Bonus recu', `+${claim.gain} Points Zen`);
      await load();
    } finally {
      setBusy(false);
    }
  }, [busy, load, questCanClaim]);

  const onBuySerenity = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const spent = await spendZenPoints(500);
      if (!spent.ok) {
        Alert.alert('Solde insuffisant', 'Il faut 500Z pour activer 24h de serenite.');
        return;
      }
      await grantAdFreeDays(1);
      await syncPendingIntentions();
      await load();
      Alert.alert('Achat valide', '24h de serenite activees.');
    } finally {
      setBusy(false);
    }
  }, [busy, grantAdFreeDays, load]);

  const onBuyBoost = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const spent = await spendZenPoints(300);
      if (!spent.ok) {
        Alert.alert('Solde insuffisant', 'Il faut 300Z pour acheter ce boost.');
        return;
      }
      await addIaCredits(5);
      await syncPendingIntentions();
      await load();
      Alert.alert('Achat valide', '+5 credits IA ajoutes.');
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  const adFreeActive =
    typeof spectrum.ad_free_until_ms === 'number' &&
    Number.isFinite(spectrum.ad_free_until_ms) &&
    spectrum.ad_free_until_ms > Date.now();

  if (loading) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top + 8 }]}>
        <ActivityIndicator color="#2d6f70" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>{t('zenGarden.screenTitle')}</Text>
      {adFreeActive ? <Text style={styles.zenModeBadge}>Mode Zen Actif</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Points Zen</Text>
        <Text style={styles.cardValue}>{zenPoints}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Credits IA</Text>
        <Text style={styles.cardValue}>{iaCredits}</Text>
      </View>

      <View style={styles.shopCard}>
        <Text style={styles.shopTitle}>Boutique de Temps (bientot)</Text>
        <Text style={styles.shopText}>
          Etat ad-free: {adFreeActive ? 'Actif' : 'Inactif'}.
        </Text>
        <Text style={styles.shopText}>
          Supprime les bannieres et publicites intrusives. Note : La recharge manuelle de l'IA via video reste disponible pour alimenter tes projets.
        </Text>
        <Pressable
          onPress={() => void onBuySerenity()}
          style={[styles.buyBtn, busy ? styles.debugBtnDisabled : null]}
          disabled={busy}
        >
          <Text style={styles.buyBtnText}>24h de Serenite - 500Z</Text>
        </Pressable>
        <Pressable
          onPress={() => void onBuyBoost()}
          style={[styles.buyBtn, busy ? styles.debugBtnDisabled : null]}
          disabled={busy}
        >
          <Text style={styles.buyBtnText}>Boost Intelligence (+5 IA) - 300Z</Text>
        </Pressable>
      </View>

      {dailyQuest ? (
        <View style={styles.questCard}>
          <Text style={styles.questTitle}>Quete du Jour - {dailyQuest.title}</Text>
          <Text style={styles.questDesc}>{dailyQuest.description}</Text>
          <Text style={styles.questProgress}>
            Progression: {Math.min(questProgress, questTarget)}/{questTarget}
          </Text>
          {questClaimed ? (
            <Text style={styles.questClaimed}>Bonus deja reclame</Text>
          ) : (
            <Pressable
              onPress={() => void onClaimQuest()}
              disabled={!questCanClaim || busy}
              style={[styles.questClaimBtn, (!questCanClaim || busy) ? styles.debugBtnDisabled : null]}
            >
              <Text style={styles.questClaimText}>Reclamer mon bonus</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {__DEV__ ? (
        <View style={styles.debugRow}>
          <Pressable
            onPress={() => void onDebugAddPoints()}
            style={[styles.debugBtn, busy ? styles.debugBtnDisabled : null]}
            disabled={busy}
          >
            <Text style={styles.debugBtnText}>+10 Zen</Text>
          </Pressable>
          <Pressable
            onPress={() => void onDebugAddCredits()}
            style={[styles.debugBtn, busy ? styles.debugBtnDisabled : null]}
            disabled={busy}
          >
            <Text style={styles.debugBtnText}>+1 Credit IA</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.footerHint}>{STRINGS.GARDEN_RITUALS.NO_PENDING_ITEMS}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f0',
    paddingHorizontal: 16,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '800',
    color: '#2d6f70',
  },
  zenModeBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '700',
    color: '#0f766e',
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.28)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  card: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.16)',
    padding: 14,
  },
  cardLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  cardValue: {
    marginTop: 6,
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  shopCard: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: '#eef6f6',
    borderWidth: 1,
    borderColor: 'rgba(0,128,128,0.2)',
    padding: 14,
  },
  shopTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f766e',
  },
  shopText: {
    marginTop: 6,
    fontSize: 13,
    color: '#334155',
  },
  buyBtn: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#008080',
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  buyBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  questCard: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.16)',
    padding: 12,
  },
  questTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2d6f70',
  },
  questDesc: {
    marginTop: 4,
    fontSize: 12,
    color: '#334155',
  },
  questProgress: {
    marginTop: 6,
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '700',
  },
  questClaimBtn: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#0f766e',
    paddingVertical: 8,
    alignItems: 'center',
  },
  questClaimText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 12,
  },
  questClaimed: {
    marginTop: 8,
    color: '#0f766e',
    fontWeight: '700',
    fontSize: 12,
  },
  debugRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  debugBtn: {
    borderRadius: 10,
    backgroundColor: '#008080',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  debugBtnDisabled: { opacity: 0.6 },
  debugBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  footerHint: {
    marginTop: 14,
    fontSize: 12,
    color: '#64748b',
  },
});
