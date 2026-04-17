import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';

import {
  getTrankilV2IntentionById,
  type TrankilIntentType,
  updateTrankilV2IntentionCalendarSync,
} from '../api/trankilV2Db';

const DEFAULT_CALENDAR_KEY = '@tellyouto/default_calendar_id';

export type WritableCalendar = {
  id: string;
  title: string;
  color: string;
};

type MirrorInput = {
  intentionId: string;
  type: TrankilIntentType;
  title: string;
  dueDateYmd: string | null;
  metadataJson?: string;
  enabled: boolean;
  calendarId?: string | null;
};

function parseHabitRecurrence(metadataJson?: string): Calendar.RecurrenceRule | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as {
      recurrence_rule?: { frequency?: string; dayOfWeek?: number[]; interval?: number };
    };
    const rule = parsed.recurrence_rule;
    if (!rule) return null;
    const frequency = String(rule.frequency || '').toLowerCase();
    if (frequency === 'daily') {
      return { frequency: Calendar.Frequency.DAILY, interval: Math.max(1, Number(rule.interval || 1)) };
    }
    if (frequency === 'weekly') {
      return {
        frequency: Calendar.Frequency.WEEKLY,
        interval: Math.max(1, Number(rule.interval || 1)),
        daysOfTheWeek: Array.isArray(rule.dayOfWeek)
          ? rule.dayOfWeek
              .map((d) => Number(d))
              .filter((d) => Number.isFinite(d))
              .map((d) => ({ dayOfTheWeek: ((d % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 }))
          : undefined,
      };
    }
    if (frequency === 'monthly') {
      return { frequency: Calendar.Frequency.MONTHLY, interval: Math.max(1, Number(rule.interval || 1)) };
    }
  } catch {
    // ignore malformed metadata
  }
  return null;
}

function buildDates(dueDateYmd: string | null): { startDate: Date; endDate: Date; allDay: boolean } {
  if (!dueDateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30, 0, 0);
    return { startDate: start, endDate: end, allDay: false };
  }
  const [y, m, d] = dueDateYmd.split('-').map((v) => Number(v));
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { startDate: start, endDate: end, allDay: true };
}

export async function listWritableCalendars(): Promise<WritableCalendar[]> {
  const permission = await Calendar.getCalendarPermissionsAsync();
  if (permission.status !== 'granted') {
    const req = await Calendar.requestCalendarPermissionsAsync();
    if (req.status !== 'granted') return [];
  }
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars
    .filter((item) => item.allowsModifications)
    .map((item) => ({
      id: item.id,
      title: item.title || 'Calendar',
      color: item.color || '#64748b',
    }));
}

export async function getDefaultCalendarId(): Promise<string | null> {
  const value = await AsyncStorage.getItem(DEFAULT_CALENDAR_KEY);
  return value || null;
}

export async function setDefaultCalendarId(calendarId: string): Promise<void> {
  await AsyncStorage.setItem(DEFAULT_CALENDAR_KEY, calendarId);
}

export async function syncIntentionCalendarMirror(input: MirrorInput): Promise<{
  synced: boolean;
  calendarName: string | null;
  eventId: string | null;
}> {
  const row = await getTrankilV2IntentionById(input.intentionId);
  if (!row) return { synced: false, calendarName: null, eventId: null };

  if (!input.enabled) {
    if (row.calendar_event_id) {
      try {
        await Calendar.deleteEventAsync(row.calendar_event_id);
      } catch {
        // already deleted in native calendar
      }
    }
    await updateTrankilV2IntentionCalendarSync(input.intentionId, {
      calendar_event_id: null,
      calendar_name: null,
      is_synced_calendar: 0,
    });
    return { synced: false, calendarName: null, eventId: null };
  }

  const calendars = await listWritableCalendars();
  const chosenId = input.calendarId || (await getDefaultCalendarId()) || calendars[0]?.id || null;
  const chosen = calendars.find((c) => c.id === chosenId) ?? null;
  if (!chosenId || !chosen) return { synced: false, calendarName: null, eventId: null };
  await setDefaultCalendarId(chosenId);

  const { startDate, endDate, allDay } = buildDates(input.dueDateYmd);
  const recurrenceRule =
    input.type === 'HABIT' ? parseHabitRecurrence(input.metadataJson || row.metadata_json) : null;
  const payload: Calendar.Event = {
    title: input.title,
    startDate,
    endDate,
    allDay,
    notes: input.type,
    recurrenceRule: recurrenceRule ?? undefined,
  } as Calendar.Event;

  let eventId: string | null = null;
  if (row.calendar_event_id) {
    try {
      await Calendar.updateEventAsync(row.calendar_event_id, payload);
      eventId = row.calendar_event_id;
    } catch {
      eventId = await Calendar.createEventAsync(chosenId, payload);
    }
  } else {
    eventId = await Calendar.createEventAsync(chosenId, payload);
  }

  await updateTrankilV2IntentionCalendarSync(input.intentionId, {
    calendar_event_id: eventId,
    calendar_name: chosen.title,
    is_synced_calendar: 1,
  });
  return { synced: true, calendarName: chosen.title, eventId };
}
