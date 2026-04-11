import * as Calendar from 'expo-calendar';
import type { Event } from 'expo-calendar';
import { Platform } from '../utils/rnPlatform';

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

function eventToDayInterval(
  ev: Event,
  dayStart: Date,
  dayEnd: Date,
): BusyIntervalMinutes | null {
  const sb = new Date(ev.startDate);
  const eb = new Date(ev.endDate);
  if (eb <= dayStart || sb >= dayEnd) return null;
  const s = Math.max(sb.getTime(), dayStart.getTime());
  const e = Math.min(eb.getTime(), dayEnd.getTime());
  const sm = minutesSinceMidnight(new Date(s));
  const em = minutesSinceMidnight(new Date(e));
  if (em <= sm) return null;
  return { startMinutes: sm, endMinutes: em };
}

export type TodayBusySplit = {
  /** Tous les créneaux des calendriers connectés — placement agent / collisions. */
  blocking: BusyIntervalMinutes[];
  /** Sous-ensemble dont le rail est visible — affichage Timeline uniquement. */
  visible: BusyIntervalMinutes[];
};

/**
 * Créneaux occupés pour aujourd’hui : `blocking` agrège uniquement les calendriers **connectés**.
 * `visible` = événements des calendriers connectés avec **railVisible** (masqués → bloquent quand même).
 */
export async function getTodayBusyIntervalsSplit(
  connectedCalendarIds: string[],
  railVisibleByCalendarId: Record<string, boolean>,
): Promise<TodayBusySplit> {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  if (status !== 'granted' || connectedCalendarIds.length === 0) {
    return { blocking: [], visible: [] };
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

  const events = await Calendar.getEventsAsync(
    connectedCalendarIds,
    dayStart,
    dayEnd,
  );

  const rawBlock: BusyIntervalMinutes[] = [];
  const rawVis: BusyIntervalMinutes[] = [];

  for (const ev of events) {
    const interval = eventToDayInterval(ev, dayStart, dayEnd);
    if (!interval) continue;
    rawBlock.push(interval);
    const calId = ev.calendarId;
    if (railVisibleByCalendarId[calId] === true) {
      rawVis.push(interval);
    }
  }

  return {
    blocking: mergeBusyIntervals(rawBlock),
    visible: mergeBusyIntervals(rawVis),
  };
}

/**
 * @deprecated Utiliser `getTodayBusyIntervalsSplit` avec les IDs connectés.
 * Comportement historique : tous les calendriers de l’appareil.
 */
export async function getTodayBusyIntervalsMinutes(): Promise<BusyIntervalMinutes[]> {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  if (status !== 'granted') return [];

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  if (calendars.length === 0) return [];

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

  const ids = calendars.map((c) => c.id);
  const events = await Calendar.getEventsAsync(ids, dayStart, dayEnd);

  const raw: BusyIntervalMinutes[] = [];
  for (const ev of events) {
    const interval = eventToDayInterval(ev, dayStart, dayEnd);
    if (interval) raw.push(interval);
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
