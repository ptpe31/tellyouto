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
import { CalendarIntegrationProvider } from './src/context/CalendarIntegrationContext';
import { UserSpectrumProvider } from './src/context/UserSpectrumContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { appLinking } from './src/navigation/linking';
import { RootNavigator } from './src/navigation/RootNavigator';
import { rootNavigationRef } from './src/navigation/rootNavigationRef';
import { navigationThemeFromPaper } from './src/theme/paperTheme';

function AppNavigation() {
  const theme = useTheme();
  return (
    <NavigationContainer
      ref={rootNavigationRef}
      theme={navigationThemeFromPaper(theme)}
      linking={appLinking}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <ThemeProvider>
            <LanguageProvider>
              <DebugUnlockProvider>
                <AllyProvider>
                  <PowerProvider>
                  <UserSpectrumProvider>
                    <CalendarIntegrationProvider>
                    <FocusProtectionProvider>
                        <IntentionSyncBootstrap />
                        <SystemHealthBanner />
                        <AppNavigation />
                        <StartupPerfBanner />
                        <StatusBarRoot />
                    </FocusProtectionProvider>
                    </CalendarIntegrationProvider>
                  </UserSpectrumProvider>
                  </PowerProvider>
                </AllyProvider>
              </DebugUnlockProvider>
            </LanguageProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function StatusBarRoot() {
  const theme = useTheme();
  return <StatusBar style={theme.dark ? 'light' : 'dark'} />;
}
