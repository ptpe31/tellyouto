import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NeumorphicSurface } from '../components';
import { usePower } from '../context/PowerContext';
import {
  isAdFreeModeActive,
  useUserSpectrum,
} from '../context/UserSpectrumContext';
import { palette } from '../theme/colors';
import { neumorphicRaised } from '../theme/neumorphism';

export type RechargeMode = 'flash' | 'breath' | 'immersion';

const MODE_REWARD: Record<
  RechargeMode,
  { scoreBoost: number; agentSeconds: number }
> = {
  flash: { scoreBoost: 0.06, agentSeconds: 90 },
  breath: { scoreBoost: 0.1, agentSeconds: 150 },
  immersion: { scoreBoost: 0.14, agentSeconds: 240 },
};

const AD_SIM_MS = 1800;
const PAUSE_MS = 30_000;
const BREATH_PERIOD_MS = 10_000;

type Flow = 'idle' | 'ad' | 'pause' | 'done';

export function RechargeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { spectrum } = useUserSpectrum();
  const { boostEnergyScore, addAgentEnergySeconds } = usePower();
  const adFree = isAdFreeModeActive(spectrum);

  const [flow, setFlow] = useState<Flow>('idle');
  const [selectedMode, setSelectedMode] = useState<RechargeMode | null>(null);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const pulseFlash = useRef(new Animated.Value(1)).current;
  const pulseBreath = useRef(new Animated.Value(1)).current;
  const pulseImmerse = useRef(new Animated.Value(1)).current;

  const runPulse = useCallback(
    (anim: Animated.Value) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1.035,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 1,
            duration: 2200,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    },
    [],
  );

  useEffect(() => {
    runPulse(pulseFlash);
    runPulse(pulseBreath);
    runPulse(pulseImmerse);
  }, [pulseFlash, pulseBreath, pulseImmerse, runPulse]);

  const startSequence = (mode: RechargeMode) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedMode(mode);
    if (adFree) {
      setFlow('pause');
      setPauseElapsed(0);
      return;
    }
    setFlow('ad');
    setTimeout(() => {
      setFlow('pause');
      setPauseElapsed(0);
    }, AD_SIM_MS);
  };

  useEffect(() => {
    if (flow !== 'pause' || !selectedMode) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - t0;
      setPauseElapsed(e);
      if (e >= PAUSE_MS) {
        clearInterval(id);
        const r = MODE_REWARD[selectedMode];
        boostEnergyScore(r.scoreBoost);
        addAgentEnergySeconds(r.agentSeconds);
        setFlow('done');
      }
    }, 80);
    return () => clearInterval(id);
  }, [flow, selectedMode, boostEnergyScore, addAgentEnergySeconds]);

  const bubbleOffset =
    Math.sin((pauseElapsed / BREATH_PERIOD_MS) * Math.PI * 2) * 56;

  const closeDone = () => {
    setFlow('idle');
    setSelectedMode(null);
    setPauseElapsed(0);
  };

  const { width: wWidth } = Dimensions.get('window');

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={[styles.heroEyebrow, { color: theme.colors.primary }]}>
            {t('recharge.eyebrow')}
          </Text>
          <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
            {t('recharge.title')}
          </Text>
          <Text
            style={[styles.heroSub, { color: theme.colors.onSurfaceVariant }]}
          >
            {t('recharge.subtitle')}
          </Text>
        </View>

        <View style={styles.grid}>
          <Animated.View style={{ transform: [{ scale: pulseFlash }] }}>
            <Pressable
              onPress={() => startSequence('flash')}
              disabled={flow !== 'idle'}
              style={({ pressed }) => [{ opacity: pressed ? 0.94 : flow === 'idle' ? 1 : 0.55 }]}
            >
              <View style={[styles.cardWrap, neumorphicRaised(theme)]}>
                <Text style={[styles.modeTitle, { color: theme.colors.onSurface }]}>
                  {t('recharge.modes.flash.title')}
                </Text>
                <Text
                  style={[styles.modeDesc, { color: theme.colors.onSurfaceVariant }]}
                >
                  {t('recharge.modes.flash.desc')}
                </Text>
              </View>
            </Pressable>
          </Animated.View>

          <Animated.View style={{ transform: [{ scale: pulseBreath }] }}>
            <Pressable
              onPress={() => startSequence('breath')}
              disabled={flow !== 'idle'}
              style={({ pressed }) => [{ opacity: pressed ? 0.94 : flow === 'idle' ? 1 : 0.55 }]}
            >
              <View style={[styles.cardWrap, neumorphicRaised(theme)]}>
                <Text style={[styles.modeTitle, { color: theme.colors.onSurface }]}>
                  {t('recharge.modes.breath.title')}
                </Text>
                <Text
                  style={[styles.modeDesc, { color: theme.colors.onSurfaceVariant }]}
                >
                  {t('recharge.modes.breath.desc')}
                </Text>
              </View>
            </Pressable>
          </Animated.View>

          <Animated.View style={{ transform: [{ scale: pulseImmerse }] }}>
            <Pressable
              onPress={() => startSequence('immersion')}
              disabled={flow !== 'idle'}
              style={({ pressed }) => [{ opacity: pressed ? 0.94 : flow === 'idle' ? 1 : 0.55 }]}
            >
              <View style={[styles.cardWrap, neumorphicRaised(theme)]}>
                <Text style={[styles.modeTitle, { color: theme.colors.onSurface }]}>
                  {t('recharge.modes.immersion.title')}
                </Text>
                <Text
                  style={[styles.modeDesc, { color: theme.colors.onSurfaceVariant }]}
                >
                  {t('recharge.modes.immersion.desc')}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        </View>
      </ScrollView>

      <Modal visible={flow === 'ad'} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <NeumorphicSurface style={styles.adCard}>
            <ActivityIndicator color={palette.teal} size="large" />
            <Text style={[styles.adTitle, { color: palette.textOnLight }]}>
              {t('recharge.adSim.title')}
            </Text>
            <Text style={[styles.adSub, { color: palette.outline }]}>
              {t('recharge.adSim.sub')}
            </Text>
          </NeumorphicSurface>
        </View>
      </Modal>

      <Modal visible={flow === 'pause'} transparent animationType="slide">
        <View style={[styles.pauseRoot, { paddingTop: insets.top }]}>
          <View style={[styles.pausePanel, { width: Math.min(wWidth - 32, 400) }]}>
            <Text style={[styles.pauseTitle, { color: palette.textOnLight }]}>
              {t('recharge.dopamine.title')}
            </Text>
            <Text style={[styles.pauseHint, { color: palette.tealDark }]}>
              {t('recharge.dopamine.hint')}
            </Text>

            <View style={styles.bubbleTrack}>
              <View
                style={[
                  styles.bubble,
                  {
                    transform: [{ translateY: bubbleOffset }],
                    backgroundColor: palette.teal,
                    shadowColor: palette.teal,
                  },
                ]}
              />
            </View>

            <Text style={[styles.timer, { color: palette.textOnLight }]}>
              {Math.max(0, Math.ceil((PAUSE_MS - pauseElapsed) / 1000))} s
            </Text>
          </View>
        </View>
      </Modal>

      <Modal visible={flow === 'done'} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <NeumorphicSurface style={styles.adCard}>
            <Text style={[styles.doneTitle, { color: palette.textOnLight }]}>
              {t('recharge.done.title')}
            </Text>
            <Text style={[styles.doneSub, { color: palette.outline }]}>
              {t('recharge.done.sub')}
            </Text>
            <Pressable
              onPress={closeDone}
              style={[styles.doneBtn, { backgroundColor: palette.teal }]}
            >
              <Text style={styles.doneBtnText}>{t('recharge.done.cta')}</Text>
            </Pressable>
          </NeumorphicSurface>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 40 },
  hero: { paddingHorizontal: 22, paddingTop: 8, marginBottom: 20 },
  heroEyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: '700', lineHeight: 34 },
  heroSub: { marginTop: 10, fontSize: 16, lineHeight: 24 },
  grid: { paddingHorizontal: 18, gap: 18 },
  cardWrap: {
    borderRadius: 20,
    padding: 20,
    minHeight: 120,
    justifyContent: 'center',
  },
  modeTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  modeDesc: { fontSize: 14, lineHeight: 20 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(28,36,36,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  adCard: { padding: 28, alignItems: 'center', maxWidth: 320, width: '100%' },
  adTitle: { marginTop: 16, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  adSub: { marginTop: 8, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  pauseRoot: {
    flex: 1,
    backgroundColor: palette.offWhite,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pausePanel: { alignItems: 'center', paddingHorizontal: 12 },
  pauseTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  pauseHint: { marginTop: 10, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  bubbleTrack: {
    marginTop: 36,
    height: 220,
    width: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bubble: {
    width: 88,
    height: 88,
    borderRadius: 44,
    opacity: 0.92,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  timer: { marginTop: 28, fontSize: 20, fontVariant: ['tabular-nums'] },
  doneTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  doneSub: { marginTop: 10, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  doneBtn: {
    marginTop: 22,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 16,
    alignSelf: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
