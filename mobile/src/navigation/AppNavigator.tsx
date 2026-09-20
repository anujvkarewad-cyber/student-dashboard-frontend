import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BlurView } from 'expo-blur';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { AiChatBot } from '../components/AiChatBot';
import { AddStudyLogScreen } from '../screens/AddStudyLogScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { DailyMcqScreen } from '../screens/DailyMcqScreen';
import { DailyTargetScreen } from '../screens/DailyTargetScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { FocusTimerScreen } from '../screens/FocusTimerScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { McqPracticeScreen } from '../screens/McqPracticeScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { NotesScreen } from '../screens/NotesScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { NotePreviewScreen } from '../screens/NotePreviewScreen';
import { NoteSubjectScreen } from '../screens/NoteSubjectScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { StudyReceiptScreen } from '../screens/StudyReceiptScreen';
import { TestPaperScreen } from '../screens/TestPaperScreen';
import { TestPlayerScreen } from '../screens/TestPlayerScreen';
import { TestResultScreen } from '../screens/TestResultScreen';
import { TestsScreen } from '../screens/TestsScreen';
import { TrackerScreen } from '../screens/TrackerScreen';
import { WeeklyReportScreen } from '../screens/WeeklyReportScreen';
import { notificationLink } from '../services/pushNotifications';
import { colors, radius } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const tabIcons: Record<keyof MainTabParamList, { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', idle: 'home-outline' },
  Material: { active: 'folder-open', idle: 'folder-open-outline' },
  Timer: { active: 'timer', idle: 'timer-outline' },
  Tracker: { active: 'time', idle: 'time-outline' },
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
    <Tabs.Screen name="Material" component={NotesScreen} options={{ title: 'Material' }} />
    <Tabs.Screen name="Timer" component={FocusTimerScreen} options={{ title: 'Timer' }} />
    <Tabs.Screen name="Tracker" component={TrackerScreen} options={{ title: 'Tracker' }} />
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

/**
 * v1.11.4 BULLETPROOF hardware BACK handling — the app NEVER exits on BACK.
 *  - Inside any stack screen (quiz, notes, result…) → normal back.
 *  - On a non-Home tab → BACK returns to Home.
 *  - On Home / root → BACK is swallowed with a gentle toast. The phone's
 *    back button can no longer throw the user out of the app; leaving the
 *    app is only possible with the phone's Home / recent-apps keys.
 */
const useAndroidBackFix = (navigationRef: ReturnType<typeof useNavigationContainerRef<RootStackParamList>>) => {
  useEffect(() => {
    const onBack = () => {
      const nav = navigationRef.current;
      // Splash / not ready: swallow the press too.
      if (!nav || !nav.isReady()) return true;
      // Anywhere a back stack exists → normal back navigation.
      if (nav.canGoBack()) {
        nav.goBack();
        return true;
      }
      // Root level: if a non-Home tab is focused, go Home first.
      const root = nav.getRootState() as
        | { index: number; routes: { name: string; state?: { index: number; routes: { name: string }[] } }[] }
        | undefined;
      const top = root?.routes?.[root?.index ?? 0];
      if (top?.name === 'Main') {
        const tabState = top.state;
        const currentTab = tabState?.routes?.[tabState.index ?? 0]?.name ?? 'Home';
        if (currentTab !== 'Home') {
          nav.navigate('Main', { screen: 'Home' });
          return true;
        }
      }
      // Home / root: NEVER exit — just inform the user.
      ToastAndroid.show('You are on the Home screen', ToastAndroid.SHORT);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [navigationRef]);
};

export const AppNavigator = () => {
  const { student, booting, backendMode } = useAuth();
  const { refreshAll, refreshNotes } = useData();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navigationReady, setNavigationReady] = useState(false);
  const requiresPasswordChange = Boolean(student?.forcePasswordChange && backendMode === 'live');
  useAndroidBackFix(navigationRef);

  const openPush = useCallback((notification: Notifications.Notification) => {
    if (!student || !navigationReady || !navigationRef.isReady()) return;
    const link = notificationLink(notification);
    if (link.includes('notes') || link.includes('material')) {
      refreshNotes().catch(() => undefined);
      navigationRef.navigate('Main', { screen: 'Material' });
    } else if (link.includes('report')) {
      navigationRef.navigate('Reports');
    } else if (link.includes('tracker')) {
      navigationRef.navigate('Main', { screen: 'Tracker' });
    } else if (link.includes('mcq')) {
      navigationRef.navigate('DailyMcq');
    } else if (link.includes('target')) {
      navigationRef.navigate('DailyTarget');
    } else if (link.includes('message')) {
      navigationRef.navigate('Messages');
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
    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      openPush(response.notification);
    });
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
            {/* v1.11.0 reform screens */}
            <RootStack.Screen name="Tests" component={TestsScreen} options={{ title: 'Tests' }} />
            <RootStack.Screen name="NoteSubject" component={NoteSubjectScreen} options={({ route }) => ({ title: route.params.subject })} />
            <RootStack.Screen name="NotePreview" component={NotePreviewScreen} options={{ title: 'Protected note preview' }} />
            <RootStack.Screen name="DailyTarget" component={DailyTargetScreen} options={{ title: "Today's Target" }} />
            <RootStack.Screen name="TestPlayer" component={TestPlayerScreen} options={() => ({ title: 'Test' })} />
            <RootStack.Screen name="TestPaper" component={TestPaperScreen} options={() => ({ title: 'Question Paper' })} />
            <RootStack.Screen name="TestResult" component={TestResultScreen} options={{ title: 'Result · Answer Key · Marking Scheme' }} />
            <RootStack.Screen name="WeeklyReport" component={WeeklyReportScreen} options={{ title: 'Weekly Report' }} />
            <RootStack.Screen name="Messages" component={MessagesScreen} options={{ title: 'Mentor Messages' }} />
            <RootStack.Screen name="Reminders" component={RemindersScreen} options={{ title: 'Reminders' }} />
            <RootStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Change password' }} />
          </>
        ) : (
          <>
            <RootStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Account recovery' }} />
          </>
        )}
      </RootStack.Navigator>
      {student && !requiresPasswordChange ? <AiChatBot /> : null}
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
