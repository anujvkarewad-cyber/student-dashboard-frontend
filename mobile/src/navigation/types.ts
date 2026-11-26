import type { NavigatorScreenParams } from '@react-navigation/native';
import type { CaGroup } from '../utils/caGroups';

/**
 * v1.11.0 Reform release tabs:
 * Home (hub), Material (notes, as before), Timer (focus), Tracker, Profile.
 */
export type MainTabParamList = {
  Home: undefined;
  Material: undefined;
  Timer: undefined;
  Revision: undefined;
  Tracker: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Notifications: undefined;
  StudyReceipt: { sessionId: string };
  DailyMcq: { group?: CaGroup } | undefined;
  McqPractice: undefined;
  WrittenAnswer: undefined;
  Workbooks: undefined;
  Reports: undefined;
  Leaderboard: undefined;
  AddStudyLog: undefined;
  // v1.11.0 — reform feature screens
  Tests: undefined;
  MentorTest: { testId: string };
  NoteSubject: { subject: string };
  NotePreview: { noteId: string };
  DailyTarget: undefined;
  TestPlayer: { testId: string };
  TestPaper: { testId: string };
  TestResult: { resultId: string };
  WeeklyReport: undefined;
  Messages: undefined;
  Reminders: undefined;
  ChangePassword: undefined;
  // v1.17.0 — scheduled live quizzes (daily, group-wise)
  LiveQuizLobby: {
    testId: string;
    title: string;
    subject?: string | null;
    group?: string | null;
    windowStart: string;
    windowEnd: string;
    durationMinutes: number;
    questionCount: number;
    joiningCount?: number;
    /** Server clock at list time, used to correct device skew. */
    serverNow?: number;
  };
  LiveQuizPlayer: { testId: string };
  LiveQuizResult: { testId: string };
  LiveQuizReview: { testId: string };
};
