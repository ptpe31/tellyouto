import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Dialog, Portal, useTheme } from 'react-native-paper';

import { syncPendingIntentions } from '../api/syncService';
import {
  getIntentionById,
  markIntentionActive,
  updateIntentionAfterFocus,
} from '../api/localDb';
import { useLanguage } from '../context/LanguageContext';
import { useFocusProtection } from '../context/FocusProtectionContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import type { MainStackParamList } from '../navigation/types';
import { generateEncouragement } from '../services/agentLogic';
import { simulatedSetNotificationSuppression } from '../services/focusProtection';
import { neumorphicRaised } from '../theme/neumorphism';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = NativeStackScreenProps<MainStackParamList, 'FocusCapsule'>;

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const RING_SIZE = 220;
const STROKE = 10;
const R = (RING_SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const CX = RING_SIZE / 2;
const CY = RING_SIZE / 2;

export function FocusCapsuleScreen({ route, navigation }: Props) {
  const { intentionId } = route.params;
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const { spectrum } = useUserSpectrum();
  const { setProtectionActive } = useFocusProtection();

  const [title, setTitle] = useState('');
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [encouragement, setEncouragement] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  const finalizedRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;

  const weights = useMemo(
    () => ({
      structure: spectrum.structure,
      momentum: spectrum.momentum,
      zen: spectrum.zen,
      stats: spectrum.stats,
    }),
    [spectrum],
  );

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const row = await getIntentionById(intentionId);
      if (cancelled) return;
      if (!row) {
        setLoading(false);
        navigation.goBack();
        return;
      }
      setTitle(row.title);
      const sec = Math.max(60, row.estimated_duration * 60);
      setTotalSeconds(sec);
      setRemaining(sec);
      await markIntentionActive(row.id);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [intentionId, navigation]);

  useEffect(() => {
    setProtectionActive(true);
    simulatedSetNotificationSuppression(true);
    return () => {
      setProtectionActive(false);
      simulatedSetNotificationSuppression(false);
    };
  }, [setProtectionActive]);

  useEffect(() => {
    if (loading || paused || remaining <= 0 || sessionEnded) return;
    const id = setInterval(() => {
      setRemaining((r) => (r <= 1 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [loading, paused, remaining, sessionEnded]);

  const progress = totalSeconds > 0 ? remaining / totalSeconds : 0;
  const strokeDashoffset = CIRC * (1 - progress);

  const finalizeSession = useCallback(async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    setSessionEnded(true);

    const row = await getIntentionById(intentionId);
    if (!row) {
      navigation.goBack();
      return;
    }

    const elapsedSec = totalSeconds - remaining;
    const actualMin = Math.max(1, Math.round(elapsedSec / 60));

    await updateIntentionAfterFocus({
      id: row.id,
      actual_duration: actualMin,
      status: 'done',
    });

    const msg = generateEncouragement(weights, language);
    setEncouragement(msg);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDialogOpen(true);
    void syncPendingIntentions();
  }, [
    intentionId,
    language,
    navigation,
    remaining,
    totalSeconds,
    weights,
  ]);

  useEffect(() => {
    if (loading || remaining > 0 || finalizedRef.current) return;
    void finalizeSession();
  }, [remaining, loading, finalizeSession]);

  const onPauseToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPaused((p) => !p);
  };

  const onFinishPress = () => {
    void finalizeSession();
  };

  const closeFlow = () => {
    setDialogOpen(false);
    navigation.goBack();
  };

  if (loading) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: theme.colors.background, paddingTop: insets.top },
        ]}
      />
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <Animated.View
        style={[
          styles.content,
          { opacity, paddingTop: insets.top + 24 },
        ]}
      >
        <Text
          style={[styles.intentionTitle, { color: theme.colors.onBackground }]}
          numberOfLines={3}
        >
          {title}
        </Text>

        <View style={[styles.ringShell, neumorphicRaised(theme)]}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <G transform={`rotate(-90 ${CX} ${CY})`}>
              <Circle
                cx={CX}
                cy={CY}
                r={R}
                stroke={theme.colors.surfaceVariant}
                strokeWidth={STROKE}
                fill="none"
              />
              <Circle
                cx={CX}
                cy={CY}
                r={R}
                stroke={theme.colors.primary}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={CIRC}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </G>
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={[styles.timer, { color: theme.colors.onSurface }]}>
              {formatMmSs(remaining)}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onPauseToggle}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: theme.colors.surface,
                opacity: pressed ? 0.9 : 1,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
          >
            <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>
              {paused ? t('focus.resume') : t('focus.pause')}
            </Text>
          </Pressable>
          <Pressable
            onPress={onFinishPress}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: theme.colors.secondary,
                opacity: pressed ? 0.92 : 1,
              },
            ]}
          >
            <Text style={{ color: theme.colors.onSecondary, fontWeight: '600' }}>
              {t('focus.finish')}
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      <Portal>
        <Dialog
          visible={dialogOpen}
          onDismiss={closeFlow}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title>{t('focus.feedbackTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.onSurface }}>
              {encouragement}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeFlow}>{t('focus.ok')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1 },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  intentionTitle: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 28,
  },
  ringShell: {
    width: RING_SIZE + 28,
    height: RING_SIZE + 28,
    borderRadius: (RING_SIZE + 28) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: { fontSize: 36, fontVariant: ['tabular-nums'] },
  actions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 36,
  },
  btn: {
    minWidth: 120,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
});
