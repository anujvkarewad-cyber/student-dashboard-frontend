import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BlurView } from 'expo-blur';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { AddStudyLogScreen } from '../screens/AddStudyLogScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { DailyMcqScreen } from '../screens/DailyMcqScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { FocusTimerScreen } from '../screens/FocusTimerScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { McqPracticeScreen } from '../screens/McqPracticeScreen';
import { NotesScreen } from '../screens/NotesScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { NotePreviewScreen } from '../screens/NotePreviewScreen';
import { NoteSubjectScreen } from '../screens/NoteSubjectScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { StudyReceiptScreen } from '../screens/StudyReceiptScreen';
import { TrackerScreen } from '../screens/TrackerScreen';
import { notificationLink } from '../services/pushNotifications';
import { colors, radius } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const tabIcons: Record<keyof MainTabParamList, { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', idle: 'home-outline' },
  Tracker: { active: 'time', idle: 'time-outline' },
  Focus: { active: 'timer', idle: 'timer-outline' },
  Notes: { active: 'folder-open', idle: 'folder-open-outline' },
  Profile: { active: 'person', idle: 'person-outline' },
};

const MainTabs = () => (
  <Tabs.Navigator
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarHideOnKeyboard: true,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: '#8290A5',
      tabBarLabelPosition: 'below-icon',
      tabBarLabelStyle: styles.tabLabel,
      tabBarStyle: styles.tabBar,
      tabBarBackground: () => <BlurView intensity={85} tint="light" style={[StyleSheet.absoluteFill, styles.tabBarBlur]} />,
      tabBarItemStyle: styles.tabItem,
      tabBarIcon: ({ focused, color }) => {
        const icons = tabIcons[route.name] || { active: 'ellipse', idle: 'ellipse-outline' };
        return (
          <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
            <Ionicons name={focused ? icons.active : icons.idle} color={color} size={focused ? 21 : 20} />
          </View>
        );
      },
    })}
  >
    <Tabs.Screen name="Home" component={DashboardScreen} options={{ title: 'Home' }} />
    <Tabs.Screen name="Tracker" component={TrackerScreen} options={{ title: 'Tracker' }} />
    <Tabs.Screen name="Focus" component={FocusTimerScreen} options={{ title: 'Focus' }} />
    <Tabs.Screen name="Notes" component={NotesScreen} options={{ title: 'Material' }} />
    <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
  </Tabs.Navigator>
);

const Splash = () => (
  <View style={styles.splash}>
    <Image source={require('../../assets/icon.png')} style={styles.splashLogo} />
    <Text style={styles.splashTitle}>Ujjwal Pathak Mentorship</Text>
    <ActivityIndicator color={colors.primary} style={styles.splashLoader} />
  </View>
);

const navigationTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.canvas, primary: colors.primary, text: colors.ink, border: colors.border, card: colors.surface },
};

export const AppNavigator = () => {
  const { student, booting, backendMode } = useAuth();
  const { refreshAll, refreshNotes } = useData();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navigationReady, setNavigationReady] = useState(false);
  const requiresPasswordChange = Boolean(student?.forcePasswordChange && backendMode === 'live');

  const openPush = useCallback((notification: Notifications.Notification) => {
    if (!student || !navigationReady || !navigationRef.isReady()) return;
    const link = notificationLink(notification);
    if (link.includes('notes') || link.includes('material')) {
      refreshNotes().catch(() => undefined);
      navigationRef.navigate('Main', { screen: 'Notes' });
    } else if (link.includes('report')) {
      navigationRef.navigate('Reports');
    } else if (link.includes('tracker')) {
      navigationRef.navigate('Main', { screen: 'Tracker' });
    } else if (link.includes('mcq')) {
      navigationRef.navigate('DailyMcq');
    } else {
      navigationRef.navigate('Main', { screen: 'Home' });
    }
  }, [navigationReady, navigationRef, refreshNotes, student]);

  useEffect(() => {
    if (!student || backendMode !== 'live' || !navigationReady) return;
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const link = notificationLink(notification);
      if (link.includes('notes') || link.includes('material')) refreshNotes().catch(() => undefined);
      else refreshAll().catch(() => undefined);
    });
    const responded = Notifications.addNotificationResponseReceivedListener((response) => openPush(response.notification));
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      openPush(response.notification);
      Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    });
    return () => {
      received.remove();
      responded.remove();
    };
  }, [backendMode, navigationReady, openPush, refreshAll, refreshNotes, student]);

  if (booting) return <Splash />;

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme} onReady={() => setNavigationReady(true)}>
      <RootStack.Navigator
        screenOptions={{
          headerTitleStyle: { color: colors.ink, fontWeight: '800', fontSize: 17 },
          headerTintColor: colors.primary,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.canvas },
          contentStyle: { backgroundColor: colors.canvas },
          animation: 'slide_from_right',
        }}
      >
        {student ? requiresPasswordChange ? (
          <RootStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Required password change', headerBackVisible: false, gestureEnabled: false }} />
        ) : (
          <>
            <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <RootStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
            <RootStack.Screen name="StudyReceipt" component={StudyReceiptScreen} options={{ title: 'Study Receipt' }} />
            <RootStack.Screen name="DailyMcq" component={DailyMcqScreen} options={{ title: 'Daily MCQ Challenge' }} />
            <RootStack.Screen name="McqPractice" component={McqPracticeScreen} options={{ title: 'Unlimited MCQ Practice' }} />
            <RootStack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Weekly reports' }} />
            <RootStack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: 'Leaderboard' }} />
            <RootStack.Screen name="AddStudyLog" component={AddStudyLogScreen} options={{ title: 'Log study hours', presentation: 'modal', animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="NoteSubject" component={NoteSubjectScreen} options={({ route }) => ({ title: route.params.subject })} />
            <RootStack.Screen name="NotePreview" component={NotePreviewScreen} options={{ title: 'Protected note preview' }} />
            <RootStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Change password' }} />
          </>
        ) : (
          <>
            <RootStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Account recovery' }} />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  tabBar: { position: 'absolute', height: 74, paddingTop: 9, paddingBottom: 7, marginHorizontal: 12, marginBottom: 10, borderTopWidth: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.78)', overflow: 'hidden', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 9 },
  tabBarBlur: { borderRadius: radius.lg, overflow: 'hidden' },
  tabItem: { paddingVertical: 0 },
  tabLabel: { fontSize: 9, lineHeight: 12, fontWeight: '800', marginTop: 2 },
  tabIcon: { width: 38, height: 31, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: colors.primarySoft },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  splashLogo: { width: 84, height: 84, borderRadius: 25 },
  splashTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 16 },
  splashLoader: { marginTop: 24 },
});
