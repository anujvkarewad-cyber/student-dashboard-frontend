import React, { useEffect } from 'react';
import { clearAbandonedReceiptAudio } from './src/components/ReceiptVoiceButton';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AdaptiveProvider } from './src/context/AdaptiveContext';
import { AppUpdateProvider } from './src/context/AppUpdateContext';
import { AuthProvider } from './src/context/AuthContext';
import { DailyMcqProvider } from './src/context/DailyMcqContext';
import { DataProvider } from './src/context/DataContext';
import { FocusTimerProvider } from './src/context/FocusTimerContext';
import { McqBankProvider } from './src/context/McqBankContext';
import { McqPracticeProvider } from './src/context/McqPracticeContext';
import { NotificationsProvider } from './src/context/NotificationsContext';
import { ProgressSyncProvider } from './src/context/ProgressSyncContext';
import { StudyReceiptsProvider } from './src/context/StudyReceiptContext';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  useEffect(() => { clearAbandonedReceiptAudio().catch(() => undefined); }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppUpdateProvider>
            <DataProvider>
              <FocusTimerProvider>
                <StudyReceiptsProvider>
                  <McqBankProvider>
                    <AdaptiveProvider>
                      <DailyMcqProvider>
                        <McqPracticeProvider>
                          <ProgressSyncProvider>
                            <NotificationsProvider>
                              <StatusBar style="dark" />
                              <AppNavigator />
                            </NotificationsProvider>
                          </ProgressSyncProvider>
                        </McqPracticeProvider>
                      </DailyMcqProvider>
                    </AdaptiveProvider>
                  </McqBankProvider>
                </StudyReceiptsProvider>
              </FocusTimerProvider>
            </DataProvider>
          </AppUpdateProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
