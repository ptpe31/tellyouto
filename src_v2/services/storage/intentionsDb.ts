import { withLocalDatabase } from '../offline/localDb';

export type PhoenixIntentionStatus = 'DRAFT' | 'VALIDATED';

export type PhoenixIntentionRow = {
  id: string;
  transcript: string;
  title: string;
  predicted_type: string;
  status: PhoenixIntentionStatus;
  payload_json: string;
  created_at: number;
};

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await withLocalDatabase(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS phoenix_intentions (
        id TEXT PRIMARY KEY NOT NULL,
        transcript TEXT NOT NULL,
        title TEXT NOT NULL,
        predicted_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_phoenix_intentions_created_at
        ON phoenix_intentions (created_at DESC);
    `);
  });
  tableReady = true;
}

export async function insertPhoenixIntentionDraft(params: {
  id: string;
  transcript: string;
  title: string;
  predictedType: string;
  status: PhoenixIntentionStatus;
  payloadJson: string;
}): Promise<void> {
  await ensureTable();
  const now = Date.now();
  await withLocalDatabase(async (db) => {
    await db.runAsync(
      `INSERT INTO phoenix_intentions (id, transcript, title, predicted_type, status, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [params.id, params.transcript, params.title, params.predictedType, params.status, params.payloadJson, now],
    );
  });
}

export async function updatePhoenixIntention(
  id: string,
  patch: Partial<{
    title: string;
    predictedType: string;
    status: PhoenixIntentionStatus;
    payloadJson: string;
  }>,
): Promise<void> {
  await ensureTable();
  await withLocalDatabase(async (db) => {
    const row = await db.getFirstAsync<PhoenixIntentionRow>(`SELECT * FROM phoenix_intentions WHERE id = ?`, [id]);
    if (!row) return;
    await db.runAsync(
      `UPDATE phoenix_intentions SET title = ?, predicted_type = ?, status = ?, payload_json = ? WHERE id = ?`,
      [
        patch.title ?? row.title,
        patch.predictedType ?? row.predicted_type,
        patch.status ?? row.status,
        patch.payloadJson ?? row.payload_json,
        id,
      ],
    );
  });
}

export async function listPhoenixIntentions(params: { limit: number }): Promise<PhoenixIntentionRow[]> {
  await ensureTable();
  return withLocalDatabase(async (db) => {
    return await db.getAllAsync<PhoenixIntentionRow>(
      `SELECT * FROM phoenix_intentions ORDER BY created_at DESC LIMIT ?`,
      [Math.max(1, Math.min(500, params.limit))],
    );
  });
}

