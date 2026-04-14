import { BlurView } from 'expo-blur';
import * as Battery from 'expo-battery';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useTranslation } from 'react-i18next';

import { LifeFlower } from './LifeFlower';
import {
  applyTomorrowPlanningBonus,
  completeEveningRitual,
  grantChargingStarMaxBonus,
  getEveningRitualPayload,
  saveNightThought,
  shouldTriggerEveningRitual,
} from '../services/EveningRitual';
import { getTrankilV2UserStats } from '../api/trankilV2Db';
import { useSaturation } from '../context/SaturationContext';
import { notifyChargingEveningPrompt } from '../services/notifications';
import { STRINGS } from '../constants/Strings';

export function EveningStarModal() {
  const { t } = useTranslation();
  const { animationMultiplier, runWithWeight } = useSaturation();
  const [visible, setVisible] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [victoryTitle, setVictoryTitle] = useState<string | null>(null);
  const [planningText, setPlanningText] = useState('');
  const [nightThought, setNightThought] = useState('');
  const [chargingEntry, setChargingEntry] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [growth, setGrowth] = useState(0);
  const stars = useRef(Array.from({ length: 24 }, () => new Animated.Value(0.2))).current;

  useEffect(() => {
    void (async () => {
      const stats = await getTrankilV2UserStats();
      setGrowth(stats.growth_score);
      const batteryState = await Battery.getBatteryStateAsync();
      const isCharging =
        batteryState === Battery.BatteryState.CHARGING ||
        batteryState === Battery.BatteryState.FULL;
      const should = await shouldTriggerEveningRitual(new Date(), isCharging);
      if (!should) return;
      const payload = await getEveningRitualPayload();
      setDoneCount(payload.doneCount);
      setVictoryTitle(payload.victoryTitle);
      setChargingEntry(isCharging);
      setVisible(true);
    })();
  }, []);

  useEffect(() => {
    const sub = Battery.addBatteryStateListener(async ({ batteryState }) => {
      if (visible) return;
      const isCharging =
        batteryState === Battery.BatteryState.CHARGING ||
        batteryState === Battery.BatteryState.FULL;
      if (!isCharging) return;
      const should = await shouldTriggerEveningRitual(new Date(), true);
      if (!should) return;
      const payload = await getEveningRitualPayload();
      void notifyChargingEveningPrompt(STRINGS.rituals.chargingPrompt);
      setDoneCount(payload.doneCount);
      setVictoryTitle(payload.victoryTitle);
      setChargingEntry(true);
      setVisible(true);
    });
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('DEBUG_FORCE_EVENING', () => {
      void (async () => {
        const payload = await getEveningRitualPayload();
        setDoneCount(payload.doneCount);
        setVictoryTitle(payload.victoryTitle);
        setChargingEntry(true);
        setVisible(true);
      })();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const loops = stars.slice(0, Math.min(doneCount, stars.length)).map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 90),
          Animated.timing(v, { toValue: 1, duration: Math.round(480 * animationMultiplier), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: Math.round(780 * animationMultiplier), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [visible, doneCount, stars]);

  const gratitude = useMemo(() => {
    const choices = [
      t('eveningRitual.gratitudeLine1'),
      t('eveningRitual.gratitudeLine2'),
      t('eveningRitual.gratitudeLine3'),
    ];
    const idx = Math.floor(Math.random() * choices.length);
    return choices[idx];
  }, [t, visible]);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    if (text.trim()) {
      setNightThought(text.trim());
    }
  });

  const closeRitual = async () => {
    setLoading(true);
    try {
      if (nightThought.trim()) {
        await saveNightThought(nightThought);
      }
      if (planningText.trim()) {
        await applyTomorrowPlanningBonus(planningText);
      }
      if (chargingEntry) {
        await grantChargingStarMaxBonus();
      }
      await completeEveningRitual();
      setVisible(false);
    } finally {
      setLoading(false);
    }
  };

  const toggleNightVoice = useCallback(async () => {
    if (isListening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        /* ignore */
      }
      setIsListening(false);
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return;
    ExpoSpeechRecognitionModule.start({
      lang: 'fr-FR',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      iosTaskHint: 'dictation',
      iosVoiceProcessingEnabled: true,
    });
    setIsListening(true);
  }, [isListening]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <BlurView intensity={52} tint="dark" style={styles.overlay}>
        <View style={[styles.sky, chargingEntry ? styles.deepSleepSky : null]}>
          {stars.slice(0, Math.min(doneCount, stars.length)).map((s, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.star,
                {
                  left: `${6 + (i * 11) % 88}%`,
                  top: `${10 + (i * 7) % 28}%`,
                  opacity: s,
                },
              ]}
            >
              ✨
            </Animated.Text>
          ))}
          <Text style={styles.moon}>🌙</Text>
          <LifeFlower growthStage={growth} size={94} nightMode={chargingEntry} />
          <Text style={styles.title}>{t('eveningRitual.title')}</Text>
          {chargingEntry ? <Text style={styles.message}>{STRINGS.rituals.chargingPrompt}</Text> : null}
          <Text style={styles.message}>
            {t('eveningRitual.summary', { count: doneCount })}
          </Text>
          <Text style={styles.poetic}>{gratitude}</Text>
          {victoryTitle ? (
            <Text style={styles.victory}>
              {t('eveningRitual.victoryLabel')}: {victoryTitle}
            </Text>
          ) : null}

          <TextInput
            value={nightThought}
            onChangeText={setNightThought}
            placeholder={STRINGS.rituals.nightThoughtPlaceholder}
            placeholderTextColor="rgba(241,245,249,0.62)"
            style={styles.input}
          />
          <Pressable style={styles.voiceBtn} onPress={() => void toggleNightVoice()}>
            <Text style={styles.voiceBtnText}>
              {isListening ? 'Ecoute en cours...' : STRINGS.rituals.nightThoughtVoice}
            </Text>
          </Pressable>
          <TextInput
            value={planningText}
            onChangeText={setPlanningText}
            placeholder={t('eveningRitual.tomorrowPlaceholder')}
            placeholderTextColor="rgba(241,245,249,0.62)"
            style={styles.input}
          />
          <Pressable
            style={styles.cta}
            onPress={() => runWithWeight(() => void closeRitual())}
            disabled={loading}
          >
            <Text style={styles.ctaText}>
              {loading ? t('eveningRitual.saving') : t('eveningRitual.cta')}
            </Text>
          </Pressable>
          <Text style={styles.bonusHint}>{t('eveningRitual.bonusHint')}</Text>
          {chargingEntry ? <Text style={styles.bonusHint}>{STRINGS.rituals.starBonusMax}</Text> : null}
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sky: {
    width: '92%',
    borderRadius: 24,
    backgroundColor: 'rgba(15,23,42,0.74)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    padding: 16,
    alignItems: 'center',
    overflow: 'hidden',
  },
  deepSleepSky: {
    backgroundColor: '#030712',
    borderColor: 'rgba(30,58,138,0.42)',
  },
  star: { position: 'absolute', fontSize: 12, color: '#fde68a' },
  moon: { position: 'absolute', right: 14, top: 10, fontSize: 24 },
  title: { marginTop: 8, fontSize: 24, fontWeight: '800', color: '#e2e8f0' },
  message: { marginTop: 10, fontSize: 16, color: '#e2e8f0', textAlign: 'center', lineHeight: 22 },
  poetic: { marginTop: 8, fontSize: 14, color: '#cbd5e1', textAlign: 'center', fontStyle: 'italic' },
  victory: { marginTop: 8, fontSize: 13, color: '#f8fafc', textAlign: 'center', fontWeight: '700' },
  input: {
    marginTop: 14,
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.42)',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: 'rgba(30,41,59,0.55)',
  },
  cta: {
    marginTop: 10,
    width: '100%',
    borderRadius: 12,
    backgroundColor: 'rgba(20,184,166,0.9)',
    alignItems: 'center',
    paddingVertical: 11,
  },
  ctaText: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  voiceBtn: {
    marginTop: 8,
    width: '100%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(147,197,253,0.44)',
    alignItems: 'center',
    paddingVertical: 9,
  },
  voiceBtnText: { color: '#bfdbfe', fontWeight: '700' },
  bonusHint: { marginTop: 8, color: '#cbd5e1', fontSize: 12, textAlign: 'center' },
});
