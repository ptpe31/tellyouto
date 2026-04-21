import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus, DeviceEventEmitter } from 'react-native';

import { Platform } from '../utils/rnPlatform';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  checkpointLocalDatabase,
  DATABASE_RESET_COMPLETE_EVENT,
  syncPreferredRailAlarmSoundToSqlite,
} from '../api/localDb';
import {
  normalizeRailAlarmSoundId,
  type RailAlarmSoundId,
} from '../services/railAlarmSound';
import {
  DEFAULT_INTENTIONS_QUOTA,
  pushDeviceProfileToFirestore,
  pushUserEntitlementsToFirestore,
  type DeviceProfileFields,
} from '../api/userProfile';
import {
  DEBUG_USER_TIER_OVERRIDE_CHANGED,
  readDebugUserTierOverride,
  writeDebugUserTierOverride,
  type DebugUserTierOverride,
} from '../services/debugUserTierOverride';

/** Clé AsyncStorage — partagée avec le reset profil (debug / onboarding). */
export const USER_SPECTRUM_STORAGE_KEY = '@tellyouto/user_spectrum';

const STORAGE_KEY = USER_SPECTRUM_STORAGE_KEY;

export type PlatformType = 'ios' | 'android' | 'web' | 'unknown';

/** Poids du spectre utilisateur (0–1), indépendants — profil dynamique, pas fixe */
export type SpectrumWeights = {
  structure: number;
  momentum: number;
  zen: number;
  stats: number;
};

export type UserSpectrumState = SpectrumWeights & {
  platform_type: PlatformType;
  platform_user_id: string;
  /** Prénom affiché (Allié, messages bots) */
  first_name: string;
  /** Quota d’intentions reçues via messagerie (miroir Firestore `devices/{id}`) */
  intentions_quota: number;
  /** Langue pour les messages bot / alignement profil */
  locale: string;
  /** Rappels messagerie avant créneau (montre / téléphone) */
  messenger_reminders_enabled: boolean;
  messenger_reminder_lead_minutes: number;
  /** Fin du mode sans pub (ms) — ex. offre installation Telegram */
  ad_free_until_ms: number | null;
  /** Abonnement Pro — canaux premium + sans pub permanent */
  isProUser: boolean;
  /** Dernier canal messager lié (miroir Firestore `devices/{id}`) */
  lastMessengerChannel: string | null;
  /** Identifiant messager lié */
  lastMessengerUserId: string | null;
  /** Sonnerie native des alarmes rail (fichiers bundlés + canaux Android). */
  preferred_alarm_sound: RailAlarmSoundId;
};

function detectPlatformType(): PlatformType {
  switch (Platform.OS) {
    case 'ios':
      return 'ios';
    case 'android':
      return 'android';
    case 'web':
      return 'web';
    default:
      return 'unknown';
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

const defaultSpectrum = (): UserSpectrumState => ({
  structure: 0.25,
  momentum: 0.25,
  zen: 0.25,
  stats: 0.25,
  platform_type: detectPlatformType(),
  platform_user_id: '',
  first_name: '',
  intentions_quota: DEFAULT_INTENTIONS_QUOTA,
  locale: 'fr',
  messenger_reminders_enabled: true,
  messenger_reminder_lead_minutes: 5,
  ad_free_until_ms: null,
  isProUser: false,
  lastMessengerChannel: null,
  lastMessengerUserId: null,
  preferred_alarm_sound: 'default',
});

type UserSpectrumContextValue = {
  spectrum: UserSpectrumState;
  /** Met à jour les 4 poids (chaque valeur clampée 0–1) */
  setWeights: (w: Partial<SpectrumWeights>) => void;
  /** Applique les poids et persiste immédiatement (évite les courses d’état) */
  applyWeightsAndPersist: (w: SpectrumWeights) => Promise<void>;
  setPlatformUserId: (id: string) => void;
  setFirstName: (name: string) => void;
  setLocale: (locale: string) => void;
  setMessengerRemindersEnabled: (enabled: boolean) => void;
  setMessengerReminderLeadMinutes: (minutes: number) => void;
  applyMessengerReminderPrefs: (
    enabled: boolean,
    leadMinutes: number,
  ) => Promise<void>;
  mergeRemoteProfile: (remote: DeviceProfileFields) => void;
  /** Prolonge ou définit le mode sans pub (persist + Firestore si dispo). */
  grantAdFreeDays: (days: number) => Promise<void>;
  setProUser: (value: boolean) => Promise<void>;
  setPreferredAlarmSound: (sound: RailAlarmSoundId) => Promise<void>;
  resetSpectrum: () => void;
  persist: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  /** Surcharge debug Pro/Free (clé AsyncStorage `@tellyouto/is_pro_simulated`). */
  debugUserTierOverride: DebugUserTierOverride;
  applyDebugUserTierOverride: (value: DebugUserTierOverride) => Promise<void>;
};

const UserSpectrumContext = createContext<UserSpectrumContextValue | undefined>(
  undefined,
);

export function UserSpectrumProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [spectrum, setSpectrum] = useState<UserSpectrumState>(defaultSpectrum);
  const [debugUserTierOverride, setDebugUserTierOverride] =
    useState<DebugUserTierOverride>('none');
  const spectrumRef = useRef(spectrum);
  useEffect(() => {
    spectrumRef.current = spectrum;
  }, [spectrum]);

  useEffect(() => {
    void readDebugUserTierOverride().then(setDebugUserTierOverride);
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      DEBUG_USER_TIER_OVERRIDE_CHANGED,
      (v: DebugUserTierOverride) => {
        setDebugUserTierOverride(v);
      },
    );
    return () => sub.remove();
  }, []);

  const setWeights = useCallback((w: Partial<SpectrumWeights>) => {
    setSpectrum((prev) => ({
      ...prev,
      structure: w.structure !== undefined ? clamp01(w.structure) : prev.structure,
      momentum: w.momentum !== undefined ? clamp01(w.momentum) : prev.momentum,
      zen: w.zen !== undefined ? clamp01(w.zen) : prev.zen,
      stats: w.stats !== undefined ? clamp01(w.stats) : prev.stats,
    }));
  }, []);

  const applyWeightsAndPersist = useCallback(async (w: SpectrumWeights) => {
    const next: UserSpectrumState = {
      ...spectrumRef.current,
      structure: clamp01(w.structure),
      momentum: clamp01(w.momentum),
      zen: clamp01(w.zen),
      stats: clamp01(w.stats),
    };
    spectrumRef.current = next;
    setSpectrum(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const setPlatformUserId = useCallback((platform_user_id: string) => {
    setSpectrum((prev) => ({ ...prev, platform_user_id }));
  }, []);

  const setFirstName = useCallback((first_name: string) => {
    const trimmed = first_name.trim();
    const merged: UserSpectrumState = {
      ...spectrumRef.current,
      first_name: trimmed,
    };
    spectrumRef.current = merged;
    setSpectrum(merged);
  }, []);

  const setLocale = useCallback((locale: string) => {
    const next = locale.trim();
    if (!next) return;
    setSpectrum((prev) => {
      const merged = { ...prev, locale: next };
      spectrumRef.current = merged;
      return merged;
    });
  }, []);

  const setMessengerRemindersEnabled = useCallback((enabled: boolean) => {
    setSpectrum((prev) => {
      const merged = { ...prev, messenger_reminders_enabled: enabled };
      spectrumRef.current = merged;
      return merged;
    });
  }, []);

  const setMessengerReminderLeadMinutes = useCallback((minutes: number) => {
    const n = Math.min(60, Math.max(1, Math.round(minutes)));
    setSpectrum((prev) => {
      const merged = { ...prev, messenger_reminder_lead_minutes: n };
      spectrumRef.current = merged;
      return merged;
    });
  }, []);

  const mergeRemoteProfile = useCallback((remote: DeviceProfileFields) => {
    const prev = spectrumRef.current;
    const merged: UserSpectrumState = {
      ...prev,
      first_name:
        typeof remote.first_name === 'string' && remote.first_name.trim()
          ? remote.first_name.trim()
          : prev.first_name,
      intentions_quota:
        typeof remote.intentions_quota === 'number' &&
        Number.isFinite(remote.intentions_quota)
          ? Math.max(0, Math.floor(remote.intentions_quota))
          : prev.intentions_quota,
      locale:
        typeof remote.locale === 'string' && remote.locale.trim()
          ? remote.locale.trim()
          : prev.locale,
      messenger_reminders_enabled:
        typeof remote.messenger_reminders_enabled === 'boolean'
          ? remote.messenger_reminders_enabled
          : prev.messenger_reminders_enabled,
      messenger_reminder_lead_minutes:
        typeof remote.messenger_reminder_lead_minutes === 'number' &&
        Number.isFinite(remote.messenger_reminder_lead_minutes)
          ? Math.min(
              60,
              Math.max(1, Math.round(remote.messenger_reminder_lead_minutes)),
            )
          : prev.messenger_reminder_lead_minutes,
      ad_free_until_ms: (() => {
        const r = remote.ad_free_until_ms;
        const p = prev.ad_free_until_ms;
        const rN = typeof r === 'number' && Number.isFinite(r) ? r : null;
        const pN = typeof p === 'number' && Number.isFinite(p) ? p : null;
        if (rN == null) return pN;
        if (pN == null) return rN;
        return Math.max(rN, pN);
      })(),
      isProUser:
        typeof remote.is_pro_user === 'boolean'
          ? remote.is_pro_user
          : prev.isProUser,
      lastMessengerChannel:
        remote.last_messenger_channel !== undefined
          ? remote.last_messenger_channel
          : prev.lastMessengerChannel,
      lastMessengerUserId:
        remote.last_messenger_user_id !== undefined
          ? remote.last_messenger_user_id
          : prev.lastMessengerUserId,
    };
    spectrumRef.current = merged;
    setSpectrum(merged);
  }, []);

  const resetSpectrum = useCallback(() => {
    setSpectrum(defaultSpectrum());
  }, []);

  const persist = useCallback(async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(spectrumRef.current),
    );
  }, []);

  const setProUser = useCallback(async (value: boolean) => {
    const prev = spectrumRef.current;
    const merged: UserSpectrumState = { ...prev, isProUser: value };
    spectrumRef.current = merged;
    setSpectrum(merged);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    await pushUserEntitlementsToFirestore({ is_pro_user: value });
    await pushDeviceProfileToFirestore({});
  }, []);

  const setPreferredAlarmSound = useCallback(async (sound: RailAlarmSoundId) => {
    const id = normalizeRailAlarmSoundId(sound);
    const merged: UserSpectrumState = {
      ...spectrumRef.current,
      preferred_alarm_sound: id,
    };
    spectrumRef.current = merged;
    setSpectrum(merged);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    await syncPreferredRailAlarmSoundToSqlite(id);
    try {
      const { invalidateRailAlarmChannelCache, refreshRailAlarmsAfterLocalDbChange } =
        await import('../services/alarmManager');
      invalidateRailAlarmChannelCache();
      await refreshRailAlarmsAfterLocalDbChange();
    } catch {
      /* Expo Go / module absent */
    }
  }, []);

  const grantAdFreeDays = useCallback(async (days: number) => {
    const d = Math.min(365 * 5, Math.max(1, Math.round(days)));
    const until = Date.now() + d * 24 * 60 * 60 * 1000;
    const prev = spectrumRef.current;
    const cur = prev.ad_free_until_ms;
    const nextUntil =
      typeof cur === 'number' && cur > Date.now()
        ? Math.max(until, cur)
        : until;
    const merged: UserSpectrumState = { ...prev, ad_free_until_ms: nextUntil };
    spectrumRef.current = merged;
    setSpectrum(merged);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    await pushUserEntitlementsToFirestore({ ad_free_until_ms: nextUntil });
    await pushDeviceProfileToFirestore({});
  }, []);

  const applyMessengerReminderPrefs = useCallback(
    async (enabled: boolean, leadMinutes: number) => {
      const n = Math.min(60, Math.max(1, Math.round(leadMinutes)));
      setSpectrum((prev) => {
        const merged = {
          ...prev,
          messenger_reminders_enabled: enabled,
          messenger_reminder_lead_minutes: n,
        };
        spectrumRef.current = merged;
        return merged;
      });
      await persist();
      await pushDeviceProfileToFirestore({
        messenger_reminders_enabled: enabled,
        messenger_reminder_lead_minutes: n,
      });
    },
    [persist],
  );

  const applyDebugUserTierOverride = useCallback(async (value: DebugUserTierOverride) => {
    await writeDebugUserTierOverride(value);
  }, []);

  const loadFromStorage = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<UserSpectrumState>;
      setSpectrum((prev) => ({
        ...prev,
        ...parsed,
        structure: clamp01(parsed.structure ?? prev.structure),
        momentum: clamp01(parsed.momentum ?? prev.momentum),
        zen: clamp01(parsed.zen ?? prev.zen),
        stats: clamp01(parsed.stats ?? prev.stats),
        platform_type: parsed.platform_type ?? detectPlatformType(),
        platform_user_id: parsed.platform_user_id ?? prev.platform_user_id,
        first_name:
          typeof parsed.first_name === 'string'
            ? parsed.first_name.trim()
            : prev.first_name,
        intentions_quota:
          typeof parsed.intentions_quota === 'number' &&
          Number.isFinite(parsed.intentions_quota)
            ? Math.max(0, Math.floor(parsed.intentions_quota))
            : prev.intentions_quota,
        locale:
          typeof parsed.locale === 'string' && parsed.locale.trim()
            ? parsed.locale.trim()
            : prev.locale,
        messenger_reminders_enabled:
          typeof parsed.messenger_reminders_enabled === 'boolean'
            ? parsed.messenger_reminders_enabled
            : prev.messenger_reminders_enabled,
        messenger_reminder_lead_minutes:
          typeof parsed.messenger_reminder_lead_minutes === 'number' &&
          Number.isFinite(parsed.messenger_reminder_lead_minutes)
            ? Math.min(
                60,
                Math.max(1, Math.round(parsed.messenger_reminder_lead_minutes)),
              )
            : prev.messenger_reminder_lead_minutes,
        ad_free_until_ms:
          typeof parsed.ad_free_until_ms === 'number' &&
          Number.isFinite(parsed.ad_free_until_ms)
            ? parsed.ad_free_until_ms
            : prev.ad_free_until_ms,
        isProUser:
          typeof parsed.isProUser === 'boolean'
            ? parsed.isProUser
            : prev.isProUser,
        lastMessengerChannel: (() => {
          const v = (parsed as Partial<UserSpectrumState>).lastMessengerChannel;
          if (v === null || typeof v === 'string') return v ?? null;
          return prev.lastMessengerChannel;
        })(),
        lastMessengerUserId: (() => {
          const v = (parsed as Partial<UserSpectrumState>).lastMessengerUserId;
          if (v === null || typeof v === 'string') return v ?? null;
          return prev.lastMessengerUserId;
        })(),
        preferred_alarm_sound: normalizeRailAlarmSoundId(
          parsed.preferred_alarm_sound as string | undefined,
        ),
      }));
      void syncPreferredRailAlarmSoundToSqlite(
        normalizeRailAlarmSoundId(parsed.preferred_alarm_sound as string | undefined),
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      DATABASE_RESET_COMPLETE_EVENT,
      () => {
        setSpectrum(defaultSpectrum());
      },
    );
    return () => sub.remove();
  }, []);

  /** Sauvegarde automatique du spectre (AsyncStorage) + checkpoint SQLite toutes les 5 min. */
  useEffect(() => {
    const id = setInterval(() => {
      void persist();
      void checkpointLocalDatabase();
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [persist]);

  /** À la mise en arrière-plan : flush spectre + SQLite avant que l’OS ne suspende le process. */
  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        void persist();
        void checkpointLocalDatabase();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [persist]);

  const effectiveIsProUser = useMemo(() => {
    if (debugUserTierOverride === 'force_free') return false;
    if (debugUserTierOverride === 'force_pro') return true;
    return spectrum.isProUser;
  }, [debugUserTierOverride, spectrum.isProUser]);

  const spectrumForConsumer = useMemo(
    () => ({ ...spectrum, isProUser: effectiveIsProUser }),
    [spectrum, effectiveIsProUser],
  );

  const value = useMemo(
    () => ({
      spectrum: spectrumForConsumer,
      setWeights,
      applyWeightsAndPersist,
      setPlatformUserId,
      setFirstName,
      setLocale,
      setMessengerRemindersEnabled,
      setMessengerReminderLeadMinutes,
      applyMessengerReminderPrefs,
      mergeRemoteProfile,
      grantAdFreeDays,
      setProUser,
      setPreferredAlarmSound,
      resetSpectrum,
      persist,
      loadFromStorage,
      debugUserTierOverride,
      applyDebugUserTierOverride,
    }),
    [
      spectrumForConsumer,
      setWeights,
      applyWeightsAndPersist,
      setPlatformUserId,
      setFirstName,
      setLocale,
      setMessengerRemindersEnabled,
      setMessengerReminderLeadMinutes,
      applyMessengerReminderPrefs,
      mergeRemoteProfile,
      grantAdFreeDays,
      setProUser,
      setPreferredAlarmSound,
      resetSpectrum,
      persist,
      loadFromStorage,
      debugUserTierOverride,
      applyDebugUserTierOverride,
    ],
  );

  return (
    <UserSpectrumContext.Provider value={value}>
      {children}
    </UserSpectrumContext.Provider>
  );
}

export function useUserSpectrum() {
  const ctx = useContext(UserSpectrumContext);
  if (!ctx) {
    throw new Error('useUserSpectrum must be used within UserSpectrumProvider');
  }
  return ctx;
}

export function isAdFreeModeActive(
  state: UserSpectrumState,
  nowMs: number = Date.now(),
): boolean {
  const u = state.ad_free_until_ms;
  return typeof u === 'number' && Number.isFinite(u) && u > nowMs;
}
