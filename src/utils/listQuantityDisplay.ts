/** Quantité affichée : base par personne × nombre de personnes (arrondi), sauf lignes non scalables. */
export function listItemDisplayQuantity(ir: Record<string, unknown>, numberOfPeople: number): number {
  const raw = Number(ir.baseQuantity ?? ir.qty ?? 0);
  const perPerson = Number.isFinite(raw) ? raw : 0;
  const people = Math.max(1, Math.round(Number(numberOfPeople)));
  if (ir.scalable === false) {
    return Math.round(perPerson);
  }
  return Math.round(perPerson * people);
}
