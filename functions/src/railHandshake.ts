/**
 * Premier message de liaison Rail (anciens messages longs + format court `Start-{deviceId}` WhatsApp).
 * Ne doit pas créer d’intention — déclenche l’accueil Allié instantané.
 */
export function isRailConnectionHandshake(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/connecte[- ]moi à mon rail id\s*:/i.test(t)) return true;
  if (/^start-\S+$/i.test(t)) return true;
  return false;
}

/** Extrait un prénom du message « C'est X. » si présent. */
export function extractHandshakeFirstName(text: string): string | null {
  const m = text.match(/c'est\s+(.+?)\s*\./i);
  const n = m?.[1]?.trim();
  return n && n.length > 0 ? n : null;
}
