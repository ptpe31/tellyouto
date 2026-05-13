export type DealerSlot = { dx: number; dy: number };

const GAP = 12;

/**
 * Positions des centres de cartes (offset vs centre écran), format portrait `cw`×`ch`.
 * 2 : L / R · 3 : haut G/D + bas centre · 4 : grille 2×2 · 5+ : grille centrée.
 */
export function computeDealerBalletSlots(count: number, cw: number, ch: number): DealerSlot[] {
  if (count <= 0) return [];
  if (count === 1) return [{ dx: 0, dy: 0 }];

  const hx = (cw + GAP) / 2;
  const vy = (ch + GAP) / 2;

  if (count === 2) {
    return [
      { dx: -hx, dy: 0 },
      { dx: hx, dy: 0 },
    ];
  }
  if (count === 3) {
    return [
      { dx: -hx, dy: -vy },
      { dx: hx, dy: -vy },
      { dx: 0, dy: vy },
    ];
  }
  if (count === 4) {
    return [
      { dx: -hx, dy: -vy },
      { dx: hx, dy: -vy },
      { dx: -hx, dy: vy },
      { dx: hx, dy: vy },
    ];
  }

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const gridW = cols * cw + (cols - 1) * GAP;
  const gridH = rows * ch + (rows - 1) * GAP;
  const slots: DealerSlot[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const dx = -gridW / 2 + cw / 2 + col * (cw + GAP);
    const dy = -gridH / 2 + ch / 2 + row * (ch + GAP);
    slots.push({ dx, dy });
  }
  return slots;
}

/** Échelle portrait (100×140 ref) selon largeur d’écran. */
export function dealerPortraitMetrics(screenWidth: number): { cw: number; ch: number; density: number } {
  const density = Math.min(1.18, Math.max(0.86, screenWidth / 375));
  return { cw: Math.round(100 * density), ch: Math.round(140 * density), density };
}
