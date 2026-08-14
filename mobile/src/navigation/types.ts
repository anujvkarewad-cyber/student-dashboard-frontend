import type { NavigatorScreenParams } from '@react-navigation/native';
import type { CaGroup } from '../utils/caGroups';

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
  StudyReceipt: { sessionId: string };
  DailyMcq: { group?: CaGroup } | undefined;
  Reports: undefined;
  Leaderboard: undefined;
  AddStudyLog: undefined;
  NoteSubject: { subject: string };
  NotePreview: { noteId: string };
  ChangePassword: undefined;
};
