import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { DataProvider } from './src/context/DataContext';
import { FocusTimerProvider } from './src/context/FocusTimerContext';
import { NotificationsProvider } from './src/context/NotificationsContext';
import { StudyReceiptsProvider } from './src/context/StudyReceiptContext';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <DataProvider>
            <FocusTimerProvider>
              <StudyReceiptsProvider>
                <NotificationsProvider>
                  <StatusBar style="dark" />
                  <AppNavigator />
                </NotificationsProvider>
              </StudyReceiptsProvider>
            </FocusTimerProvider>
          </DataProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
