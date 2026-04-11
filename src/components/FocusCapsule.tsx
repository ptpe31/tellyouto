import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  Vibration,
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
import { palette } from '../theme/colors';
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

function vibrateChronoComplete(): void {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    Vibration.vibrate([0, 380, 140, 280]);
  } else {
    Vibration.vibrate();
  }
}

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
  const [paused, setPaused] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [encouragement, setEncouragement] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  const finalizedRef = useRef(false);
  const prevRemainingRef = useRef<number | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

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
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 780,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 780,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

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
      prevRemainingRef.current = sec;
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
    if (loading || paused || remaining <= 0 || sessionEnded || !hasStarted) return;
    const id = setInterval(() => {
      setRemaining((r) => (r <= 1 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [loading, paused, remaining, sessionEnded, hasStarted]);

  useEffect(() => {
    const prev = prevRemainingRef.current;
    if (
      prev !== null &&
      prev > 0 &&
      remaining === 0 &&
      hasStarted &&
      !sessionEnded &&
      !finalizedRef.current
    ) {
      vibrateChronoComplete();
    }
    prevRemainingRef.current = remaining;
  }, [remaining, hasStarted, sessionEnded]);

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
    const actualMin =
      elapsedSec <= 0 ? 0 : Math.max(1, Math.round(elapsedSec / 60));

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
    if (
      loading ||
      remaining > 0 ||
      finalizedRef.current ||
      !hasStarted
    ) {
      return;
    }
    void finalizeSession();
  }, [remaining, loading, finalizeSession, hasStarted]);

  const onStartOrPause = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (!hasStarted) {
      setHasStarted(true);
      setPaused(false);
      return;
    }
    setPaused((p) => !p);
  };

  const onTerminate = () => {
    if (!hasStarted) {
      navigation.goBack();
      return;
    }
    void finalizeSession();
  };

  const closeFlow = () => {
    setDialogOpen(false);
    navigation.goBack();
  };

  const primaryLabel = !hasStarted
    ? t('focus.start')
    : paused
      ? t('focus.resume')
      : t('focus.pause');

  if (loading) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: palette.offWhite, paddingTop: insets.top },
        ]}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.offWhite }]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity,
            transform: [{ translateY }],
            paddingTop: insets.top + 28,
          },
        ]}
      >
        <Text
          style={[styles.intentionTitle, { color: palette.textOnLight }]}
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
                stroke={palette.offWhiteDark}
                strokeWidth={STROKE}
                fill="none"
              />
              <Circle
                cx={CX}
                cy={CY}
                r={R}
                stroke={palette.teal}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={CIRC}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </G>
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={[styles.timer, { color: palette.textOnLight }]}>
              {formatMmSs(remaining)}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onStartOrPause}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: palette.surfaceLight,
                opacity: pressed ? 0.92 : 1,
                borderColor: palette.outline,
              },
            ]}
          >
            <Text style={{ color: palette.teal, fontWeight: '600' }}>
              {primaryLabel}
            </Text>
          </Pressable>
          <Pressable
            onPress={onTerminate}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: palette.orange,
                opacity: pressed ? 0.92 : 1,
                borderColor: 'transparent',
              },
            ]}
          >
            <Text style={{ color: '#1C1C1C', fontWeight: '600' }}>
              {t('focus.terminate')}
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      <Portal>
        <Dialog
          visible={dialogOpen}
          onDismiss={closeFlow}
          style={{ backgroundColor: palette.surfaceLight }}
        >
          <Dialog.Title>{t('focus.feedbackTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: palette.textOnLight }}>
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
    marginTop: 40,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  btn: {
    minWidth: 128,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
});
