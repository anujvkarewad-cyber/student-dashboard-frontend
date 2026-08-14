import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Home: undefined;
  Tracker: undefined;
  Focus: undefined;
  Notes: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Notifications: undefined;
  Reports: undefined;
  Leaderboard: undefined;
  AddStudyLog: undefined;
  NoteSubject: { subject: string };
  NotePreview: { noteId: string };
  ChangePassword: undefined;
};
