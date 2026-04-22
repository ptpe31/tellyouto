import '../src/api/firebaseIndexedDbGuard';
import 'react-native-gesture-handler';
import 'react-native-worklets';
import 'react-native-reanimated';
import '../src/services/performance';
import '../src/locales/i18n';
import '../src/services/backgroundTasks';

import * as SplashScreen from 'expo-splash-screen';
import { registerRootComponent } from 'expo';

void SplashScreen.preventAutoHideAsync().catch(() => {});

import App from './App';

registerRootComponent(App);
