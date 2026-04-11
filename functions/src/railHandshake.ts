/**
 * Premier message de liaison Rail (aligné sur `buildWhatsAppRailDeepLink` côté app).
 * Ne doit pas créer d’intention — déclenche l’accueil Allié instantané.
 */
export function isRailConnectionHandshake(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /connecte[- ]moi à mon rail id\s*:/i.test(t);
}

/** Extrait un prénom du message « C'est X. » si présent. */
export function extractHandshakeFirstName(text: string): string | null {
  const m = text.match(/c'est\s+(.+?)\s*\./i);
  const n = m?.[1]?.trim();
  return n && n.length > 0 ? n : null;
}
