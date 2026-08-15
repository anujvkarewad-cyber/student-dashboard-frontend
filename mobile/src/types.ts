export type Student = {
  success?: boolean;
  message?: string;
  forcePasswordChange?: boolean;
  studentId: string;
  studentName: string;
  caLevel?: string;
  group?: string;
  email?: string;
  phone?: string;
  joinedOn?: string;
  attempt?: string;
  batch?: string;
  targetHours?: number;
};

export type Stats = {
  streak?: number;
  todayHours?: number;
  weeklyHours?: number;
  monthlyHours?: number;
  totalHours?: number;
  averageHours?: number;
  totalEntries?: number;
  lastSubmission?: string;
  rank?: number;
  weeklyRank?: number;
  monthlyRank?: number;
  last7?: number[];
};

export type StudyLog = {
  date: string;
  topic?: string;
  hours: number;
  proof?: string;
};

export type LeaderboardEntry = {
  rank: number;
  studentId: string;
  studentName: string;
  weeklyHours?: number;
  totalHours?: number;
  streak?: number;
  status?: string;
};

export type WeeklyReport = {
  weekOf: string;
  level?: string;
  weeklyHours?: number;
  streak?: number;
  rank?: number;
};

export type Announcement = {
  title: string;
  message?: string;
  body?: string;
  date?: string;
};

export type MentorNote = {
  date?: string;
  note: string;
};

export type StudyNote = {
  id: string;
  title: string;
  description?: string;
  date?: string;
  subject?: string;
  category?: string;
  fileId?: string;
  url?: string;
};

export type MentorFeedback = {
  id: string;
  mentor?: string;
  date?: string;
  time?: string;
  message: string;
};

export type ProofFile = {
  fileName: string;
  mimeType: string;
  base64: string;
};

export type StudyLogPayload = {
  date: string;
  hours: number;
  studiedAsPlanned: 'Yes' | 'No' | 'Maybe';
  reason: string;
  subjects: string;
  targetCompleted: string;
  tomorrowTarget: string;
  mentorSupport: string;
  proofFile: ProofFile | null;
};

export type ApiSuccess = {
  success: boolean;
  message?: string;
  proofUrl?: string;
};

export type AppRelease = {
  version: string;
  versionCode: number;
  minimumVersionCode?: number;
  apkUrl: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
  publishedAt?: string;
};

export type DashboardData = {
  stats: Stats;
  studyLog: StudyLog[];
  leaderboard: LeaderboardEntry[];
  reports: WeeklyReport[];
  announcements: Announcement[];
  mentorNotes: MentorNote[];
  studyNotes: StudyNote[];
  feedback: MentorFeedback[];
};
