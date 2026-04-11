import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

/** Intervalle occupé en minutes depuis minuit — aucun titre ni lieu (confidentialité). */
export type BusyIntervalMinutes = {
  startMinutes: number;
  endMinutes: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Demande l’accès aux calendriers (lecture seule).
 */
export async function requestCalendarPermissions(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

export async function getCalendarPermissionStatus(): Promise<Calendar.PermissionResponse> {
  return Calendar.getCalendarPermissionsAsync();
}

export type DeviceCalendarInfo = {
  id: string;
  title: string;
  source?: string;
};

/**
 * Liste les calendriers présents sur l’appareil (métadonnées locales uniquement).
 */
export async function listDeviceCalendars(): Promise<DeviceCalendarInfo[]> {
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return cals.map((c) => ({
    id: c.id,
    title: c.title,
    source: Platform.OS === 'ios' ? c.source?.name : undefined,
  }));
}

/**
 * Fusionne des intervalles qui se chevauchent (minutes depuis minuit, même jour).
 */
export function mergeBusyIntervals(
  intervals: BusyIntervalMinutes[],
): BusyIntervalMinutes[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMinutes - b.startMinutes);
  const out: BusyIntervalMinutes[] = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.startMinutes <= cur.endMinutes) {
      cur.endMinutes = Math.max(cur.endMinutes, n.endMinutes);
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

/**
 * Récupère les créneaux occupés pour la journée locale courante.
 * Ne retient que start/end (minutes) — pas de titre, pas d’export vers le cloud.
 */
export async function getTodayBusyIntervalsMinutes(): Promise<BusyIntervalMinutes[]> {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  if (status !== 'granted') return [];

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  if (calendars.length === 0) return [];

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + MS_PER_DAY);

  const ids = calendars.map((c) => c.id);
  const events = await Calendar.getEventsAsync(ids, start, end);

  const raw: BusyIntervalMinutes[] = [];
  for (const ev of events) {
    const sb = new Date(ev.startDate);
    const eb = new Date(ev.endDate);
    if (eb <= start || sb >= end) continue;
    const s = Math.max(sb.getTime(), start.getTime());
    const e = Math.min(eb.getTime(), end.getTime());
    const sm = minutesSinceMidnight(new Date(s));
    const em = minutesSinceMidnight(new Date(e));
    if (em > sm) {
      raw.push({ startMinutes: sm, endMinutes: em });
    }
  }

  return mergeBusyIntervals(raw);
}

/**
 * Indique si [aStart, aEnd] chevauche un intervalle occupé (minutes même jour).
 */
export function rangeOverlapsBusy(
  startMin: number,
  endMin: number,
  busy: BusyIntervalMinutes[],
): boolean {
  for (const b of busy) {
    if (startMin < b.endMinutes && endMin > b.startMinutes) return true;
  }
  return false;
}
