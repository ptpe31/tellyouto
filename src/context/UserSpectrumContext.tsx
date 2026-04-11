import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
});

type UserSpectrumContextValue = {
  spectrum: UserSpectrumState;
  /** Met à jour les 4 poids (chaque valeur clampée 0–1) */
  setWeights: (w: Partial<SpectrumWeights>) => void;
  /** Applique les poids et persiste immédiatement (évite les courses d’état) */
  applyWeightsAndPersist: (w: SpectrumWeights) => Promise<void>;
  setPlatformUserId: (id: string) => void;
  resetSpectrum: () => void;
  persist: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
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
  const spectrumRef = useRef(spectrum);
  useEffect(() => {
    spectrumRef.current = spectrum;
  }, [spectrum]);

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

  const resetSpectrum = useCallback(() => {
    setSpectrum(defaultSpectrum());
  }, []);

  const persist = useCallback(async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(spectrumRef.current),
    );
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
      }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  const value = useMemo(
    () => ({
      spectrum,
      setWeights,
      applyWeightsAndPersist,
      setPlatformUserId,
      resetSpectrum,
      persist,
      loadFromStorage,
    }),
    [
      spectrum,
      setWeights,
      applyWeightsAndPersist,
      setPlatformUserId,
      resetSpectrum,
      persist,
      loadFromStorage,
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
