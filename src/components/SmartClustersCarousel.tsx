import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import { useDesignTokens } from '../hooks/useDesignTokens';
import { neumorphicRaised } from '../theme/neumorphism';

export const SMART_CLUSTER_TILE_W = 148;
export const SMART_CLUSTER_TILE_H = 92;

type Props = {
  newCount: number;
  shopCount: number;
  cluster: { categoryId: string; count: number } | null;
  projectsCount: number;
  listsCount: number;
  onPressNew: () => void;
  onPressShop: () => void;
  onPressCluster: () => void;
  onPressProjects: () => void;
  onPressLists: () => void;
};

type TileProps = {
  title: string;
  subtitle?: string;
  badge?: number;
  onPress: () => void;
};

function ClusterTile({ title, subtitle, badge, onPress }: TileProps) {
  const theme = useTheme();
  const designTokens = useDesignTokens();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        neumorphicRaised(theme),
        styles.tile,
        {
          width: SMART_CLUSTER_TILE_W,
          height: SMART_CLUSTER_TILE_H,
          backgroundColor: designTokens.cardBackground,
          borderColor: theme.colors.outlineVariant,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: designTokens.textPrimary }]} numberOfLines={2}>
          {title}
        </Text>
        {badge != null && badge > 0 ? (
          <View style={[styles.badge, { backgroundColor: designTokens.accentColor }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: designTokens.textSecondary }]} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : (
        <View style={styles.subtitleSpacer} />
      )}
    </Pressable>
  );
}

/** Carrousel horizontal « Smart Clusters » (Tableau de bord tactique Timeline). */
export function SmartClustersCarousel({
  newCount,
  shopCount,
  cluster,
  projectsCount,
  listsCount,
  onPressNew,
  onPressShop,
  onPressCluster,
  onPressProjects,
  onPressLists,
}: Props) {
  const { t, i18n } = useTranslation();

  const clusterCategoryLabel =
    cluster && i18n.exists(`category.${cluster.categoryId}`)
      ? t(`category.${cluster.categoryId}`)
      : cluster?.categoryId ?? '';

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}
    >
      {newCount > 0 ? (
        <ClusterTile
          title={t('timeline.smartClusters.newTitle')}
          subtitle={t('timeline.smartClusters.newSubtitle', { count: newCount })}
          badge={newCount}
          onPress={onPressNew}
        />
      ) : null}
      {shopCount > 0 ? (
        <ClusterTile
          title={t('timeline.ideaBank.shopTitle')}
          subtitle={t('timeline.ideaBank.shopSubtitle', { count: shopCount })}
          onPress={onPressShop}
        />
      ) : null}
      {cluster && cluster.count >= 2 ? (
        <ClusterTile
          title={t('timeline.ideaBank.clusterNudge')}
          subtitle={t('timeline.ideaBank.clusterSubtitle', {
            count: cluster.count,
            category: clusterCategoryLabel,
          })}
          onPress={onPressCluster}
        />
      ) : null}
      <ClusterTile
        title={t('timeline.smartClusters.projectsTitle')}
        subtitle={
          projectsCount > 0
            ? t('timeline.smartClusters.projectsSubtitle', { count: projectsCount })
            : undefined
        }
        onPress={onPressProjects}
      />
      <ClusterTile
        title={t('timeline.smartClusters.listsTitle')}
        subtitle={
          listsCount > 0 ? t('timeline.smartClusters.listsSubtitle', { count: listsCount }) : undefined
        }
        onPress={onPressLists}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  tile: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: '800', lineHeight: 18 },
  subtitle: { fontSize: 12, fontWeight: '600', marginTop: 4, opacity: 0.92 },
  subtitleSpacer: { minHeight: 16 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '900', color: '#FFFFFF' },
});
