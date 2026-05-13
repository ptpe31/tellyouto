/**
 * Point d’entrée Expo : charge i18n (`src/locales/i18n`) puis enregistre `App`.
 * Voir `PROJECT_STATUS.md` §1.1.
 */
import { registerRootComponent } from 'expo';

import 'react-native-gesture-handler';
import './src/locales/i18n';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
