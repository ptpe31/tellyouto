/**
 * Calcul et formatage purs des créneaux de départ statiques TRIP.
 * Aucune dépendance SQLite / Sentinel.
 */

export type StaticDepartureWindow = {
  /** Départ confort (borne basse — partir plus tôt). */
  startDate: Date;
  /** Départ limite (borne haute — partir au plus tard). */
  endDate: Date;
};

function parseArrivalTime(input: Date | string): Date | null {
  if (input instanceof Date) {
    return Number.isFinite(input.getTime()) ? input : null;
  }
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function localeLanguage(locale: string): string {
  const raw = String(locale || '').trim();
  if (!raw) return 'en';
  const base = raw.split(/[-_]/)[0]?.toLowerCase();
  return base || 'en';
}

/**
 * Formate une heure de départ selon la locale :
 * - FR : « 7h30 »
 * - EN : « 7:30 AM »
 * - Autres : HH:mm 24 h via Intl
 */
export function formatDepartureTimeI18n(date: Date, locale: string): string | null {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;

  const lang = localeLanguage(locale);

  if (lang === 'fr') {
    const hour = date.getHours();
    const minute = date.getMinutes();
    const mm = String(minute).padStart(2, '0');
    return `${hour}h${mm}`;
  }

  if (lang === 'en') {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function departureWindowSeparator(locale: string): string {
  return localeLanguage(locale) === 'en' ? ' - ' : ' – ';
}

/**
 * Créneau statique : [départ confort … départ limite].
 * - borne haute (limite) = arrivée − durée standard
 * - borne basse (confort) = arrivée − durée × (1 + marge %)
 */
export function computeStaticDepartureWindow(
  arrivalTime: Date | string,
  standardDurationMin: number,
  marginPercent = 15,
): StaticDepartureWindow | null {
  const arrival = parseArrivalTime(arrivalTime);
  const durationMin = Number(standardDurationMin);
  const margin = Number(marginPercent);

  if (!arrival) return null;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;
  if (!Number.isFinite(margin) || margin < 0) return null;

  const arrivalMs = arrival.getTime();
  const durationMs = durationMin * 60_000;
  const endMs = arrivalMs - durationMs;
  const startMs = arrivalMs - durationMs * (1 + margin / 100);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

  return {
    startDate: new Date(startMs),
    endDate: new Date(endMs),
  };
}

/** Chaîne unifiée ex. « 7h30 – 7h45 » (FR) ou « 7:30 AM - 7:45 AM » (EN). */
export function formatDepartureWindowI18n(
  window: StaticDepartureWindow | null | undefined,
  locale: string,
): string | null {
  if (!window) return null;

  const start = formatDepartureTimeI18n(window.startDate, locale);
  const end = formatDepartureTimeI18n(window.endDate, locale);
  if (!start || !end) return null;

  return `${start}${departureWindowSeparator(locale)}${end}`;
}
