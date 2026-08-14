import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BlurView } from 'expo-blur';
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { AddStudyLogScreen } from '../screens/AddStudyLogScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { FocusTimerScreen } from '../screens/FocusTimerScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { NotesScreen } from '../screens/NotesScreen';
import { NotePreviewScreen } from '../screens/NotePreviewScreen';
import { NoteSubjectScreen } from '../screens/NoteSubjectScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { TrackerScreen } from '../screens/TrackerScreen';
import { colors, radius } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const tabIcons: Record<keyof MainTabParamList, { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', idle: 'home-outline' },
  Tracker: { active: 'time', idle: 'time-outline' },
  Focus: { active: 'timer', idle: 'timer-outline' },
  Leaderboard: { active: 'trophy', idle: 'trophy-outline' },
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
      tabBarLabelStyle: styles.tabLabel,
      tabBarStyle: styles.tabBar,
      tabBarBackground: () => <BlurView intensity={85} tint="light" style={StyleSheet.absoluteFill} />,
      tabBarItemStyle: styles.tabItem,
      tabBarIcon: ({ focused, color }) => (
        <View style={[styles.tabIcon, focused && styles.tabIconActive, route.name === 'Focus' && styles.focusTabIcon]}>
          <Ionicons name={focused ? tabIcons[route.name].active : tabIcons[route.name].idle} color={route.name === 'Focus' ? '#FFFFFF' : color} size={route.name === 'Focus' ? 23 : focused ? 21 : 20} />
        </View>
      ),
    })}
  >
    <Tabs.Screen name="Home" component={DashboardScreen} options={{ title: 'Home' }} />
    <Tabs.Screen name="Tracker" component={TrackerScreen} options={{ title: 'Tracker' }} />
    <Tabs.Screen name="Focus" component={FocusTimerScreen} options={{ title: 'Focus' }} />
    <Tabs.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: 'Ranks' }} />
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
  const { student, booting } = useAuth();
  if (booting) return <Splash />;

  return (
    <NavigationContainer theme={navigationTheme}>
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
        {student ? (
          <>
            <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <RootStack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Weekly reports' }} />
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
  tabBar: { position: 'absolute', height: 73, paddingTop: 7, paddingBottom: 8, marginHorizontal: 12, marginBottom: 10, borderTopWidth: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.74)', overflow: 'hidden', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 9 },
  tabItem: { paddingVertical: 1 },
  tabLabel: { fontSize: 8, fontWeight: '800', marginTop: 1 },
  tabIcon: { width: 36, height: 31, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: colors.primarySoft },
  focusTabIcon: { width: 43, height: 38, borderRadius: 15, marginTop: -7, backgroundColor: colors.primary, shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 5 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  splashLogo: { width: 84, height: 84, borderRadius: 25 },
  splashTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 16 },
  splashLoader: { marginTop: 24 },
});
