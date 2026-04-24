import AsyncStorage from '@react-native-async-storage/async-storage';

import { updateGrowth, type TrankilV2UserStatsRow } from '../api/trankilV2Db';

export type ZenActionType = 'TASK_VALIDATION' | 'PROJECT_VALIDATION' | 'QUEST_COMPLETION';

const ZEN_BASE_VALUES: Record<ZenActionType, number> = {
  TASK_VALIDATION: 10,
  PROJECT_VALIDATION: 30,
  QUEST_COMPLETION: 50,
};

const STORAGE_KEY = '@tellyouto/zen_engine_v1';

type ZenEngineState = {
  dayKey: string;
  actionCounts: Record<ZenActionType, number>;
};

let rentabilityMultiplier = 1.0;

function dayKeyLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function defaultState(now: Date = new Date()): ZenEngineState {
  return {
    dayKey: dayKeyLocal(now),
    actionCounts: {
      TASK_VALIDATION: 0,
      PROJECT_VALIDATION: 0,
      QUEST_COMPLETION: 0,
    },
  };
}

async function loadState(now: Date = new Date()): Promise<ZenEngineState> {
  const key = dayKeyLocal(now);
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState(now);
    const parsed = JSON.parse(raw) as Partial<ZenEngineState>;
    if (!parsed || typeof parsed !== 'object' || parsed.dayKey !== key) {
      return defaultState(now);
    }
    return {
      dayKey: key,
      actionCounts: {
        TASK_VALIDATION: Number(parsed.actionCounts?.TASK_VALIDATION ?? 0),
        PROJECT_VALIDATION: Number(parsed.actionCounts?.PROJECT_VALIDATION ?? 0),
        QUEST_COMPLETION: Number(parsed.actionCounts?.QUEST_COMPLETION ?? 0),
      },
    };
  } catch {
    return defaultState(now);
  }
}

async function saveState(state: ZenEngineState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setZenRentabilityMultiplier(next: number): void {
  if (!Number.isFinite(next)) return;
  rentabilityMultiplier = Math.max(0.1, Math.min(5, Number(next)));
}

export function calculateZenGain(baseValue: number, _actionType: ZenActionType, nActionsToday: number): number {
  const safeBase = Math.max(1, Math.round(baseValue));
  const n = Math.max(1, Math.round(nActionsToday));
  const raw = (safeBase / (1 + Math.log(n))) * rentabilityMultiplier;
  return Math.max(1, Math.round(raw));
}

export async function awardZenForAction(actionType: ZenActionType): Promise<{
  gain: number;
  stats: TrankilV2UserStatsRow;
  actionsToday: number;
}> {
  const state = await loadState();
  const nextCount = (state.actionCounts[actionType] ?? 0) + 1;
  const gain = calculateZenGain(ZEN_BASE_VALUES[actionType], actionType, nextCount);
  state.actionCounts[actionType] = nextCount;
  await saveState(state);
  const stats = await updateGrowth(gain);
  return { gain, stats, actionsToday: nextCount };
}

export async function getZenActionsToday(actionType: ZenActionType): Promise<number> {
  const state = await loadState();
  return state.actionCounts[actionType] ?? 0;
}
