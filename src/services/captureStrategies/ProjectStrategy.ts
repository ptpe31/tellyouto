import type { GeminiExpertIntention } from '../GeminiExpert';
import { atomizeProject } from '../GeminiExpert';
import {
  buildProjectPlanPreview,
  type ProjectPlanPreview,
  persistGeminiExpertRows,
} from '../ProjectPlanFlowService';
import { cleanTranscriptText } from '../smartTitle';
import { logActivity } from '../UserActivityService';

export async function generateProjectPlanFromDeadline(params: {
  finalTranscript: string;
  deadlineText: string;
  parseDueDateFromText: (text: string) => string | null;
}): Promise<ProjectPlanPreview> {
  const cleanedDeadline = params.deadlineText.trim();
  const finalTranscript = params.finalTranscript.trim();
  if (!finalTranscript || !cleanedDeadline) {
    throw new Error('MISSING_PROJECT_INPUT');
  }
  const consolidatedPrompt = `Voici mon projet : ${cleanTranscriptText(finalTranscript)}. Je veux le terminer ${cleanedDeadline}. Genere un plan de taches structure en JSON.`;
  const expertRows = await atomizeProject(consolidatedPrompt);
  const deadlineYmd = params.parseDueDateFromText(cleanedDeadline);
  const normalizedRows = expertRows.map((row) => {
    if (row.type !== 'TASK') return row;
    return {
      ...row,
      metadata: {
        ...(row.metadata ?? {}),
        due_date: (() => {
          const fallback = String((row.metadata as { due_date?: unknown })?.due_date || '').trim();
          return deadlineYmd ?? (fallback || null);
        })(),
      },
    };
  });
  return buildProjectPlanPreview(finalTranscript, cleanedDeadline, normalizedRows);
}

export async function persistValidatedProjectPlan(params: {
  preview: ProjectPlanPreview;
  taskAlarmIndexes: number[];
  selectedTaskIndexes: number[];
  audioUri: string | null;
  status: 'TODO' | 'ARCHIVED';
  isOrganized: number;
}): Promise<void> {
  const { preview, taskAlarmIndexes, selectedTaskIndexes, audioUri, status, isOrganized } = params;
  await persistGeminiExpertRows(preview.rawInput, preview.rows, {
    taskAlarmIndexes,
    selectedTaskIndexes,
    audioUri,
    status,
    isOrganized,
  });
  void logActivity('PROJECT_CREATED', 0, {
    source: 'talk_debug_project_plan',
    selected_tasks: selectedTaskIndexes.length,
  });
}
