/**
 * Routeur Pass 2 projet — mode Gemini par domaine.
 */
import type { UnifiedProjectBrief } from '../utils/projectBriefModel';

export type ProjectEnrichMode = 'PROJECT' | 'PROJECT_TRAVEL' | 'PROJECT_RENOVATION' | 'PROJECT_EVENT';

export function resolveProjectEnrichMode(brief: UnifiedProjectBrief | null | undefined): ProjectEnrichMode {
  if (!brief) return 'PROJECT';
  switch (brief.domain) {
    case 'travel':
      return 'PROJECT_TRAVEL';
    case 'renovation':
      return 'PROJECT_RENOVATION';
    case 'event':
      return 'PROJECT_EVENT';
    default:
      return 'PROJECT';
  }
}
