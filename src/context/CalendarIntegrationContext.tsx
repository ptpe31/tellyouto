import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, type AppStateStatus, DeviceEventEmitter } from 'react-native';

import { DATABASE_RESET_COMPLETE_EVENT } from '../api/localDb';
import type { BusyInterval } from '../services/agentLogic';
import {
  getTodayBusyIntervalsSplit,
  listDeviceCalendars,
  requestCalendarPermissions,
  type DeviceCalendarInfo,
} from '../services/calendarService';
import {
  getCalendarConnectEnabled,
  getCalendarDeviceConfigs,
  mergeConfigsWithDeviceList,
  patchCalendarDeviceConfig,
  setCalendarConnectEnabled,
  setCalendarDeviceConfigs,
  type CalendarDeviceConfig,
} from '../services/calendarSettings';

type CalendarIntegrationValue = {
  connectEnabled: boolean;
  /** Créneaux indisponibles (calendriers connectés) — agent & collisions. */
  busyIntervals: BusyInterval[];
  /** Créneaux à afficher sur le rail (calendriers connectés + visibles). */
  visibleBusyIntervals: BusyInterval[];
  loading: boolean;
  deviceCalendars: DeviceCalendarInfo[];
  calendarConfigs: Record<string, CalendarDeviceConfig>;
  calendarsListLoading: boolean;
  setConnectEnabled: (v: boolean) => Promise<void>;
  refreshBusy: () => Promise<BusyInterval[]>;
  /** Recharge la liste système et fusionne les préférences locales. */
  refreshDeviceCalendars: () => Promise<void>;
  setCalendarConnected: (calendarId: string, connected: boolean) => Promise<void>;
  setCalendarRailVisible: (calendarId: string, railVisible: boolean) => Promise<void>;
};

const CalendarIntegrationContext = createContext<
  CalendarIntegrationValue | undefined
>(undefined);

function configsToConnectedIds(
  configs: Record<string, CalendarDeviceConfig>,
): string[] {
  return Object.entries(configs)
    .filter(([, c]) => c.connected)
    .map(([id]) => id);
}

function railVisibleMapFromConfigs(
  configs: Record<string, CalendarDeviceConfig>,
): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const [id, c] of Object.entries(configs)) {
    if (c.connected) m[id] = c.railVisible;
  }
  return m;
}

export function CalendarIntegrationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [connectEnabled, setConnectState] = useState(false);
  const [busyIntervals, setBusyIntervals] = useState<BusyInterval[]>([]);
  const [visibleBusyIntervals, setVisibleBusyIntervals] = useState<
    BusyInterval[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [deviceCalendars, setDeviceCalendars] = useState<DeviceCalendarInfo[]>(
    [],
  );
  const [calendarConfigs, setCalendarConfigsState] = useState<
    Record<string, CalendarDeviceConfig>
  >({});
  const [calendarsListLoading, setCalendarsListLoading] = useState(false);

  const applyBusyFromConfigs = useCallback(
    async (configs: Record<string, CalendarDeviceConfig>): Promise<BusyInterval[]> => {
      const on = await getCalendarConnectEnabled();
      if (!on) {
        setBusyIntervals([]);
        setVisibleBusyIntervals([]);
        return [];
      }
      const ok = await requestCalendarPermissions();
      if (!ok) {
        setBusyIntervals([]);
        setVisibleBusyIntervals([]);
        return [];
      }
      const connected = configsToConnectedIds(configs);
      const railVis = railVisibleMapFromConfigs(configs);
      const split = await getTodayBusyIntervalsSplit(connected, railVis);
      setBusyIntervals(split.blocking);
      setVisibleBusyIntervals(split.visible);
      return split.blocking;
    },
    [],
  );

  const refreshBusy = useCallback(async (): Promise<BusyInterval[]> => {
    const configs = await getCalendarDeviceConfigs();
    return applyBusyFromConfigs(configs);
  }, [applyBusyFromConfigs]);

  const refreshDeviceCalendars = useCallback(async () => {
    const on = await getCalendarConnectEnabled();
    if (!on) {
      setDeviceCalendars([]);
      return;
    }
    const ok = await requestCalendarPermissions();
    if (!ok) {
      setDeviceCalendars([]);
      return;
    }
    setCalendarsListLoading(true);
    try {
      const devices = await listDeviceCalendars();
      setDeviceCalendars(devices);
      const existing = await getCalendarDeviceConfigs();
      const merged = mergeConfigsWithDeviceList(
        devices.map((d) => d.id),
        existing,
      );
      await setCalendarDeviceConfigs(merged);
      setCalendarConfigsState(merged);
      await applyBusyFromConfigs(merged);
    } finally {
      setCalendarsListLoading(false);
    }
  }, [applyBusyFromConfigs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await getCalendarConnectEnabled();
      if (cancelled) return;
      setConnectState(c);
      const configs = await getCalendarDeviceConfigs();
      setCalendarConfigsState(configs);
      setLoading(false);
      if (c) {
        const ok = await requestCalendarPermissions();
        if (cancelled || !ok) return;
        setCalendarsListLoading(true);
        try {
          const devices = await listDeviceCalendars();
          if (cancelled) return;
          setDeviceCalendars(devices);
          const merged = mergeConfigsWithDeviceList(
            devices.map((d) => d.id),
            configs,
          );
          await setCalendarDeviceConfigs(merged);
          setCalendarConfigsState(merged);
          const connected = configsToConnectedIds(merged);
          const railVis = railVisibleMapFromConfigs(merged);
          const split = await getTodayBusyIntervalsSplit(connected, railVis);
          if (cancelled) return;
          setBusyIntervals(split.blocking);
          setVisibleBusyIntervals(split.visible);
        } finally {
          if (!cancelled) setCalendarsListLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void refreshBusy();
    });
    return () => sub.remove();
  }, [refreshBusy]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      DATABASE_RESET_COMPLETE_EVENT,
      () => {
        setConnectState(false);
        setBusyIntervals([]);
        setVisibleBusyIntervals([]);
        setDeviceCalendars([]);
        setCalendarConfigsState({});
        setCalendarsListLoading(false);
      },
    );
    return () => sub.remove();
  }, []);

  const setConnectEnabled = useCallback(
    async (v: boolean) => {
      setConnectState(v);
      await setCalendarConnectEnabled(v);
      if (v) {
        await requestCalendarPermissions();
        await refreshDeviceCalendars();
      } else {
        setDeviceCalendars([]);
        setBusyIntervals([]);
        setVisibleBusyIntervals([]);
      }
    },
    [refreshDeviceCalendars],
  );

  const setCalendarConnected = useCallback(
    async (calendarId: string, connected: boolean) => {
      const next = await patchCalendarDeviceConfig(calendarId, { connected });
      setCalendarConfigsState(next);
      await applyBusyFromConfigs(next);
    },
    [applyBusyFromConfigs],
  );

  const setCalendarRailVisible = useCallback(
    async (calendarId: string, railVisible: boolean) => {
      const next = await patchCalendarDeviceConfig(calendarId, {
        railVisible,
      });
      setCalendarConfigsState(next);
      await applyBusyFromConfigs(next);
    },
    [applyBusyFromConfigs],
  );

  const value = useMemo(
    () => ({
      connectEnabled,
      busyIntervals,
      visibleBusyIntervals,
      loading,
      deviceCalendars,
      calendarConfigs,
      calendarsListLoading,
      setConnectEnabled,
      refreshBusy,
      refreshDeviceCalendars,
      setCalendarConnected,
      setCalendarRailVisible,
    }),
    [
      connectEnabled,
      busyIntervals,
      visibleBusyIntervals,
      loading,
      deviceCalendars,
      calendarConfigs,
      calendarsListLoading,
      setConnectEnabled,
      refreshBusy,
      refreshDeviceCalendars,
      setCalendarConnected,
      setCalendarRailVisible,
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
