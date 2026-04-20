import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';
import { AllyProvider } from './src/context/AllyContext';
import { LanguageProvider } from './src/context/LanguageContext';
import { PowerProvider } from './src/context/PowerContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { FocusProtectionProvider } from './src/context/FocusProtectionContext';
import { IntentionSyncBootstrap } from './src/components/IntentionSyncBootstrap';
import { OfflineFirstPendingBootstrap } from './src/components/OfflineFirstPendingBootstrap';
import { StartupPerfBanner } from './src/components/StartupPerfBanner';
import { SystemHealthBanner } from './src/components/SystemHealthBanner';
import { MorningDewModal } from './src/components/MorningDewModal';
import { EveningStarModal } from './src/components/EveningStarModal';
import { AvailabilityNudgeModal } from './src/components/AvailabilityNudgeModal';
import { cleanOldArchives } from './src/api';
import { ensureGeminiRemoteModelInitialized } from './src/services/geminiRemoteModelSteering';
import { recordAppInteraction } from './src/services/AvailabilityTimer';
import { DebugUnlockProvider } from './src/context/DebugUnlockContext';
import { CalendarIntegrationProvider } from './src/context/CalendarIntegrationContext';
import { UserSpectrumProvider } from './src/context/UserSpectrumContext';
import { IntentionProvider } from './src/context/IntentionContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { BlurView } from 'expo-blur';
import { useSaturation, SaturationProvider } from './src/context/SaturationContext';
import { appLinking } from './src/navigation/linking';
import { RootNavigator } from './src/navigation/RootNavigator';
import { rootNavigationRef } from './src/navigation/rootNavigationRef';
import { requestBackgroundExecutionPermissions } from './src/services/PermissionService';
import { configureCaptureBackgroundTask } from './src/services/CaptureProcessingService';
import { navigationThemeFromPaper } from './src/theme/paperTheme';

LogBox.ignoreLogs([
  'Method readAsStringAsync imported from "expo-file-system" is deprecated',
]);

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
  useEffect(() => {
    void ensureGeminiRemoteModelInitialized();
    void configureCaptureBackgroundTask();
    void requestBackgroundExecutionPermissions();
    void cleanOldArchives();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View
          style={{ flex: 1 }}
          onTouchStart={() => {
            void recordAppInteraction();
          }}
        >
          <ErrorBoundary>
            <ThemeProvider>
              <LanguageProvider>
                <DebugUnlockProvider>
                  <AllyProvider>
                    <PowerProvider>
                    <UserSpectrumProvider>
                      <CalendarIntegrationProvider>
                      <SaturationProvider>
                      <FocusProtectionProvider>
                          <IntentionSyncBootstrap />
                          <OfflineFirstPendingBootstrap />
                          <SystemHealthBanner />
                          <MorningDewModal />
                          <EveningStarModal />
                          <AvailabilityNudgeModal />
                          <IntentionProvider>
                            <AppNavigation />
                          </IntentionProvider>
                          <StartupPerfBanner />
                          <StatusBarRoot />
                      </FocusProtectionProvider>
                      <SaturationOverlay />
                      </SaturationProvider>
                      </CalendarIntegrationProvider>
                    </UserSpectrumProvider>
                    </PowerProvider>
                  </AllyProvider>
                </DebugUnlockProvider>
              </LanguageProvider>
            </ThemeProvider>
          </ErrorBoundary>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function SaturationOverlay() {
  const { isSaturated } = useSaturation();
  if (!isSaturated) return null;
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(80,84,88,0.22)',
        }}
      />
      <BlurView
        pointerEvents="none"
        intensity={18}
        tint="dark"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
    </>
  );
}

function StatusBarRoot() {
  const theme = useTheme();
  return <StatusBar style={theme.dark ? 'light' : 'dark'} />;
}
