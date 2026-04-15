import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  adjustZenPoints,
  listTrankilV2Intentions,
  type TrankilV2IntentionRow,
} from '../api/trankilV2Db';
import { groupIntentionsByTimeHorizon } from './TimeSorter';
import { awardZenForAction } from './ZenEngine';

export type QuestFamily = 'CLARITY' | 'CLEANUP' | 'RHYTHM' | 'SOVEREIGNTY';

export type DailyQuest = {
  id: string;
  family: QuestFamily;
  title: string;
  description: string;
  target: number;
  metric: 'today_items' | 'rearb_items' | 'project_items' | 'dated_items' | 'done_today';
};

type StoredQuestState = {
  dayKey: string;
  questId: string;
  claimed: boolean;
  entropyApplied: boolean;
};

const STORAGE_KEY = '@tellyouto/daily_quest_v1';

function dayKeyLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const QUEST_CATALOG: DailyQuest[] = [
  { id: 'clarity_1', family: 'CLARITY', title: "L'Elu du jour", description: "Identifier une priorite dans Aujourd'hui.", target: 1, metric: 'today_items' },
  { id: 'clarity_2', family: 'CLARITY', title: 'Priorite Laser', description: "Atteindre 2 intentions datees aujourd'hui.", target: 2, metric: 'today_items' },
  { id: 'clarity_3', family: 'CLARITY', title: 'Vue Claire', description: "Avoir 3 intentions avec une echeance claire.", target: 3, metric: 'dated_items' },
  { id: 'clarity_4', family: 'CLARITY', title: 'Demain Trace', description: "Poser au moins une intention pour demain.", target: 1, metric: 'dated_items' },
  { id: 'clarity_5', family: 'CLARITY', title: 'Cap Defini', description: "Valider 1 action terminee aujourd'hui.", target: 1, metric: 'done_today' },
  { id: 'cleanup_1', family: 'CLEANUP', title: 'Le Grand Menage', description: 'Re-arbitrer 3 taches passees.', target: 3, metric: 'rearb_items' },
  { id: 'cleanup_2', family: 'CLEANUP', title: 'Bac Epure', description: 'Ramener le bac a re-arbitrer sous 2 elements.', target: 2, metric: 'rearb_items' },
  { id: 'cleanup_3', family: 'CLEANUP', title: 'Reset Clarte', description: 'Nettoyer 4 elements en retard.', target: 4, metric: 'rearb_items' },
  { id: 'cleanup_4', family: 'CLEANUP', title: 'Ligne Propre', description: 'Ne laisser aucun element en retard.', target: 0, metric: 'rearb_items' },
  { id: 'cleanup_5', family: 'CLEANUP', title: 'Vitesse de Tri', description: 'Finaliser 2 actions terminees.', target: 2, metric: 'done_today' },
  { id: 'rhythm_1', family: 'RHYTHM', title: 'Rythme Pose', description: "Avoir 3 intentions planifiees cette semaine.", target: 3, metric: 'dated_items' },
  { id: 'rhythm_2', family: 'RHYTHM', title: 'Semaine Cadree', description: 'Avoir 5 intentions datees.', target: 5, metric: 'dated_items' },
  { id: 'rhythm_3', family: 'RHYTHM', title: 'Pulsation Stable', description: "Avoir 2 intentions pour aujourd'hui.", target: 2, metric: 'today_items' },
  { id: 'rhythm_4', family: 'RHYTHM', title: 'Monotache', description: "Conserver 1 priorite claire aujourd'hui.", target: 1, metric: 'today_items' },
  { id: 'rhythm_5', family: 'RHYTHM', title: 'Execution Quotidienne', description: 'Valider 3 actions aujourd hui.', target: 3, metric: 'done_today' },
  { id: 'sovereign_1', family: 'SOVEREIGNTY', title: 'Le Decoupeur', description: 'Transformer une tache lourde en projet.', target: 1, metric: 'project_items' },
  { id: 'sovereign_2', family: 'SOVEREIGNTY', title: 'Architecte', description: 'Avoir 2 projets actifs.', target: 2, metric: 'project_items' },
  { id: 'sovereign_3', family: 'SOVEREIGNTY', title: 'Vision Maitre', description: 'Avoir 3 projets actifs.', target: 3, metric: 'project_items' },
  { id: 'sovereign_4', family: 'SOVEREIGNTY', title: 'Pilotage Expert', description: 'Valider 1 action issue de projet.', target: 1, metric: 'done_today' },
  { id: 'sovereign_5', family: 'SOVEREIGNTY', title: 'Controle Tempo', description: 'Avoir 4 intentions datees.', target: 4, metric: 'dated_items' },
];

function metricValue(metric: DailyQuest['metric'], rows: TrankilV2IntentionRow[]): number {
  const horizons = groupIntentionsByTimeHorizon(rows);
  if (metric === 'today_items') return horizons.TODAY.length;
  if (metric === 'rearb_items') return horizons.REARBITRATE.length;
  if (metric === 'project_items') return rows.filter((r) => r.type === 'PROJECT' && r.status !== 'DONE').length;
  if (metric === 'dated_items') return rows.filter((r) => /^\d{8}$/.test(String(r.due_date || ''))).length;
  const today = dayKeyLocal(new Date());
  const dayOf = (ts: number): string => {
    const d = new Date(ts);
    return dayKeyLocal(d);
  };
  return rows.filter((r) => r.status === 'DONE' && dayOf(r.created_at) === today).length;
}

function chooseQuest(rows: TrankilV2IntentionRow[]): DailyQuest {
  const horizons = groupIntentionsByTimeHorizon(rows);
  if (horizons.REARBITRATE.length >= 3) {
    return QUEST_CATALOG.find((q) => q.id === 'cleanup_1') ?? QUEST_CATALOG[0];
  }
  if (rows.filter((r) => r.type === 'PROJECT' && r.status !== 'DONE').length > 0) {
    return QUEST_CATALOG.find((q) => q.id === 'sovereign_1') ?? QUEST_CATALOG[0];
  }
  if (horizons.TODAY.length === 0) {
    return QUEST_CATALOG.find((q) => q.id === 'clarity_1') ?? QUEST_CATALOG[0];
  }
  return QUEST_CATALOG.find((q) => q.id === 'rhythm_3') ?? QUEST_CATALOG[0];
}

async function loadState(now: Date = new Date()): Promise<StoredQuestState> {
  const dayKey = dayKeyLocal(now);
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { dayKey, questId: '', claimed: false, entropyApplied: false };
    }
    const parsed = JSON.parse(raw) as Partial<StoredQuestState>;
    if (!parsed || parsed.dayKey !== dayKey) {
      return { dayKey, questId: '', claimed: false, entropyApplied: false };
    }
    return {
      dayKey,
      questId: String(parsed.questId || ''),
      claimed: parsed.claimed === true,
      entropyApplied: parsed.entropyApplied === true,
    };
  } catch {
    return { dayKey, questId: '', claimed: false, entropyApplied: false };
  }
}

async function saveState(state: StoredQuestState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function applyDailyEntropyIfNeeded(state: StoredQuestState, rows: TrankilV2IntentionRow[]): Promise<StoredQuestState> {
  if (state.entropyApplied) return state;
  const horizons = groupIntentionsByTimeHorizon(rows);
  const rearbCount = horizons.REARBITRATE.length;
  if (rearbCount > 0) {
    await adjustZenPoints(-2 * rearbCount);
  }
  const next = { ...state, entropyApplied: true };
  await saveState(next);
  return next;
}

export async function getDailyQuestSnapshot(): Promise<{
  quest: DailyQuest;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  canClaim: boolean;
}> {
  const rows = await listTrankilV2Intentions();
  let state = await loadState();
  state = await applyDailyEntropyIfNeeded(state, rows);
  if (!state.questId) {
    const selected = chooseQuest(rows);
    state = { ...state, questId: selected.id };
    await saveState(state);
  }
  const quest = QUEST_CATALOG.find((q) => q.id === state.questId) ?? QUEST_CATALOG[0];
  const value = metricValue(quest.metric, rows);
  const completed = quest.metric === 'rearb_items' && quest.target === 0 ? value <= 0 : value >= quest.target;
  return {
    quest,
    progress: value,
    target: quest.target,
    completed,
    claimed: state.claimed,
    canClaim: completed && !state.claimed,
  };
}

export async function claimDailyQuestBonus(): Promise<{
  ok: boolean;
  gain: number;
}> {
  const snapshot = await getDailyQuestSnapshot();
  if (!snapshot.canClaim) {
    return { ok: false, gain: 0 };
  }
  const reward = await awardZenForAction('QUEST_COMPLETION');
  const state = await loadState();
  const next = { ...state, claimed: true };
  await saveState(next);
  return { ok: true, gain: reward.gain };
}
