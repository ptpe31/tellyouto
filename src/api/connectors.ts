/**
 * Connecteurs multi-plateformes (calendrier, messagerie, tâches) — interfaces.
 */
export type ConnectorId = 'generic' | 'calendar' | 'mail' | 'tasks';

export type ConnectorStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

export interface PlatformConnector {
  id: ConnectorId;
  label: string;
  status: ConnectorStatus;
}

export const connectorRegistry: ConnectorId[] = [
  'calendar',
  'mail',
  'tasks',
  'generic',
];
