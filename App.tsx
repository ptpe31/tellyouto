import React from 'react';

import { I18nProvider } from './i18n';
import { MainNavigator } from './navigation/MainNavigator';

export default function App() {
  return (
    <I18nProvider initialLocale="en">
      <MainNavigator />
    </I18nProvider>
  );
}
