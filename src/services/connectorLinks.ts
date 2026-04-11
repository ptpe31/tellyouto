import * as Linking from 'expo-linking';

import { DEBUG_BOT_NUMBER } from '../config/debugConfig';
import i18n from '../locales/i18n';
import type { AppLanguage } from '../context/LanguageContext';

/** Doit correspondre à `scheme` dans app.json */
export const APP_SCHEME = 'tellyouto';

export type AppDeepLinkTab = 'radar' | 'timeline' | 'recharge';

/**
 * Lien profond vers un onglet principal (ouvre l’app sur Radar, Timeline ou Recharge).
 */
export function buildAppDeepLink(tab: AppDeepLinkTab): string {
  return `${APP_SCHEME}://${tab}`;
}

/**
 * Lien WhatsApp (dev) avec message de liaison au Rail (prénom + identifiant appareil).
 */
export function buildWhatsAppRailDeepLink(
  firstName: string,
  userUid: string,
): string {
  const safeName = firstName.trim() || 'toi';
  const safeUid = userUid.trim();
  const message = `Hello ! C'est ${safeName}. Connecte-moi à mon Rail ID: ${safeUid}.`;
  return `https://wa.me/${DEBUG_BOT_NUMBER}?text=${encodeURIComponent(message)}`;
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
