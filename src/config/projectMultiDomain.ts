/**
 * Feature flag — projets multi-domaine (brief générique, accordéon, auto Pass 2, peek).
 * Rollback : `EXPO_PUBLIC_PROJECT_MULTI_DOMAIN=0` dans `.env` puis `npx expo start -c`.
 */
export const PROJECT_MULTI_DOMAIN_ENABLED =
  process.env.EXPO_PUBLIC_PROJECT_MULTI_DOMAIN !== '0' &&
  process.env.EXPO_PUBLIC_PROJECT_MULTI_DOMAIN !== 'false';
