export const SEASON_FLOWERS = {
  winter: { type: 'perce_neige', glyph: '🌼', label: 'Perce-neige' },
  spring: { type: 'tulipe', glyph: '🌷', label: 'Tulipe' },
  summer: { type: 'tournesol', glyph: '🌻', label: 'Tournesol' },
  autumn: { type: 'chrysantheme', glyph: '🌸', label: 'Chrysantheme' },
} as const;

export function flowerTypeForMonth(monthIndex0: number): string {
  if (monthIndex0 <= 2) return SEASON_FLOWERS.winter.type;
  if (monthIndex0 <= 5) return SEASON_FLOWERS.spring.type;
  if (monthIndex0 <= 8) return SEASON_FLOWERS.summer.type;
  return SEASON_FLOWERS.autumn.type;
}

export function flowerGlyphForType(type: string): string {
  const entry = Object.values(SEASON_FLOWERS).find((f) => f.type === type);
  return entry?.glyph ?? '🌸';
}

export function flowerLabelForType(type: string): string {
  const entry = Object.values(SEASON_FLOWERS).find((f) => f.type === type);
  return entry?.label ?? 'Fleur';
}

function svgForFlower(type: string): string {
  if (type === 'tulipe') {
    return `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='#fff8f4'/><circle cx='64' cy='62' r='26' fill='#ef4444'/><rect x='60' y='72' width='8' height='28' fill='#2f6f6b'/></svg>`;
  }
  if (type === 'tournesol') {
    return `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='#fffbe8'/><circle cx='64' cy='56' r='28' fill='#facc15'/><circle cx='64' cy='56' r='12' fill='#a16207'/><rect x='60' y='72' width='8' height='28' fill='#2f6f6b'/></svg>`;
  }
  if (type === 'chrysantheme') {
    return `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='#fff6fb'/><circle cx='64' cy='58' r='26' fill='#ec4899'/><rect x='60' y='72' width='8' height='28' fill='#2f6f6b'/></svg>`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='#f5fbff'/><circle cx='64' cy='58' r='24' fill='#93c5fd'/><rect x='60' y='72' width='8' height='28' fill='#2f6f6b'/></svg>`;
}

export function flowerImageUri(type: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgForFlower(type))}`;
}

