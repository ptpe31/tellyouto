import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';
import { AllyProvider } from './src/context/AllyContext';
import { LanguageProvider } from './src/context/LanguageContext';
import { PowerProvider } from './src/context/PowerContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { FocusProtectionProvider } from './src/context/FocusProtectionContext';
import { IntentionSyncBootstrap } from './src/components/IntentionSyncBootstrap';
import { StartupPerfBanner } from './src/components/StartupPerfBanner';
import { SystemHealthBanner } from './src/components/SystemHealthBanner';
import { DebugUnlockProvider } from './src/context/DebugUnlockContext';
import { UserSpectrumProvider } from './src/context/UserSpectrumContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigationThemeFromPaper } from './src/theme/paperTheme';

function AppNavigation() {
  const theme = useTheme();
  return (
    <NavigationContainer theme={navigationThemeFromPaper(theme)}>
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <LanguageProvider>
            <DebugUnlockProvider>
              <AllyProvider>
                <PowerProvider>
                  <UserSpectrumProvider>
                    <FocusProtectionProvider>
                      <IntentionSyncBootstrap />
                      <SystemHealthBanner />
                      <AppNavigation />
                      <StartupPerfBanner />
                      <StatusBarRoot />
                    </FocusProtectionProvider>
                  </UserSpectrumProvider>
                </PowerProvider>
              </AllyProvider>
            </DebugUnlockProvider>
          </LanguageProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function StatusBarRoot() {
  const theme = useTheme();
  return <StatusBar style={theme.dark ? 'light' : 'dark'} />;
}
