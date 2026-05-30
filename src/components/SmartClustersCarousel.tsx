import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import { useDesignTokens } from '../hooks/useDesignTokens';
import { neumorphicRaised } from '../theme/neumorphism';
import { logSmartClusterTilePress, type SmartClusterDebugEntry } from '../utils/clusterDebugLog';

export const SMART_CLUSTER_TILE_W = 148;
export const SMART_CLUSTER_TILE_H = 92;

export type SmartClusterDebugContents = {
  inbox: SmartClusterDebugEntry[];
  shop: SmartClusterDebugEntry[];
  box: SmartClusterDebugEntry[];
  routines: SmartClusterDebugEntry[];
  projects: SmartClusterDebugEntry[];
};

type Props = {
  inboxCount: number;
  shopCount: number;
  boxCount: number;
  routinesCount: number;
  projectsCount: number;
  onPressInbox: () => void;
  onPressShop: () => void;
  onPressBox: () => void;
  onPressRoutines: () => void;
  onPressProjects: () => void;
  debugContents?: SmartClusterDebugContents;
};

type TileProps = {
  title: string;
  subtitle?: string;
  badge?: number;
  onPress: () => void;
  tileBackground?: string;
  useCarouselText?: boolean;
};

function pressWithClusterDebug(clusterLabel: string, items: SmartClusterDebugEntry[], onPress: () => void): () => void {
  return () => {
    logSmartClusterTilePress(clusterLabel, items);
    onPress();
  };
}

function ClusterTile({ title, subtitle, badge, onPress, tileBackground, useCarouselText }: TileProps) {
  const theme = useTheme();
  const designTokens = useDesignTokens();
  const titleColor = useCarouselText ? designTokens.carouselTileTextPrimary : designTokens.textPrimary;
  const subtitleColor = useCarouselText ? designTokens.carouselTileTextSecondary : designTokens.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        neumorphicRaised(theme),
        styles.tile,
        {
          width: SMART_CLUSTER_TILE_W,
          height: SMART_CLUSTER_TILE_H,
          backgroundColor: tileBackground ?? designTokens.cardBackground,
          borderColor: theme.colors.outlineVariant,
        },
        pressed && {
          opacity: designTokens.pressedOpacity,
          transform: [{ scale: designTokens.pressedScale }],
        },
      ]}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: titleColor }]} numberOfLines={2}>
          {title}
        </Text>
        {badge != null && badge > 0 ? (
          <View style={[styles.badge, { backgroundColor: designTokens.accentColor }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: subtitleColor }]} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : (
        <View style={styles.subtitleSpacer} />
      )}
    </Pressable>
  );
}

/** Carrousel horizontal « Smart Clusters » (Inbox · Shop · Box · Routines · Projets). */
export function SmartClustersCarousel({
  inboxCount,
  shopCount,
  boxCount,
  routinesCount,
  projectsCount,
  onPressInbox,
  onPressShop,
  onPressBox,
  onPressRoutines,
  onPressProjects,
  debugContents,
}: Props) {
  const { t } = useTranslation();
  const designTokens = useDesignTokens();
  const debug = debugContents ?? { inbox: [], shop: [], box: [], routines: [], projects: [] };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}
    >
      {inboxCount > 0 ? (
        <ClusterTile
          title={t('timeline.smartClusters.inbox')}
          subtitle={t('timeline.smartClusters.inboxSubtitle', { count: inboxCount })}
          badge={inboxCount}
          tileBackground={designTokens.carouselInboxBg}
          useCarouselText
          onPress={pressWithClusterDebug('Inbox', debug.inbox, onPressInbox)}
        />
      ) : null}
      {shopCount > 0 ? (
        <ClusterTile
          title={t('timeline.ideaBank.shopTitle')}
          subtitle={t('timeline.ideaBank.shopSubtitle', { count: shopCount })}
          tileBackground={designTokens.carouselShopBg}
          useCarouselText
          onPress={pressWithClusterDebug('À acheter', debug.shop, onPressShop)}
        />
      ) : null}
      <ClusterTile
        title="Box"
        subtitle={boxCount > 0 ? `${boxCount} idées` : undefined}
        badge={boxCount > 0 ? boxCount : undefined}
        tileBackground={designTokens.carouselBoxBg}
        useCarouselText
        onPress={pressWithClusterDebug('Box', debug.box, onPressBox)}
      />
      <ClusterTile
        title={t('timeline.smartClusters.routinesTitle')}
        subtitle={
          routinesCount > 0
            ? t('timeline.smartClusters.routinesSubtitle', { count: routinesCount })
            : undefined
        }
        badge={routinesCount > 0 ? routinesCount : undefined}
        tileBackground={designTokens.carouselRoutinesBg}
        useCarouselText
        onPress={pressWithClusterDebug('Routines', debug.routines, onPressRoutines)}
      />
      <ClusterTile
        title={t('timeline.smartClusters.projectsTitle')}
        subtitle={
          projectsCount > 0
            ? t('timeline.smartClusters.projectsSubtitle', { count: projectsCount })
            : undefined
        }
        onPress={pressWithClusterDebug('Projets', debug.projects, onPressProjects)}
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
