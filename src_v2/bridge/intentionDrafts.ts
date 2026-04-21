import type { IntentionDraft } from '../types/intentionDraft';
import type { OneTapUniversalResult } from '../types/oneTap';
import { t } from '../i18n';

export function draftsFromOneTapV2(result: OneTapUniversalResult, transcript: string): IntentionDraft[] {
  const raw = transcript.trim();
  const title = result.title.trim() || raw.slice(0, 80) || t('DEFAULT_NOTE_TITLE');
  if (result.predictedType === 'TASK') {
    const y = result.data.dueDateYmd?.trim() ?? '';
    const hm = result.data.dueTimeHm?.trim() ?? '';
    const time = y && hm ? `${y}T${hm}:00.000Z` : hm || y || '';
    return [
      {
        kind: 'TASK',
        title,
        time,
        notes: (result.data.notes ?? raw).trim(),
      },
    ];
  }
  if (result.predictedType === 'HABIT' || result.predictedType === 'RECURRING_TASK') {
    const hm = result.data.preferredTimeHm?.trim() ?? '08:00';
    return [
      {
        kind: 'HABIT',
        title,
        time: hm || '08:00',
        frequency: result.predictedType === 'RECURRING_TASK' ? 'weekly' : 'daily',
      },
    ];
  }
  if (result.predictedType === 'ANNIVERSARY') {
    const personName = (result.data.personName ?? title).trim() || t('DEFAULT_BIRTHDAY_TITLE');
    const md = (result.data.monthDay ?? '').trim();
    const y = new Date().getFullYear();
    const iso = md.match(/^\d{2}-\d{2}$/)
      ? new Date(`${y}-${md}T09:00:00.000Z`).toISOString()
      : new Date().toISOString();
    return [
      {
        kind: 'BIRTHDAY',
        personName,
        age: null,
        date: iso,
        specialTasks: [],
      },
    ];
  }
  if (result.predictedType === 'LIST') {
    const items = result.data.listItems ?? [];
    const content = items.length ? items.map((x) => `- ${x}`).join('\n') : raw || title;
    return [{ kind: 'NOTE', title, content }];
  }
  const content = (result.data.memo ?? raw).trim() || title;
  return [{ kind: 'NOTE', title, content }];
}
