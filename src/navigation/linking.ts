import * as Linking from 'expo-linking';

import { APP_SCHEME } from '../services/connectorLinks';

/**
 * Préfixes + mapping pour `tellyouto://radar` → onglet Radar, etc.
 */
export const appLinking = {
  prefixes: [
    Linking.createURL('/'),
    `${APP_SCHEME}://`,
  ],
  config: {
    screens: {
      Onboarding: 'onboarding',
      App: {
        screens: {
          Tabs: {
            screens: {
              Radar: 'radar',
              Timeline: 'timeline',
              Recharge: 'recharge',
            },
          },
        },
      },
    },
  },
};
