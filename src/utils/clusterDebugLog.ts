/** Basculer à `false` (ou supprimer ce fichier + imports) pour couper les logs stress-test. */
export const SMART_CLUSTER_DEBUG_LOGS = true;

export type SmartClusterDebugEntry = {
  id: string;
  title: string;
};

export function logSmartClusterTilePress(clusterLabel: string, items: SmartClusterDebugEntry[]): void {
  if (!SMART_CLUSTER_DEBUG_LOGS) return;
  console.log('****************************************************************');
  console.log(`[DEBUG] Cluster "${clusterLabel}" cliqué. Contenu (${items.length}) :`, items);
  console.log('****************************************************************');
}
