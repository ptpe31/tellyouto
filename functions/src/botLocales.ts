/** Réponses bot (parallèle i18n app) — utilisées par la Cloud Function. */

export type BotLocale = 'fr' | 'en' | 'es' | 'de' | 'it' | 'ja' | 'zh';

/** Accusé après une vraie intention (pas le handshake de liaison). */
const RAIL: Record<BotLocale, string> = {
  fr: "Bien reçu ! C'est ajouté. Regarde ton Rail ⚡️\n{{url}}",
  en: 'Got it! Added. Check your Rail ⚡️\n{{url}}',
  es: '¡Recibido! Está añadido. Mira tu Rail ⚡️\n{{url}}',
  de: 'Alles klar! Ist drauf. Schau auf deinen Rail ⚡️\n{{url}}',
  it: 'Ricevuto! È aggiunto. Guarda il Rail ⚡️\n{{url}}',
  ja: '受け取ったよ！追加済み。レールを見てね ⚡️\n{{url}}',
  zh: '收到！已添加。看看你的时间轨 ⚡️\n{{url}}',
};

/** Premier message de connexion au canal privé — réponse instantanée. */
const WELCOME_CONNECT: Record<BotLocale, string> = {
  fr:
    'Enchanté {{firstName}} ! Ton Rail est maintenant connecté à ce canal privé. 🛡️\n\n' +
    'Ici, je suis tes oreilles. Essaye tout de suite :\n' +
    '🎤 Envoie-moi un message vocal (ex: « Acheter du pain ce soir ») ou écris-moi une idée.\n\n' +
    'Radar : {{radarUrl}}\n' +
    'Temps : {{timelineUrl}}',
  en:
    'Nice to meet you, {{firstName}}! Your Rail is now linked to this private channel. 🛡️\n\n' +
    "I'm listening here. Try right away:\n" +
    '🎤 Send a voice note (e.g. “Buy bread tonight”) or type an idea.\n\n' +
    'Radar: {{radarUrl}}\n' +
    'Timeline: {{timelineUrl}}',
  es:
    '¡Encantado, {{firstName}}! Tu Rail ya está conectado a este canal privado. 🛡️\n\n' +
    'Aquí te escucho. Prueba ya:\n' +
    '🎤 Envía un audio (p. ej. «comprar pan esta noche») o escribe una idea.\n\n' +
    'Radar: {{radarUrl}}\n' +
    'Tiempo: {{timelineUrl}}',
  de:
    'Freut mich, {{firstName}}! Dein Rail ist jetzt mit diesem privaten Kanal verbunden. 🛡️\n\n' +
    'Hier höre ich zu. Probier’s gleich:\n' +
    '🎤 Sprachnachricht (z. B. „Brot heute Abend kaufen“) oder eine Idee schreiben.\n\n' +
    'Radar: {{radarUrl}}\n' +
    'Zeit: {{timelineUrl}}',
  it:
    'Piacere, {{firstName}}! Il tuo Rail è collegato a questo canale privato. 🛡️\n\n' +
    'Qui ti ascolto. Prova subito:\n' +
    '🎤 Un messaggio vocale (es. «comprare il pane stasera») o scrivi un’idea.\n\n' +
    'Radar: {{radarUrl}}\n' +
    'Tempo: {{timelineUrl}}',
  ja:
    '{{firstName}}、はじめまして！レールがこのプライベートチャネルにつながったよ 🛡️\n\n' +
    'ここでは耳を傾けるよ。すぐ試してね：\n' +
    '🎤 ボイス（例：「今夜パンを買う」）か、テキストでアイデアを。\n\n' +
    'レーダー：{{radarUrl}}\n' +
    'タイムライン：{{timelineUrl}}',
  zh:
    '{{firstName}}，很高兴认识你！你的时间轨已与此私人通道连接 🛡️\n\n' +
    '我在这里倾听。马上试试：\n' +
    '🎤 发语音（例如「今晚买面包」）或输入一个想法。\n\n' +
    '雷达：{{radarUrl}}\n' +
    '时间：{{timelineUrl}}',
};

/** Canal premium (WhatsApp / Slack / LINE) sans abonnement Pro. */
const PREMIUM_ONLY: Record<BotLocale, string> = {
  fr:
    'Désolé {{firstName}}, ce canal est réservé aux membres Pro. Continue notre conversation sur Telegram ou rejoins le club sur l’application !',
  en:
    'Sorry {{firstName}}, this channel is for Pro members only. Let’s continue on Telegram — or upgrade in the app!',
  es:
    'Lo siento {{firstName}}, este canal es solo para miembros Pro. Sigamos en Telegram o hazte Pro en la app.',
  de:
    'Sorry {{firstName}}, dieser Kanal ist nur für Pro-Mitglieder. Schreib mir auf Telegram — oder upgrade in der App!',
  it:
    'Mi dispiace {{firstName}}, questo canale è riservato ai membri Pro. Continua su Telegram o passa Pro nell’app!',
  ja:
    'ごめんね{{firstName}}、このチャネルはPro向けだよ。Telegramで続けよう — アプリでProに!',
  zh:
    '抱歉{{firstName}}，此通道仅面向 Pro 会员。请在 Telegram 继续，或在应用内订阅 Pro！',
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

export function formatBotPremiumChannelDenied(
  locale: string | undefined,
  firstName: string,
): string {
  const k = normLocale(locale);
  const name = firstName.trim() || (k === 'en' ? 'there' : 'toi');
  return PREMIUM_ONLY[k].replace(/\{\{firstName\}\}/g, name);
}

export function formatBotRailAck(locale: string | undefined, url: string): string {
  const k = normLocale(locale);
  return RAIL[k].replace('{{url}}', url);
}

export function formatBotWelcomeConnect(
  locale: string | undefined,
  firstName: string,
  radarUrl: string,
  timelineUrl: string,
): string {
  const k = normLocale(locale);
  return WELCOME_CONNECT[k]
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{radarUrl\}\}/g, radarUrl)
    .replace(/\{\{timelineUrl\}\}/g, timelineUrl);
}

export function formatBotRechargeAck(
  locale: string | undefined,
  url: string,
): string {
  const k = normLocale(locale);
  return RECHARGE[k].replace('{{url}}', url);
}
