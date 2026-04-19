import * as FileSystem from 'expo-file-system/legacy';
import Share from 'react-native-share';

import { insertTrankilV2Intention } from '../api/trankilV2Db';
import type { GeminiExpertIntention } from './GeminiExpert';
import { safeParseGeminiExpertRows } from './geminiResponseGuards';

export type ProjectPlanPreview = {
  projectTitle: string;
  rawInput: string;
  rows: GeminiExpertIntention[];
  selectedTaskIndexes: number[];
  taskAlarmIndexes: number[];
};

function newProjectEntityId(): string {
  return `tlk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

export function buildProjectPlanPreview(
  baseText: string,
  deadlineText: string,
  rows: GeminiExpertIntention[],
): ProjectPlanPreview {
  const taskCount = rows.filter((row) => row.type === 'TASK').length;
  const projectTitle =
    rows.find((row) => row.type === 'PROJECT')?.title?.trim() || baseText.slice(0, 80);
  const selectedTaskIndexes = Array.from({ length: taskCount }, (_, i) => i);
  let taskIdx = -1;
  const taskAlarmIndexes = rows
    .map((row) => {
      if (row.type !== 'TASK') return -1;
      taskIdx += 1;
      return Boolean((row.metadata as { suggest_alarm?: unknown })?.suggest_alarm)
        ? taskIdx
        : -1;
    })
    .filter((idx) => idx >= 0);
  return {
    projectTitle,
    rawInput: `${baseText}\nDeadline: ${deadlineText}`,
    rows,
    selectedTaskIndexes,
    taskAlarmIndexes,
  };
}

export function parseYyyyMmDd(input: string): Date | null {
  const raw = String(input || '').trim();
  if (!/^\d{8}$/.test(raw)) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6));
  const d = Number(raw.slice(6, 8));
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function formatDueDateShort(input: string): string {
  const date = parseYyyyMmDd(input);
  if (!date) return '--';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || undefined;
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(date);
  } catch {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}

export async function persistGeminiExpertRows(
  rawInput: string,
  rows: GeminiExpertIntention[],
  options?: {
    taskAlarmIndexes?: number[];
    selectedTaskIndexes?: number[];
    audioUri?: string | null;
    status?: 'TODO' | 'ARCHIVED';
    isOrganized?: number;
  },
): Promise<void> {
  const safeRows = safeParseGeminiExpertRows(rows);
  if (safeRows.length === 0) {
    throw new Error('GEMINI_ROWS_INVALID');
  }
  let currentParentId: string | null = null;
  let taskCursor = 0;
  const alarmSet = new Set(options?.taskAlarmIndexes ?? []);
  const selectedSet = new Set(options?.selectedTaskIndexes ?? []);
  for (const row of safeRows) {
    if (row.type === 'TASK' && selectedSet.size > 0 && !selectedSet.has(taskCursor)) {
      taskCursor += 1;
      continue;
    }
    const id = newProjectEntityId();
    if (row.type === 'PROJECT') currentParentId = id;
    const shouldSetAlarm = row.type === 'TASK' && alarmSet.has(taskCursor);
    const metadata = {
      ...(row.metadata ?? {}),
      ...(shouldSetAlarm ? { has_alarm: true } : {}),
      ...(options?.audioUri ? { source_audio_uri: options.audioUri } : {}),
    };
    if (row.type === 'TASK') taskCursor += 1;
    await insertTrankilV2Intention({
      id,
      type: row.type,
      title: row.title,
      due_date:
        row.type === 'TASK'
          ? String((row.metadata as { due_date?: unknown })?.due_date || '').trim() || null
          : null,
      content_raw: rawInput,
      metadata_json: JSON.stringify(metadata, null, 2),
      suggested_tags: JSON.stringify(
        row.suggested_category ? [row.suggested_category.trim()] : ['a_trier'],
      ),
      category_id: row.suggested_category || null,
      parent_id: row.type === 'PROJECT' ? null : currentParentId,
      status: options?.status ?? 'TODO',
      is_organized: options?.isOrganized ?? 0,
      complexity_level: 2,
      created_at: Date.now(),
    });
  }
}

export async function exportProjectPlanToIcs(preview: ProjectPlanPreview): Promise<void> {
  const taskRows = preview.rows.filter((row) => row.type === 'TASK');
  const selectedRows = taskRows.filter((_, idx) => preview.selectedTaskIndexes.includes(idx));
  if (!selectedRows.length) {
    throw new Error('Aucune tâche cochée');
  }
  const now = new Date();
  const nowUtcStamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TellYouTo//ProjectPlan//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  selectedRows.forEach((row, idx) => {
    const due = String((row.metadata as { due_date?: unknown })?.due_date || '').trim();
    const date = /^\d{8}$/.test(due)
      ? due
      : `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${Date.now()}-${idx}@tellyouto`);
    lines.push(`DTSTAMP:${nowUtcStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${date}`);
    lines.push(`SUMMARY:${row.title.replace(/\r?\n/g, ' ').slice(0, 180)}`);
    lines.push(`DESCRIPTION:Projet ${preview.projectTitle}`.slice(0, 240));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const ics = `${lines.join('\r\n')}\r\n`;
  const path = `${FileSystem.cacheDirectory}tellyouto-project-plan-debug.ics`;
  await FileSystem.writeAsStringAsync(path, ics, { encoding: FileSystem.EncodingType.UTF8 });
  await Share.open({
    url: path,
    type: 'text/calendar',
    failOnCancel: false,
    filename: 'tellyouto-project-plan-debug',
  });
}
