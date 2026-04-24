/**
 * Détection du message de liaison Rail (aligné sur `functions/src/railHandshake.ts`).
 */
export function isRailConnectionHandshakeMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/connecte[- ]moi à mon rail id\s*:/i.test(t)) return true;
  if (/^start-\S+$/i.test(t)) return true;
  return false;
}
