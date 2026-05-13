import type React from 'react';
import {
  BookOpen,
  Briefcase,
  Car,
  CircleDot,
  HeartPulse,
  Home,
  Plane,
  Rocket,
  ShoppingCart,
  StickyNote,
  Users,
  Wallet,
} from 'lucide-react-native';

/** Couleurs « Matérialisation » par code catégorie OneTap. */
export function dealerCategoryColor(categoryTag: string, predictedType: string): string {
  const up = String(categoryTag ?? '').trim().toUpperCase();
  const typ = String(predictedType ?? '').trim().toUpperCase();
  if (up === 'SHOP') return '#0d9488';
  if (up === 'HEALTH') return '#e11d48';
  if (up === 'WORK' || up === 'PRO') return '#4f46e5';
  if (up === 'TRAVEL') return '#0284c7';
  if (up === 'SOCIAL') return '#c026d3';
  if (up === 'FINANCE') return '#ca8a04';
  if (up === 'LEARN') return '#2563eb';
  if (up === 'HOME' || up === 'PERSO' || up === 'FAMILLE') return '#64748b';
  if (up === 'OTHER') return '#6b7280';
  if (typ === 'TRIP') return '#0284c7';
  if (typ === 'HABIT') return '#db2777';
  if (typ === 'LIST') return '#7c3aed';
  if (typ === 'PROJECT') return '#ea580c';
  if (typ === 'NOTE') return '#475569';
  return '#64748b';
}

export function dealerCategoryIcon(
  categoryTag: string,
  predictedType: string,
): React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }> {
  const up = String(categoryTag ?? '').trim().toUpperCase();
  const typ = String(predictedType ?? '').trim().toUpperCase();
  if (typ === 'NOTE') return StickyNote;
  if (typ === 'LIST') return BookOpen;
  if (typ === 'PROJECT') return Rocket;
  if (typ === 'HABIT') return CircleDot;
  if (typ === 'TRIP') return Car;
  if (up === 'SHOP') return ShoppingCart;
  if (up === 'HEALTH') return HeartPulse;
  if (up === 'WORK' || up === 'PRO') return Briefcase;
  if (up === 'TRAVEL') return Plane;
  if (up === 'SOCIAL') return Users;
  if (up === 'FINANCE') return Wallet;
  if (up === 'LEARN') return BookOpen;
  if (up === 'HOME' || up === 'PERSO' || up === 'FAMILLE') return Home;
  return Plane;
}
