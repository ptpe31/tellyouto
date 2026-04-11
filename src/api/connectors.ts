/**
 * Connecteurs externes (messagerie, webhooks) — transformation message → intention.
 */
import type { SpectrumWeights } from '../context/UserSpectrumContext';
import { computeIntentionPriority } from '../services/agentLogic';

export type ConnectorId =
  | 'generic'
  | 'calendar'
  | 'mail'
  | 'tasks'
  | 'whatsapp'
  | 'line';

export type ConnectorStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

/** Intention normalisée après parsing (priorité alignée sur agentLogic + spectre). */
export type ParsedIncomingIntention = {
  title: string;
  description: string;
  suggestedPriority: number;
};

export interface PlatformConnector {
  id: ConnectorId;
  /** Clé i18n pour le libellé (ex. connectors.whatsapp) */
  labelKey: string;
  /** Transforme un message brut en intention (titre, description, priorité suggérée). */
  parseMessageToIntention(
    raw: string,
    spectrum: SpectrumWeights,
  ): ParsedIncomingIntention;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Première ligne = titre ; sinon première phrase courte ; le reste = description. */
function splitTitleBody(raw: string): { title: string; description: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { title: '', description: '' };
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { title: lines[0]!, description: lines.slice(1).join('\n') };
  }
  const t = normalizeWhitespace(trimmed);
  const dot = t.match(/[.!?。！？]/);
  if (dot && dot.index !== undefined && dot.index > 0 && dot.index < 80) {
    return {
      title: t.slice(0, dot.index + 1).trim(),
      description: t.slice(dot.index + 1).trim(),
    };
  }
  if (t.length <= 56) return { title: t, description: '' };
  return { title: t.slice(0, 54).trim() + '…', description: t };
}

/**
 * Simulateur WhatsApp — texte libre, priorité via mots-clés + spectre.
 */
export const WhatsAppConnector: PlatformConnector = {
  id: 'whatsapp',
  labelKey: 'connectors.whatsapp',
  parseMessageToIntention(raw, spectrum) {
    const { title, description } = splitTitleBody(raw);
    const safeTitle = title || normalizeWhitespace(raw).slice(0, 80) || 'Intention';
    const desc = description;
    return {
      title: safeTitle,
      description: desc,
      suggestedPriority: computeIntentionPriority(safeTitle, desc, spectrum),
    };
  },
};

/**
 * Simulateur LINE — même logique de découpe, tonalité orientée messages courts.
 */
export const LineConnector: PlatformConnector = {
  id: 'line',
  labelKey: 'connectors.line',
  parseMessageToIntention(raw, spectrum) {
    const { title, description } = splitTitleBody(raw);
    const safeTitle =
      title || normalizeWhitespace(raw).slice(0, 80) || 'Intention';
    const desc = description;
    return {
      title: safeTitle,
      description: desc,
      suggestedPriority: computeIntentionPriority(safeTitle, desc, spectrum),
    };
  },
};

export const connectorRegistry: PlatformConnector[] = [
  WhatsAppConnector,
  LineConnector,
];

export function getConnectorById(
  id: ConnectorId,
): PlatformConnector | undefined {
  return connectorRegistry.find((c) => c.id === id);
}
