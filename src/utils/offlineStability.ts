/**
 * Détection d’erreurs « réseau / serveur » pour bascule auto file offline (SPEC offline-first).
 * Logs `[OFFLINE-STABILITY]` : hors garde `__DEV__` pour rester visibles en build release.
 * Phases usuelles : enqueue auto, replay, `netinfo_online_null_reachable` (tentative chemin en ligne avec `isInternetReachable == null`).
 *
 * @module offlineStability
 */

function flattenErrorText(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name} ${e.message} ${e.stack ?? ''}`.toLowerCase();
  }
  return String(e ?? '').toLowerCase();
}

/**
 * Heuristique : coupure réseau, timeout, proxy indispo, 5xx, etc.
 * (Pas d’erreur métier / validation JSON côté client.)
 */
export function isLikelyNetworkOrServerError(e: unknown): boolean {
  const t = flattenErrorText(e);
  if (!t.trim()) return false;

  const needles = [
    'network request failed',
    'failed to fetch',
    'networkerror',
    'load failed',
    'fetch',
    'econnrefused',
    'econnreset',
    'etimedout',
    'enotfound',
    'socket',
    'aborted',
    'timeout',
    'timed out',
    '503',
    '502',
    '504',
    '524',
    '500',
    'bad gateway',
    'gateway timeout',
    'service unavailable',
    'net::err_',
    'nsurlerrordomain',
    'the internet connection appears to be offline',
    'connection reset',
    'connection refused',
  ];
  if (needles.some((n) => t.includes(n))) return true;

  if (e instanceof TypeError && (t.includes('fetch') || t.includes('network'))) return true;

  const code = typeof (e as { code?: unknown })?.code === 'string' ? String((e as { code: string }).code) : '';
  if (['ECONNABORTED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) return true;

  const status = (e as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;

  return false;
}

export function logOfflineStability(phase: string, detail?: Record<string, unknown>): void {
  const rest = detail && Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : '';
  console.log(`[OFFLINE-STABILITY] phase=${phase}${rest}`);
}

/**
 * Contrat offline-first (SPEC v34) : `isInternetReachable === null` n’impose pas la file
 * (faux négatifs fréquents) ; seul `false` force le mode hors ligne.
 */
export function isNetInfoConsideredOnline(state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}
