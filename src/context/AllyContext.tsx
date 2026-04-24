import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { DeviceEventEmitter } from 'react-native';

import { DATABASE_RESET_COMPLETE_EVENT } from '../api/localDb';

const VOICE_KEY = '@tellyouto/ally_voice';
const TONE_KEY = '@tellyouto/ally_tone';

export type AllyVoice = 'balanced' | 'warm' | 'crisp';
export type AllyTone = 'clear' | 'calm' | 'dynamic';

type AllyContextValue = {
  voice: AllyVoice;
  tone: AllyTone;
  setVoice: (v: AllyVoice) => Promise<void>;
  setTone: (t: AllyTone) => Promise<void>;
};

const AllyContext = createContext<AllyContextValue | undefined>(undefined);

const VOICES: AllyVoice[] = ['balanced', 'warm', 'crisp'];
const TONES: AllyTone[] = ['clear', 'calm', 'dynamic'];

function parseVoice(s: string | null): AllyVoice {
  return VOICES.includes(s as AllyVoice) ? (s as AllyVoice) : 'balanced';
}

function parseTone(s: string | null): AllyTone {
  return TONES.includes(s as AllyTone) ? (s as AllyTone) : 'clear';
}

export function AllyProvider({ children }: { children: React.ReactNode }) {
  const [voice, setVoiceState] = useState<AllyVoice>('balanced');
  const [tone, setToneState] = useState<AllyTone>('clear');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [v, t] = await Promise.all([
        AsyncStorage.getItem(VOICE_KEY),
        AsyncStorage.getItem(TONE_KEY),
      ]);
      if (!cancelled) {
        setVoiceState(parseVoice(v));
        setToneState(parseTone(t));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      DATABASE_RESET_COMPLETE_EVENT,
      () => {
        setVoiceState('balanced');
        setToneState('clear');
      },
    );
    return () => sub.remove();
  }, []);

  const setVoice = useCallback(async (v: AllyVoice) => {
    await AsyncStorage.setItem(VOICE_KEY, v);
    setVoiceState(v);
  }, []);

  const setTone = useCallback(async (t: AllyTone) => {
    await AsyncStorage.setItem(TONE_KEY, t);
    setToneState(t);
  }, []);

  const value = useMemo(
    () => ({ voice, tone, setVoice, setTone }),
    [voice, tone, setVoice, setTone],
  );

  return (
    <AllyContext.Provider value={value}>{children}</AllyContext.Provider>
  );
}

export function useAlly() {
  const ctx = useContext(AllyContext);
  if (!ctx) {
    throw new Error('useAlly must be used within AllyProvider');
  }
  return ctx;
}
