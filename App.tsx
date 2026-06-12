import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, LogBox, View, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';

import { bootstrapTrankilV2Database, cleanOldArchives } from './src/api';
// DEPRECATED — nudge « 2 minutes disponibles » retiré (voir nettoyage-code-mort.md)
// import { AvailabilityNudgeModal } from './src/components/AvailabilityNudgeModal';
// TODO: supprimer ce commentaire + réactiver l’import quand la modale « Rituel des étoiles » sera retirée ou réécrite.
// import { EveningStarModal } from './src/components/EveningStarModal';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { IntentionSyncBootstrap } from './src/components/IntentionSyncBootstrap';
import { OfflineFirstPendingBootstrap } from './src/components/OfflineFirstPendingBootstrap';
import { SentinelBootstrap } from './src/components/SentinelBootstrap';
import { StartupPerfBanner } from './src/components/StartupPerfBanner';
import { SystemHealthBanner } from './src/components/SystemHealthBanner';
import { AllyProvider } from './src/context/AllyContext';
import { CalendarIntegrationProvider } from './src/context/CalendarIntegrationContext';
import { DebugUnlockProvider } from './src/context/DebugUnlockContext';
import { FocusProtectionProvider } from './src/context/FocusProtectionContext';
import { IntentionProvider } from './src/context/IntentionContext';
import { CapturePresentationProvider } from './src/context/CapturePresentationContext';
import { GlobalCaptureOverlay } from './src/components/GlobalCaptureOverlay';
import { LanguageProvider } from './src/context/LanguageContext';
import { PowerProvider } from './src/context/PowerContext';
import { SaturationProvider, useSaturation } from './src/context/SaturationContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { UserSpectrumProvider } from './src/context/UserSpectrumContext';
import { appLinking } from './src/navigation/linking';
import { RootNavigator } from './src/navigation/RootNavigator';
import { rootNavigationRef } from './src/navigation/rootNavigationRef';
// DEPRECATED — voir nettoyage-code-mort.md
// import { recordAppInteraction } from './src/services/AvailabilityTimer';
import { configureCaptureBackgroundTask } from './src/services/CaptureProcessingService';
import { initializeGeminiEngine } from './src/services/initializeGeminiEngine';
import { scheduleGeminiForegroundRemoteConfigRefresh } from './src/services/geminiRemoteModelSteering';
import { requestBackgroundExecutionPermissions } from './src/services/PermissionService';
import { navigationThemeFromPaper } from './src/theme/paperTheme';

LogBox.ignoreLogs(['Method readAsStringAsync imported from "expo-file-system" is deprecated']);

/** `NavigationContainer` + deep linking + `RootNavigator` (hors providers). */
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

/**
 * Racine React : bootstrap Gemini, BackgroundFetch capture, permissions, SQLite (avec fallback 1,2s),
 * empilement des providers puis `IntentionProvider` → navigation.
 * Voir `PROJECT_STATUS.md` §1.1.
 */
export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    void initializeGeminiEngine();
    void configureCaptureBackgroundTask();
    void requestBackgroundExecutionPermissions();

    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      if (prev.match(/inactive|background/) && nextState === 'active') {
        scheduleGeminiForegroundRemoteConfigRefresh();
      }
      appStateRef.current = nextState;
    });

    let disposed = false;
    const fallbackTimer = setTimeout(() => {
      if (!disposed) setDbReady(true);
    }, 1200);

    void (async () => {
      try {
        await bootstrapTrankilV2Database();
        const { ensureSentinelTripsSchema } = await import('./src/services/traffic/sentinelActivation');
        await ensureSentinelTripsSchema();
      } catch {}
      if (disposed) return;
      clearTimeout(fallbackTimer);
      setDbReady(true);
      try {
        await cleanOldArchives();
      } catch {}
    })();

    return () => {
      disposed = true;
      clearTimeout(fallbackTimer);
      appStateSub.remove();
    };
  }, []);

  if (!dbReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={{ flex: 1, backgroundColor: '#ffffff' }} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1 }}>
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
                                <SentinelBootstrap />
                              <OfflineFirstPendingBootstrap />
                              <SystemHealthBanner />
                              {/* TODO: supprimer ce bloc commenté + réimporter EveningStarModal si la modale « Rituel des étoiles » revient. */}
                              {/* <EveningStarModal /> */}
                              {/* DEPRECATED: AvailabilityNudgeModal — nettoyage-code-mort.md */}
                              <IntentionProvider>
                                <CapturePresentationProvider>
                                  <AppNavigation />
                                  <GlobalCaptureOverlay />
                                </CapturePresentationProvider>
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

/** Overlay plein écran quand le mode saturation (multiplier) est actif. */
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

/** Style barre de statut aligné sur le thème Paper clair/sombre. */
function StatusBarRoot() {
  const theme = useTheme();
  return <StatusBar style={theme.dark ? 'light' : 'dark'} />;
}
