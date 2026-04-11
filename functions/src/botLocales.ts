/** Réponses bot (parallèle i18n app) — utilisées par la Cloud Function. */

export type BotLocale = 'fr' | 'en' | 'es' | 'de' | 'it' | 'ja' | 'zh';

const RAIL: Record<BotLocale, string> = {
  fr: "C'est sur ton Rail ! 🚀 Visualise-le ici : {{url}}",
  en: "It's on your Rail! 🚀 Open it here: {{url}}",
  es: '¡Está en tu Rail! 🚀 Ábrelo aquí: {{url}}',
  de: 'Liegt auf deinem Rail! 🚀 Hier öffnen: {{url}}',
  it: 'È sul tuo Rail! 🚀 Aprilo qui: {{url}}',
  ja: 'レールに載せました 🚀 こちら：{{url}}',
  zh: '已放到你的时间轨 🚀 在此查看：{{url}}',
};

const RECHARGE: Record<BotLocale, string> = {
  fr: "Ton quota messagerie est à zéro — recharge ici : {{url}}",
  en: 'Your messenger quota is empty — recharge here: {{url}}',
  es: 'Tu cupo de mensajería está a cero — recarga aquí: {{url}}',
  de: 'Dein Messenger-Kontingent ist leer — hier aufladen: {{url}}',
  it: 'Hai esaurito il quota messaggi — ricarica qui: {{url}}',
  ja: 'メッセンジャー枠がゼロです。こちらでチャージ：{{url}}',
  zh: '消息配额已用完 — 在此补充：{{url}}',
};

function normLocale(raw: string | undefined): BotLocale {
  const b = (raw ?? 'fr').split('-')[0]?.toLowerCase() ?? 'fr';
  if (
    b === 'fr' ||
    b === 'en' ||
    b === 'es' ||
    b === 'de' ||
    b === 'it' ||
    b === 'ja' ||
    b === 'zh'
  ) {
    return b;
  }
  return 'fr';
}

export function formatBotRailAck(locale: string | undefined, url: string): string {
  const k = normLocale(locale);
  return RAIL[k].replace('{{url}}', url);
}

export function formatBotRechargeAck(
  locale: string | undefined,
  url: string,
): string {
  const k = normLocale(locale);
  return RECHARGE[k].replace('{{url}}', url);
}
