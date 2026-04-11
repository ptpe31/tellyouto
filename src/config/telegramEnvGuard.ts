/**
 * En développement : rappel si aucun nom de bot public n’est défini (aligné sur TELEGRAM_BOT_NAME côté serveur).
 * Le jeton `TELEGRAM_BOT_TOKEN` ne doit jamais être dans le bundle client.
 */
export function assertTelegramPublicConfig(): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const name =
    process.env.EXPO_PUBLIC_TELEGRAM_BOT_NAME?.trim() ||
    process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME?.trim();
  if (!name) {
    console.error('Erreur : Token Telegram manquant');
  }
}

void assertTelegramPublicConfig();
