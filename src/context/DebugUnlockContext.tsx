import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const KEY = '@tellyouto/debug_unlocked';

type DebugUnlockContextValue = {
  unlocked: boolean;
  unlock: () => Promise<void>;
  reload: () => Promise<void>;
};

const DebugUnlockContext = createContext<DebugUnlockContextValue | undefined>(
  undefined,
);

export function DebugUnlockProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);

  const reload = useCallback(async () => {
    const v = await AsyncStorage.getItem(KEY);
    setUnlocked(v === 'true');
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const unlock = useCallback(async () => {
    await AsyncStorage.setItem(KEY, 'true');
    setUnlocked(true);
  }, []);

  const value = useMemo(
    () => ({ unlocked, unlock, reload }),
    [unlocked, unlock, reload],
  );

  return (
    <DebugUnlockContext.Provider value={value}>
      {children}
    </DebugUnlockContext.Provider>
  );
}

export function useDebugUnlock() {
  const ctx = useContext(DebugUnlockContext);
  if (!ctx) {
    throw new Error('useDebugUnlock must be used within DebugUnlockProvider');
  }
  return ctx;
}
