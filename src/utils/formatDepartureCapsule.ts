/**
 * Chaîne Unicode « capsule » pour notifications / affichage texte du Contrat de Départ.
 * Exemple : [🟢 20:53 ———◉———— 21:08]
 */
export type DepartureCapsuleTripLike = Record<string, unknown> | null | undefined;

export type FormatCapsuleInput = {
  startMs: number;
  endMs: number;
  nowMs?: number;
  ratioD?: number;
  isLate?: boolean;
};

const TRACK_LEN = 11;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatHm(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function trafficEmoji(ratioD: number): string {
  const d = Number(ratioD);
  if (!Number.isFinite(d) || d < 1.1) return '🟢';
  if (d < 1.3) return '🟠';
  return '🔴';
}

function buildCapsuleTrack(nowMs: number, startMs: number, endMs: number): string {
  const bar = Array.from({ length: TRACK_LEN }, () => '—');
  const denom = Math.max(1, endMs - startMs);
  const x = clamp01((nowMs - startMs) / denom);
  const i = Math.max(0, Math.min(TRACK_LEN - 1, Math.round(x * (TRACK_LEN - 1))));
  bar[i] = '◉';
  return bar.join('');
}

export function resolveCapsuleTimesFromTrip(
  trip: DepartureCapsuleTripLike,
): { startMs: number; endMs: number; ratioD: number } | null {
  if (!trip) return null;
  const startMs = Number(trip.elastic_anchor_start_ms ?? trip.elastic_start_ms);
  const endMs = Number(trip.elastic_anchor_end_ms ?? trip.elastic_end_ms);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;
  const ratioRaw = Number(trip.elastic_degradation_ratio);
  const ratioD = Number.isFinite(ratioRaw) && ratioRaw > 0 ? ratioRaw : 1;
  return { startMs, endMs, ratioD };
}

/** Génère la capsule Unicode à partir de champs explicites ou d’un objet trip metadata. */
export function formatCapsule(input: FormatCapsuleInput | DepartureCapsuleTripLike): string {
  const resolved =
    input != null && typeof input === 'object' && 'startMs' in input && 'endMs' in input
      ? (input as FormatCapsuleInput)
      : (() => {
          const fromTrip = resolveCapsuleTimesFromTrip(input as DepartureCapsuleTripLike);
          if (!fromTrip) return null;
          return {
            startMs: fromTrip.startMs,
            endMs: fromTrip.endMs,
            ratioD: fromTrip.ratioD,
            nowMs: Date.now(),
          } satisfies FormatCapsuleInput;
        })();

  if (!resolved) return '[ ——◉—— ]';

  const nowMs = Number.isFinite(Number(resolved.nowMs)) ? Number(resolved.nowMs) : Date.now();
  const startMs = Number(resolved.startMs);
  const endMs = Number(resolved.endMs);
  const ratioD = Number.isFinite(Number(resolved.ratioD)) ? Number(resolved.ratioD) : 1;
  const isLateExplicit =
    'isLate' in resolved && resolved.isLate === true;
  const isLate =
    isLateExplicit || (Number.isFinite(endMs) && Number.isFinite(nowMs) && nowMs > endMs);

  const emoji = isLate ? '🔴' : trafficEmoji(ratioD);
  const track = buildCapsuleTrack(nowMs, startMs, endMs);
  return `[${emoji} ${formatHm(startMs)} ${track} ${formatHm(endMs)}]`;
}
