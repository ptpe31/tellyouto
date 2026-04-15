import {
  getTrankilV2UserStats,
  listTrankilV2Intentions,
  setMorningFocusSelection,
  updateGrowth,
  type TrankilV2IntentionRow,
} from '../api/trankilV2Db';

export type MorningDewPick = {
  task: TrankilV2IntentionRow | null;
  habit: TrankilV2IntentionRow | null;
  inspiration: TrankilV2IntentionRow | null;
};

function dateKeyLocal(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function morningGreeting(now: Date): string {
  const h = now.getHours();
  if (h < 8) return 'Bonjour, prêt pour une journée sereine ?';
  if (h < 10) return 'Bonjour, on choisit ton cap du matin ?';
  return 'Belle matinée, quelle est ta priorité de clarté ?';
}

export async function shouldTriggerMorningDew(now = new Date()): Promise<boolean> {
  const h = now.getHours();
  if (h < 6 || h >= 10) return false;
  await getTrankilV2UserStats();
  return true;
}

export async function pickMorningDewItems(): Promise<MorningDewPick> {
  const all = await listTrankilV2Intentions();
  const open = all.filter((i) => i.status !== 'DONE');
  const task = open.find((i) => i.type === 'TASK') ?? null;
  const habit = open.find((i) => i.type === 'HABIT') ?? null;
  const inspiration =
    open.find((i) => i.type === 'PROJECT') ??
    open.find((i) => i.type === 'NOTE') ??
    null;
  return { task, habit, inspiration };
}

export async function applyMorningFocusChoice(itemId: string, now = new Date()): Promise<void> {
  await setMorningFocusSelection(itemId, dateKeyLocal(now));
  await updateGrowth(5);
}

