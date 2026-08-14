export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  Main: undefined;
  Reports: undefined;
  Leaderboard: undefined;
  AddStudyLog: undefined;
  NoteSubject: { subject: string };
  NotePreview: { noteId: string };
  ChangePassword: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Tracker: undefined;
  Focus: undefined;
  Notes: undefined;
  Profile: undefined;
};
