import {
  getEveningDoneSummaryToday,
  insertTrankilV2Intention,
  updateGrowth,
} from '../api/trankilV2Db';

function dateKeyLocal(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function shouldTriggerEveningRitual(
  now: Date,
  isCharging: boolean,
): Promise<boolean> {
  const h = now.getHours();
  const chargingWindow = h >= 20 || h < 4;
  if (isCharging) return chargingWindow;
  return h >= 22;
}

export async function getEveningRitualPayload(): Promise<{
  doneCount: number;
  victoryTitle: string | null;
}> {
  return getEveningDoneSummaryToday();
}

export async function completeEveningRitual(today: Date = new Date()): Promise<void> {
  void today;
}

export async function applyTomorrowPlanningBonus(rawText: string): Promise<void> {
  const title = rawText.trim();
  if (!title) return;
  await insertTrankilV2Intention({
    id: `eve_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'NOTE',
    title,
    content_raw: title,
    metadata_json: JSON.stringify({ planned_for: 'tomorrow', source: 'evening_ritual' }, null, 2),
    category_id: 'projets',
    status: 'TODO',
    is_organized: 0,
    created_at: Date.now(),
  });
  await updateGrowth(5);
}

export async function saveNightThought(rawText: string): Promise<void> {
  const title = rawText.trim();
  if (!title) return;
  await insertTrankilV2Intention({
    id: `night_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'NOTE',
    title,
    content_raw: title,
    metadata_json: JSON.stringify(
      { tag: 'NIGHT_THOUGHT', source: 'charging_evening_ritual' },
      null,
      2,
    ),
    category_id: 'zen',
    status: 'TODO',
    is_organized: 0,
    created_at: Date.now(),
  });
}

export async function grantChargingStarMaxBonus(): Promise<void> {
  await updateGrowth(10);
}

