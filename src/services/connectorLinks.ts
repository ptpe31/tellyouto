import * as Linking from 'expo-linking';

import type { AppLanguage } from '../context/LanguageContext';
import i18n from '../locales/i18n';


/** Doit correspondre à `scheme` dans app.json */
export const APP_SCHEME = 'talkndone';

export type AppDeepLinkTab = 'radar' | 'timeline' | 'recharge';

/**
 * Lien profond vers un onglet principal (ouvre l’app sur Radar, Timeline ou Recharge).
 * Ex. `buildAppDeepLink('radar', { from: 'whatsapp_init' })` pour la bannière de retour.
 */
export function buildAppDeepLink(
  tab: AppDeepLinkTab,
  query?: Record<string, string>,
): string {
  let url = `${APP_SCHEME}://${tab}`;
  if (query && Object.keys(query).length > 0) {
    url += `?${new URLSearchParams(query).toString()}`;
  }
  return url;
}

/** Parse `talkndone://radar?from=…` (host = onglet). */
export function parseTalkndoneDeepLink(
  url: string | null | undefined,
): { tab: string; query: Record<string, string> } | null {
  if (!url || !url.startsWith(`${APP_SCHEME}:`)) return null;
  try {
    const u = new URL(url);
    const tab = u.hostname;
    if (!tab) return null;
    return { tab, query: Object.fromEntries(u.searchParams.entries()) };
  } catch {
    return null;
  }
}


/**
 * URL utilisable dans les messages bots (copie manuelle si l’app messagerie n’est pas installée).
 */
export function getAppLinkForConnector(tab: AppDeepLinkTab = 'radar'): string {
  try {
    const u = Linking.createURL(tab, { scheme: APP_SCHEME });
    if (u.startsWith(`${APP_SCHEME}://`)) return u;
  } catch {
    /* repli */
  }
  return buildAppDeepLink(tab);
}

const SUPPORTED: AppLanguage[] = ['fr', 'en', 'es', 'de', 'it', 'ja', 'zh'];

function normalizeLang(lang: string): AppLanguage {
  const base = lang.split('-')[0]?.toLowerCase() ?? 'en';
  return (SUPPORTED.includes(base as AppLanguage) ? base : 'en') as AppLanguage;
}

/**
 * Message d’initialisation (à envoyer / afficher pour le canal privé), toutes langues via i18n.
 */
export function getBotInitializationMessage(
  language: string,
  firstName: string,
  appLink: string,
): string {
  const lng = normalizeLang(language);
  const t = i18n.getFixedT(lng);
  const name =
    firstName.trim() ||
    (t('connector.defaultFirstName', { defaultValue: '' }) as string);
  return t('connector.botWelcomeMessage', {
    firstName: name,
    appLink,
  }) as string;
}

/**
 * Réponse courte après intention (texte côté client — le backend duplique la logique pour l’envoi réel).
 */
export function getBotRailAckMessage(language: string, deepLink: string): string {
  const lng = normalizeLang(language);
  const t = i18n.getFixedT(lng);
  return t('connector.botRailAck', { url: deepLink }) as string;
}

export function getBotRechargeAckMessage(
  language: string,
  deepLink: string,
): string {
  const lng = normalizeLang(language);
  const t = i18n.getFixedT(lng);
  return t('connector.botRechargeRedirect', { url: deepLink }) as string;
}
