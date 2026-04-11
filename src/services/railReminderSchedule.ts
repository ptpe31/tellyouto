import {
  pushRailReminderWindowsToFirestore,
  type RailReminderWindowPayload,
} from '../api/userProfile';
import type { UserSpectrumState } from '../context/UserSpectrumContext';
import type { TimelineSlot } from './agentLogic';

function clampLead(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.min(60, Math.max(1, Math.round(n)));
}

/**
 * À partir du rail calculé (même logique que Timeline), publie les fenêtres de rappel UTC.
 */
export async function syncRailReminderScheduleFromSlots(
  slots: TimelineSlot[],
  now: Date,
  spectrum: UserSpectrumState,
): Promise<void> {
  const enabled = spectrum.messenger_reminders_enabled !== false;
  const lead = clampLead(
    spectrum.messenger_reminder_lead_minutes ?? 5,
  );
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

  if (!enabled) {
    await pushRailReminderWindowsToFirestore({
      windows: [],
      reminder_timezone: tz,
      messenger_reminders_enabled: false,
      messenger_reminder_lead_minutes: lead,
    });
    return;
  }

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const baseMs = midnight.getTime();
  const nowMs = now.getTime();

  const windows: RailReminderWindowPayload[] = [];

  for (const s of slots) {
    if (s.railVariant === 'micro_pastille') continue;
    const row = s.intention;
    if (row.status === 'done' || row.status === 'active') continue;

    const startMs = baseMs + s.startMinutes * 60 * 1000;
    const endMs = baseMs + s.endMinutes * 60 * 1000;
    if (endMs < nowMs) continue;

    const remindAtMs = startMs - lead * 60 * 1000;
    if (remindAtMs < nowMs - 3 * 60 * 1000) continue;

    windows.push({
      intentionId: row.id,
      title: row.title.slice(0, 200),
      urgent: !!row.user_forced_urgent,
      slotStartUtcMs: startMs,
      remindAtUtcMs: remindAtMs,
      leadMin: lead,
    });
  }

  await pushRailReminderWindowsToFirestore({
    windows,
    reminder_timezone: tz,
    messenger_reminders_enabled: true,
    messenger_reminder_lead_minutes: lead,
  });
}
