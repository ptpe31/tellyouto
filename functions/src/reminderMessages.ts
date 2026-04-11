/** Textes courts pour montre — parallèle i18n app (connector.reminder*). */

export type ReminderLocale =
  | 'fr'
  | 'en'
  | 'es'
  | 'de'
  | 'it'
  | 'ja'
  | 'zh';

function normLocale(raw: string | undefined): ReminderLocale {
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

const TEMPLATES: Record<
  ReminderLocale,
  (p: {
    lead: number;
    title: string;
    firstName: string;
    url: string;
    urgent: boolean;
  }) => string
> = {
  fr: ({ lead, title, firstName, url, urgent }) =>
    `${urgent ? '🚨 ' : ''}Prochaine action dans ${lead} min : ${title}. Prêt, ${firstName} ? Consulte ton rail : ${url}`,
  en: ({ lead, title, firstName, url, urgent }) =>
    `${urgent ? '🚨 ' : ''}Next action in ${lead} min: ${title}. Ready, ${firstName}? Open your rail: ${url}`,
  es: ({ lead, title, firstName, url, urgent }) =>
    `${urgent ? '🚨 ' : ''}Próxima acción en ${lead} min: ${title}. ¿Listo, ${firstName}? Tu rail: ${url}`,
  de: ({ lead, title, firstName, url, urgent }) =>
    `${urgent ? '🚨 ' : ''}Nächste Aktion in ${lead} Min.: ${title}. Bereit, ${firstName}? Zum Rail: ${url}`,
  it: ({ lead, title, firstName, url, urgent }) =>
    `${urgent ? '🚨 ' : ''}Prossima azione tra ${lead} min: ${title}. Pronto, ${firstName}? Apri il rail: ${url}`,
  ja: ({ lead, title, firstName, url, urgent }) =>
    `${urgent ? '🚨 ' : ''}${lead}分後：${title}。${firstName}さん、準備は？ レール：${url}`,
  zh: ({ lead, title, firstName, url, urgent }) =>
    `${urgent ? '🚨 ' : ''}${lead}分钟后：${title}。${firstName}，准备好了吗？时间轨：${url}`,
};

export function formatProactiveReminderMessage(
  locale: string | undefined,
  params: {
    leadMin: number;
    title: string;
    firstName: string;
    deepLink: string;
    urgent: boolean;
  },
): string {
  const lng = normLocale(locale);
  const fn = params.firstName.trim() || (lng === 'fr' ? 'toi' : 'there');
  return TEMPLATES[lng]({
    lead: params.leadMin,
    title: params.title,
    firstName: fn,
    url: params.deepLink,
    urgent: params.urgent,
  });
}
