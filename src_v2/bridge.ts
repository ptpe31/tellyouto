import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { startOneTapCapture } from './services/oneTap/pipeline';
import type { UiLocale } from './types/oneTap';

const PHOENIX_V2_STORAGE_KEY = '@tellyouto/phoenix_v2_enabled_v1';
export const PHOENIX_V2_TOGGLE_CHANGED = 'tellyouto_phoenix_v2_toggle_changed_v1';

let cachedPhoenixV2: boolean | null = null;
let phoenixHydrated = false;

function envDefaultEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PHOENIX_V2 === '1';
}

export function getPhoenixV2EnabledCached(): boolean {
  return phoenixHydrated && cachedPhoenixV2 !== null ? cachedPhoenixV2 : envDefaultEnabled();
}

export async function hydratePhoenixV2Enabled(): Promise<boolean> {
  if (phoenixHydrated) return getPhoenixV2EnabledCached();
  phoenixHydrated = true;
  try {
    const raw = await AsyncStorage.getItem(PHOENIX_V2_STORAGE_KEY);
    if (raw === '1') cachedPhoenixV2 = true;
    else if (raw === '0') cachedPhoenixV2 = false;
    else cachedPhoenixV2 = null;
  } catch {
    cachedPhoenixV2 = null;
  }
  return getPhoenixV2EnabledCached();
}

export async function setPhoenixV2Enabled(value: boolean): Promise<void> {
  phoenixHydrated = true;
  cachedPhoenixV2 = Boolean(value);
  try {
    await AsyncStorage.setItem(PHOENIX_V2_STORAGE_KEY, cachedPhoenixV2 ? '1' : '0');
  } catch {
    return;
  }
  try {
    DeviceEventEmitter.emit(PHOENIX_V2_TOGGLE_CHANGED, cachedPhoenixV2);
  } catch {
    return;
  }
}

export function phoenixV2Enabled(): boolean {
  return getPhoenixV2EnabledCached();
}

function getActiveGeminiModelId(): string {
  const raw = process.env.EXPO_PUBLIC_GEMINI_MODEL_ID?.trim();
  return raw && raw.length > 0 ? raw : 'gemini-2.5-flash-lite';
}

export function startPhoenixOneTap(params: {
  transcript: string;
  audioUri: string | null;
  uiLocale: UiLocale;
  titleHint?: string;
  online?: boolean;
}) {
  if (!phoenixV2Enabled()) {
    return null;
  }
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() ?? '';
  const modelId = getActiveGeminiModelId();
  return startOneTapCapture(params.transcript, {
    uiLocale: params.uiLocale,
    titleHint: params.titleHint,
    gemini: params.online === false ? undefined : apiKey ? { apiKey, modelId } : undefined,
  });
}
