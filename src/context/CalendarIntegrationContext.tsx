import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { BusyInterval } from '../services/agentLogic';
import {
  getTodayBusyIntervalsMinutes,
  requestCalendarPermissions,
} from '../services/calendarService';
import {
  getCalendarConnectEnabled,
  getCalendarHideOnRail,
  setCalendarConnectEnabled,
  setCalendarHideOnRail,
} from '../services/calendarSettings';

type CalendarIntegrationValue = {
  connectEnabled: boolean;
  hideEventsOnRail: boolean;
  busyIntervals: BusyInterval[];
  loading: boolean;
  setConnectEnabled: (v: boolean) => Promise<void>;
  setHideEventsOnRail: (v: boolean) => Promise<void>;
  refreshBusy: () => Promise<BusyInterval[]>;
};

const CalendarIntegrationContext = createContext<
  CalendarIntegrationValue | undefined
>(undefined);

export function CalendarIntegrationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [connectEnabled, setConnectState] = useState(false);
  const [hideEventsOnRail, setHideState] = useState(false);
  const [busyIntervals, setBusyIntervals] = useState<BusyInterval[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshBusy = useCallback(async (): Promise<BusyInterval[]> => {
    const on = await getCalendarConnectEnabled();
    if (!on) {
      setBusyIntervals([]);
      return [];
    }
    const ok = await requestCalendarPermissions();
    if (!ok) {
      setBusyIntervals([]);
      return [];
    }
    const intervals = await getTodayBusyIntervalsMinutes();
    setBusyIntervals(intervals);
    return intervals;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, h] = await Promise.all([
        getCalendarConnectEnabled(),
        getCalendarHideOnRail(),
      ]);
      if (cancelled) return;
      setConnectState(c);
      setHideState(h);
      setLoading(false);
      if (c) await refreshBusy();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshBusy]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active' && connectEnabled) void refreshBusy();
    });
    return () => sub.remove();
  }, [connectEnabled, refreshBusy]);

  const setConnectEnabled = useCallback(
    async (v: boolean) => {
      setConnectState(v);
      await setCalendarConnectEnabled(v);
      if (v) {
        await requestCalendarPermissions();
        await refreshBusy();
      } else {
        setBusyIntervals([]);
      }
    },
    [refreshBusy],
  );

  const setHideEventsOnRail = useCallback(async (v: boolean) => {
    setHideState(v);
    await setCalendarHideOnRail(v);
  }, []);

  const value = useMemo(
    () => ({
      connectEnabled,
      hideEventsOnRail,
      busyIntervals,
      loading,
      setConnectEnabled,
      setHideEventsOnRail,
      refreshBusy,
    }),
    [
      connectEnabled,
      hideEventsOnRail,
      busyIntervals,
      loading,
      setConnectEnabled,
      setHideEventsOnRail,
      refreshBusy,
    ],
  );

  return (
    <CalendarIntegrationContext.Provider value={value}>
      {children}
    </CalendarIntegrationContext.Provider>
  );
}

export function useCalendarIntegration() {
  const ctx = useContext(CalendarIntegrationContext);
  if (!ctx) {
    throw new Error(
      'useCalendarIntegration must be used within CalendarIntegrationProvider',
    );
  }
  return ctx;
}
