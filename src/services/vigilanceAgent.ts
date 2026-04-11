/**
 * Vigilance Agent — surveillance légère des signaux (rappels, anomalies).
 * Brancher sur notifications + file de sync plus tard.
 */
export type VigilanceSignal = {
  id: string;
  severity: 'info' | 'warn';
  message: string;
  at: number;
};

export async function pollVigilanceSignals(): Promise<VigilanceSignal[]> {
  return [];
}
