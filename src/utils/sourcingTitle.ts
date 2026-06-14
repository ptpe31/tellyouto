/** Hint machine (snake_case) issu d'un JSON vision intermédiaire. */
export function isSnakeCaseSourceHint(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(s);
}

/** Choisit un mot-clé document humain parmi les intents Pass 1. */
export function resolveDocumentSourceHint(intentsRaw: unknown[]): string | null {
  if (!Array.isArray(intentsRaw)) return null;
  for (const raw of intentsRaw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const hint = String((raw as Record<string, unknown>).source_hint ?? '').trim();
    if (hint && !isSnakeCaseSourceHint(hint)) return hint.slice(0, 48);
  }
  for (const raw of intentsRaw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const type = String(r.type ?? '').trim().toUpperCase();
    const content = String(r.content ?? r.title ?? r.destination ?? '').trim();
    if (type === 'TRIP' && content && !/^astrolab$/i.test(content)) {
      return content.slice(0, 48);
    }
    if (type === 'TASK' && content && content.length <= 48) {
      return content.slice(0, 48);
    }
  }
  return null;
}

export function isSourcingShellMetadata(metadataJson: string | null | undefined): boolean {
  if (!metadataJson || !String(metadataJson).trim()) return false;
  try {
    const root = JSON.parse(metadataJson) as Record<string, unknown>;
    return root.sourcing_shell === true;
  } catch {
    return false;
  }
}
