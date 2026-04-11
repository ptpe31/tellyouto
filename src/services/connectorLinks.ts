import * as Linking from 'expo-linking';

import type { AppLanguage } from '../context/LanguageContext';
import { DEBUG_BOT_NUMBER } from '../config/debugConfig';
import i18n from '../locales/i18n';

/** Nom du bot sans @ (EXPO_PUBLIC_TELEGRAM_BOT_USERNAME). */
export function getTelegramBotUsername(): string {
  const u = process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME?.trim();
  return u && u.length > 0 ? u.replace(/^@/, '') : 'TellYouToBot';
}

/**
 * Lien Telegram natif (`tg://`) avec `start` = identifiant appareil.
 * @see https://core.telegram.org/bots#deep-linking
 */
export function buildTelegramStartLink(userId: string): string {
  const bot = getTelegramBotUsername();
  const start = encodeURIComponent(userId.trim());
  return `tg://resolve?domain=${bot}&start=${start}`;
}

/** Numéro WhatsApp du bot (sans +) — EXPO_PUBLIC_WHATSAPP_BOT_NUMBER ou repli debug. */
export function getWhatsAppBotNumber(): string {
  const raw = process.env.EXPO_PUBLIC_WHATSAPP_BOT_NUMBER?.replace(/\D/g, '') ?? '';
  if (raw.length > 0) return raw;
  return DEBUG_BOT_NUMBER.replace(/\D/g, '');
}

/**
 * Lien WhatsApp de liaison : message court `Start-{deviceId}` (aligné webhook `railHandshake`).
 */
export function buildWhatsAppStartLink(userId: string): string {
  const num = getWhatsAppBotNumber();
  const text = `Start-${userId.trim()}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

/**
 * Lien WhatsApp (dev) avec message de liaison au Rail (prénom + identifiant appareil).
 * @deprecated Préférer `buildWhatsAppStartLink` pour la liaison catalogue ; conservé pour compat.
 */
export function buildWhatsAppRailDeepLink(
  firstName: string,
  userUid: string,
): string {
  const safeName = firstName.trim() || 'toi';
  const safeUid = userUid.trim();
  const message = `Hello ! C'est ${safeName}. Connecte-moi à mon Rail ID: ${safeUid}.`;
  return `https://wa.me/${getWhatsAppBotNumber()}?text=${encodeURIComponent(message)}`;
}

/** Doit correspondre à `scheme` dans app.json */
export const APP_SCHEME = 'tellyouto';

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

/** Parse `tellyouto://radar?from=…` (host = onglet). */
export function parseTellyoutoDeepLink(
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

/** Message d’accueil Allié pour Telegram (script prioritaire). */
export function getTelegramAllyWelcomeMessage(
  language: string,
  firstName: string,
  appLink: string,
): string {
  const lng = normalizeLang(language);
  const t = i18n.getFixedT(lng);
  const name =
    firstName.trim() ||
    (t('connector.defaultFirstName', { defaultValue: '' }) as string);
  return t('connector.telegramAllyWelcome', {
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
