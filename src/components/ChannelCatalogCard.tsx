import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import { NeumorphicSurface } from './NeumorphicSurface';
import { neumorphicRaised } from '../theme/neumorphism';

const GOLD = '#C9A227';
const GOLD_TEXT = '#1a1408';
const TEAL_ACTIVE = '#00897B';
const LED_GREEN = '#43A047';

export type ChannelConnectionStatus = 'disconnected' | 'linking' | 'connected';

type Props = {
  title: string;
  freeBadgeLabel?: string;
  recommendedBadgeLabel?: string;
  proBadgeLabel: string;
  isPremiumChannel: boolean;
  showProLock: boolean;
  connectionStatus: ChannelConnectionStatus;
  connectLabel: string;
  disconnectLabel: string;
  linkingLabel: string;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Slack / Teams uniquement — texte minimal en bas de carte */
  footerHint?: string;
};

export function ChannelCatalogCard({
  title,
  freeBadgeLabel,
  recommendedBadgeLabel,
  proBadgeLabel,
  isPremiumChannel,
  showProLock,
  connectionStatus,
  connectLabel,
  disconnectLabel,
  linkingLabel,
  onConnect,
  onDisconnect,
  footerHint,
}: Props) {
  const theme = useTheme();
  const raised = neumorphicRaised(theme);

  const isActive =
    connectionStatus === 'connected' || connectionStatus === 'linking';

  const shellStyle = [
    raised,
    styles.card,
    {
      borderWidth: isActive ? 2 : 1,
      borderColor: isActive ? TEAL_ACTIVE : theme.colors.outline,
      ...(connectionStatus === 'linking'
        ? { borderStyle: 'dashed' as const }
        : {}),
    },
  ];

  const body = (
    <>
      <View style={styles.headRow}>
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]}>
              {title}
            </Text>
            {connectionStatus === 'connected' ? (
              <View
                style={[styles.led, { backgroundColor: LED_GREEN }]}
                accessibilityLabel="active-channel"
              />
            ) : null}
          </View>
        </View>
        <View style={styles.rightBadges}>
          {isPremiumChannel ? (
            <>
              <View style={[styles.proGold, { borderColor: GOLD }]}>
                <Text style={[styles.proGoldText, { color: GOLD_TEXT }]}>
                  {proBadgeLabel}
                </Text>
              </View>
              {showProLock ? (
                <NeumorphicSurface style={styles.lockChip}>
                  <Text style={styles.lockEmoji}>🔒</Text>
                </NeumorphicSurface>
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      {freeBadgeLabel || recommendedBadgeLabel ? (
        <View style={styles.pillRow}>
          {freeBadgeLabel ? (
            <View
              style={[
                styles.pill,
                { backgroundColor: theme.colors.secondaryContainer },
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: theme.colors.onSecondaryContainer },
                ]}
              >
                {freeBadgeLabel}
              </Text>
            </View>
          ) : null}
          {recommendedBadgeLabel ? (
            <View style={[styles.pill, { backgroundColor: TEAL_ACTIVE }]}>
              <Text style={[styles.pillText, { color: '#fff' }]}>
                {recommendedBadgeLabel}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {connectionStatus === 'linking' ? (
        <View style={styles.linkingRow}>
          <Text
            style={[
              styles.linkingText,
              { color: theme.colors.onSurfaceVariant, opacity: 0.65 },
            ]}
          >
            {linkingLabel}
          </Text>
        </View>
      ) : null}

      {connectionStatus === 'disconnected' && !showProLock ? (
        <Pressable
          onPress={onConnect}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.connectBtn,
            {
              backgroundColor: theme.colors.primaryContainer,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text
            style={[styles.actionBtnText, { color: theme.colors.onPrimaryContainer }]}
          >
            {connectLabel}
          </Text>
        </Pressable>
      ) : null}

      {connectionStatus === 'connected' ? (
        <Pressable
          onPress={onDisconnect}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.disconnectBtn,
            {
              backgroundColor: theme.dark ? 'rgba(255,80,80,0.12)' : 'rgba(183,28,28,0.08)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.actionBtnText, { color: theme.colors.error }]}>
            {disconnectLabel}
          </Text>
        </Pressable>
      ) : null}

      {footerHint ? (
        <Text style={[styles.footerHint, { color: theme.colors.outline }]}>
          {footerHint}
        </Text>
      ) : null}
    </>
  );

  if (connectionStatus === 'disconnected' && showProLock) {
    return (
      <Pressable
        onPress={onConnect}
        style={({ pressed }) => [
          shellStyle,
          { opacity: pressed ? 0.92 : 1, marginBottom: 12 },
        ]}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={shellStyle}>{body}</View>;
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  led: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  proGold: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(201, 162, 39, 0.22)',
  },
  proGoldText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  lockChip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 10,
  },
  lockEmoji: { fontSize: 14 },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, fontWeight: '700' },
  linkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  linkingText: { fontSize: 13, flex: 1 },
  actionBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  connectBtn: {},
  disconnectBtn: {},
  actionBtnText: { fontSize: 14, fontWeight: '700' },
  footerHint: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 10,
  },
});
