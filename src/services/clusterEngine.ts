import type { TrankilV2TimelineItemRow } from '../api';

/** Intention éligible au regroupement tactique (orphelines sans échéance, non terminées). */
export type OrphanClusterIntention = Pick<
  TrankilV2TimelineItemRow,
  'id' | 'due_date' | 'status' | 'category_id' | 'created_at' | 'display_title'
>;

export type OrphanClusterResult = {
  categoryId: string;
  count: number;
  representativeItems: string[];
  /** Lignes du groupe gagnant (même ordre que le regroupement). */
  items: TrankilV2TimelineItemRow[];
};

function normalizeClusterCategoryId(raw: string | null | undefined): string {
  const up = String(raw ?? '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) return up;
  return 'PERSO';
}

function isDueEmpty(row: TrankilV2TimelineItemRow): boolean {
  const v = String(row.due_date ?? '').trim();
  if (!v) return true;
  if (v.toLowerCase() === 'null') return true;
  return false;
}

function pickRepresentativeTitles(rows: TrankilV2TimelineItemRow[], max: number): string[] {
  const sorted = [...rows].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  const out: string[] = [];
  for (const r of sorted) {
    const title = String(r.display_title ?? '').trim();
    if (title && !out.includes(title)) out.push(title.slice(0, 80));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Choisit le cluster d’orphelins le plus pertinent : sans échéance, statut TODO,
 * groupés par `category_id` — priorité au plus grand groupe, puis au groupe
 * contenant l’intention la plus ancienne (`created_at` minimal).
 */
export function getBestOrphanCluster(intentions: TrankilV2TimelineItemRow[]): OrphanClusterResult | null {
  const orphans = intentions.filter((r) => r.status === 'TODO' && isDueEmpty(r));
  if (orphans.length === 0) return null;

  const groups = new Map<string, TrankilV2TimelineItemRow[]>();
  for (const row of orphans) {
    const key = normalizeClusterCategoryId(row.category_id);
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  let winnerKey = '';
  let winnerRows: TrankilV2TimelineItemRow[] = [];
  let bestCount = -1;
  let bestOldestMs = Infinity;

  for (const [key, rows] of groups) {
    const count = rows.length;
    const oldest = Math.min(...rows.map((r) => Number(r.created_at)));
    if (
      count > bestCount ||
      (count === bestCount && oldest < bestOldestMs) ||
      (count === bestCount && oldest === bestOldestMs && key < winnerKey)
    ) {
      bestCount = count;
      bestOldestMs = oldest;
      winnerKey = key;
      winnerRows = rows;
    }
  }

  if (!winnerRows.length) return null;

  console.log(`[CLUSTER-ENGINE] 🎯 Cluster sélectionné : ${winnerKey} avec ${winnerRows.length} items`);

  return {
    categoryId: winnerKey,
    count: winnerRows.length,
    representativeItems: pickRepresentativeTitles(winnerRows, 3),
    items: winnerRows,
  };
}
