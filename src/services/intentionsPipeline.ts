import { randomUUID } from 'expo-crypto';

import { computeNewtonWindow } from './traffic/TrafficEngine';
import { getOrCreateViaUserId, withViaDb } from './db/Schema';

type CaptureSource = 'VOICE' | 'TEXT';

type OrchestrateInput = {
  source: CaptureSource;
  content: string;
  title?: string | null;
  dueAtMs?: number | null;
};

type OrchestrateResult = {
  coreIntentionId: string;
  coreType: string;
  viaTripId?: string;
};

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  white: '\u001b[37m',
};

function stars(label: string): string {
  return `${ANSI.bold}${ANSI.white}**************** ${label} ****************${ANSI.reset}`;
}

function clip(s: string, n = 260): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function inferTypeFromContent(content: string): string {
  const s = String(content || '').trim().toLowerCase();
  if (!s) return 'NOTE';
  if (/(trajet|arriver|arrivée|aller|vers)\b/.test(s)) return 'TRIP';
  if (/(todo|tâche|task|faire|do\b)/.test(s)) return 'TASK';
  if (/(habitude|routine|every day|quotidien)/.test(s)) return 'HABIT';
  return 'NOTE';
}

function inferCategoryForNote(content: string): string {
  const s = String(content || '').toLowerCase();
  if (/(travail|work|client|rdv|meeting)/.test(s)) return 'WORK';
  if (/(maison|home|famille|courses)/.test(s)) return 'HOME';
  return 'GENERAL';
}

function extractTripQuery(content: string): string {
  const s = String(content || '').trim();
  const m = s.match(/\b(?:vers|pour|à|a)\s+(.+)$/i);
  return (m?.[1] ?? s).trim();
}

export async function orchestrateNewIntention(input: OrchestrateInput): Promise<OrchestrateResult> {
  const content = String(input.content || '').trim();
  if (!content) {
    throw new Error('Empty content');
  }
  const userId = await getOrCreateViaUserId();
  const coreType = inferTypeFromContent(content);

  console.log(stars('[ NOUVELLE INTENTION ]'));
  console.log(
    `${ANSI.green}${ANSI.bold}🟢 CAPTURE${ANSI.reset} ${ANSI.dim}Source:${ANSI.reset} ${ANSI.cyan}${input.source}${ANSI.reset}`
  );
  console.log(`${ANSI.green}[CAPTURE]${ANSI.reset} ${clip(content)}`);

  let viaTripId: string | undefined;
  let meta: Record<string, unknown> = { source: input.source };

  if (coreType === 'TRIP') {
    const q = extractTripQuery(content);
    console.log(`${ANSI.blue}${ANSI.bold}🔵 MAPPING${ANSI.reset} ${ANSI.dim}TRIP${ANSI.reset}`);
    console.log(`${ANSI.blue}[MAPPING]${ANSI.reset} via_locations lookup: "${clip(q, 120)}"`);
    const { locationId, resolvedAddress } = await withViaDb(async (db) => {
      const found = await db.getFirstAsync<Record<string, unknown>>(
        `SELECT id, formatted_address
           FROM via_locations
          WHERE user_id = ?
            AND (LOWER(alias) = LOWER(?) OR formatted_address = ?)
          LIMIT 1`,
        [userId, q, q]
      );
      if (found?.id) {
        const id = String(found.id);
        const formatted = String(found.formatted_address ?? q);
        return { locationId: id, resolvedAddress: formatted, reused: true as const };
      }
      const id = randomUUID();
      const now = Date.now();
      await db.runAsync(
        `INSERT INTO via_locations (
          id, user_id, alias, formatted_address, place_id, lat, lng, created_at_ms, updated_at_ms, is_synced
        ) VALUES (?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, 0)`,
        [id, userId, q, now, now]
      );
      return { locationId: id, resolvedAddress: q, reused: false as const };
    });
    console.log(`${ANSI.blue}[MAPPING]${ANSI.reset} via_locations.id = ${locationId}`);

    const nowMs = Date.now();
    const durationSec = 25 * 60;
    const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(nowMs + 2 * 60 * 60 * 1000, durationSec);
    const tripId = randomUUID();

    await withViaDb(async (db) => {
      await db.runAsync(
        `INSERT INTO via_sentinel_trips (
          id, user_id, location_id, target_arrival_ms, status, sentinel_mode,
          last_traffic_duration_sec, internal_scan_count, next_check_at_ms, gate_prompted_at_ms, last_error_at_ms,
          t_optimiste_ms, t_pessimiste_ms, vigilance_status, created_at_ms, updated_at_ms, is_synced
        ) VALUES (
          ?, ?, ?, ?, 'ACTIVE', 'STATIC',
          ?, 0, NULL, NULL, NULL,
          ?, ?, 'VIGILANCE_BLUE', ?, ?, 0
        )`,
        [
          tripId,
          userId,
          locationId,
          nowMs + 2 * 60 * 60 * 1000,
          durationSec,
          tOptimisteMs,
          tPessimisteMs,
          nowMs,
          nowMs,
        ]
      );
    });

    viaTripId = tripId;
    meta = { ...meta, kind: 'TRIP', location_id: locationId, via_trip_id: tripId, destination: resolvedAddress };

    console.log(`${ANSI.magenta}${ANSI.bold}📊 NEWTON${ANSI.reset} ${ANSI.dim}TRIP${ANSI.reset}`);
    console.log(
      `${ANSI.magenta}[NEWTON]${ANSI.reset} Raw=${durationSec}s Stabilized=${durationSec}s | tOpt=${new Date(
        tOptimisteMs
      ).toLocaleTimeString()} tPes=${new Date(tPessimisteMs).toLocaleTimeString()}`
    );
  } else {
    console.log(`${ANSI.blue}${ANSI.bold}🔵 MAPPING${ANSI.reset} ${ANSI.dim}${coreType}${ANSI.reset}`);
    const category = inferCategoryForNote(content);
    console.log(`${ANSI.blue}[MAPPING]${ANSI.reset} Detected category: ${category}`);
    meta = { ...meta, kind: coreType, category };
  }

  const coreId = randomUUID();
  const now = Date.now();
  const title = (input.title ?? '').trim() || content.slice(0, 56) || coreType;
  const dueAtMs = input.dueAtMs == null ? null : input.dueAtMs;

  await withViaDb(async (db) => {
    await db.runAsync(
      `INSERT INTO core_intentions (
        id, user_id, type, title, content_raw, due_at_ms, status, metadata_json, created_at_ms, updated_at_ms, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 0)`,
      [coreId, userId, coreType, title, content, dueAtMs, JSON.stringify(meta), now, now]
    );
  });

  console.log(`${ANSI.yellow}${ANSI.bold}🟡 ENGINE/PERSISTENCE${ANSI.reset}`);
  console.log(
    `${ANSI.yellow}[CORE-INTENTION]${ANSI.reset} Type: ${coreType} | Content: "${clip(content, 180)}" | Saved to core_intentions (ID: ${coreId}).`
  );
  console.log(`${ANSI.yellow}[DB]${ANSI.reset} user_id=${userId} is_synced=0`);
  if (viaTripId) {
    console.log(`${ANSI.yellow}[DB]${ANSI.reset} via_sentinel_trips.id=${viaTripId}`);
  }
  console.log(stars('[ FIN ]'));

  return { coreIntentionId: coreId, coreType, viaTripId };
}

