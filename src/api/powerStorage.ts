import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@tellyouto/power_v1';

export type PersistedPowerState = {
  energyScore: number;
  agentEnergySeconds: number;
  isLowPower: boolean;
};

const defaultState: PersistedPowerState = {
  energyScore: 1,
  agentEnergySeconds: 0,
  isLowPower: false,
};

export async function loadPowerState(): Promise<PersistedPowerState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw) as Partial<PersistedPowerState>;
    return {
      energyScore:
        typeof parsed.energyScore === 'number'
          ? Math.min(1, Math.max(0, parsed.energyScore))
          : defaultState.energyScore,
      agentEnergySeconds:
        typeof parsed.agentEnergySeconds === 'number'
          ? Math.max(0, parsed.agentEnergySeconds)
          : defaultState.agentEnergySeconds,
      isLowPower: Boolean(parsed.isLowPower),
    };
  } catch {
    return { ...defaultState };
  }
}

export async function savePowerState(state: PersistedPowerState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}
