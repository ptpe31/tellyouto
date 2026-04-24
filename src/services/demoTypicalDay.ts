import { insertCompletedIntention } from '../api/localDb';
import type { SpectrumWeights } from '../context/UserSpectrumContext';

export type DemoSessionSeed = {
  title: string;
  description: string;
  weights: SpectrumWeights;
  priority: number;
  estimated_duration: number;
  actual_duration: number;
  /** Heure locale du jour courant (0–23, minutes 0–59) pour completed_at / created_at */
  completedHour: number;
  completedMinute: number;
};

function todayTimestamp(hour: number, minute: number): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/**
 * Injecte 5 sessions « journée type » déjà terminées (démo stats / pitch).
 */
export async function seedDemoTypicalDay(
  platform_type: string,
  platform_user_id: string,
  sessions: DemoSessionSeed[],
): Promise<void> {
  const base = Date.now();
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const completedAt = todayTimestamp(s.completedHour, s.completedMinute);
    const createdAt = completedAt - Math.min(s.actual_duration, 90) * 60 * 1000;
    await insertCompletedIntention({
      id: `demo_typical_${base}_${i}`,
      title: s.title,
      description: s.description,
      priority: s.priority,
      weights: s.weights,
      platform_type,
      platform_user_id: platform_user_id || 'demo_local',
      created_at: createdAt,
      estimated_duration: s.estimated_duration,
      actual_duration: s.actual_duration,
      completed_at: completedAt,
    });
  }
}
