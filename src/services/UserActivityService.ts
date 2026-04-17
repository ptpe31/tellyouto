import {
  getDailyActivityStatsSeries,
  insertUserActivityLog,
  type UserActivityLogActionType,
} from '../api/trankilV2Db';

function dayKeyLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function logActivity(
  actionType: UserActivityLogActionType,
  pointsDelta: number,
  meta?: Record<string, unknown>,
): Promise<void> {
  const createdAt = Date.now();
  await insertUserActivityLog({
    created_at: createdAt,
    day_key: dayKeyLocal(createdAt),
    action_type: actionType,
    points_delta: Number.isFinite(pointsDelta) ? Math.round(pointsDelta) : 0,
    meta_json: JSON.stringify(meta ?? {}),
  });
}

export async function getDailyStatsSeries(daysCount: number): Promise<
  Array<{ dayKey: string; actionType: string; pointsTotal: number; actionsCount: number }>
> {
  const rows = await getDailyActivityStatsSeries(daysCount);
  return rows.map((row) => ({
    dayKey: row.day_key,
    actionType: row.action_type,
    pointsTotal: Number(row.points_total ?? 0),
    actionsCount: Number(row.actions_count ?? 0),
  }));
}
