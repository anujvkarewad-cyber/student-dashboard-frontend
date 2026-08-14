import type {
  Announcement,
  LeaderboardEntry,
  MentorFeedback,
  MentorNote,
  Stats,
  Student,
  StudyLog,
  StudyNote,
  WeeklyReport,
} from '../types';

const isoDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

export const mockStudent: Student = {
  success: true,
  studentId: 'UMP2407',
  studentName: 'Aarav Sharma',
  caLevel: 'CA Intermediate',
  group: 'Group I & II',
  email: 'aarav@example.com',
  phone: '+91 98••• ••210',
  joinedOn: '12 Jan 2025',
  attempt: 'September 2026',
  batch: 'Achievers 2.0',
  targetHours: 70,
};

export const mockStats: Stats = {
  streak: 18,
  todayHours: 4.5,
  weeklyHours: 31.5,
  monthlyHours: 126,
  totalHours: 684.5,
  averageHours: 5.3,
  totalEntries: 129,
  lastSubmission: isoDaysAgo(0),
  rank: 4,
  weeklyRank: 3,
  monthlyRank: 5,
  last7: [3.5, 5, 4, 6.5, 5.5, 2.5, 4.5],
};

export const mockStudyLog: StudyLog[] = [
  { date: isoDaysAgo(0), topic: 'Advanced Accounts, Taxation', hours: 4.5, proof: '' },
  { date: isoDaysAgo(1), topic: 'Corporate Law', hours: 2.5, proof: '' },
  { date: isoDaysAgo(2), topic: 'Cost & Management Accounting', hours: 5.5, proof: '' },
  { date: isoDaysAgo(3), topic: 'Taxation, Revision', hours: 6.5, proof: '' },
  { date: isoDaysAgo(4), topic: 'Advanced Accounts', hours: 4, proof: '' },
];

export const mockLeaderboard: LeaderboardEntry[] = [
  { rank: 1, studentId: 'UMP2189', studentName: 'Ishita Mehta', weeklyHours: 42, totalHours: 812, streak: 31, status: 'Excellent' },
  { rank: 2, studentId: 'UMP2311', studentName: 'Kabir Verma', weeklyHours: 38.5, totalHours: 744, streak: 24, status: 'Excellent' },
  { rank: 3, studentId: 'UMP2254', studentName: 'Meera Iyer', weeklyHours: 34, totalHours: 701, streak: 21, status: 'Good' },
  { rank: 4, studentId: 'UMP2407', studentName: 'Aarav Sharma', weeklyHours: 31.5, totalHours: 684.5, streak: 18, status: 'Good' },
  { rank: 5, studentId: 'UMP2338', studentName: 'Rohan Kulkarni', weeklyHours: 29, totalHours: 653, streak: 14, status: 'Good' },
  { rank: 6, studentId: 'UMP2415', studentName: 'Ananya Singh', weeklyHours: 27.5, totalHours: 618, streak: 11, status: 'Active' },
];

export const mockReports: WeeklyReport[] = [
  { weekOf: '03 – 09 Aug 2026', level: 'Excellent', weeklyHours: 36.5, streak: 18, rank: 3 },
  { weekOf: '27 Jul – 02 Aug 2026', level: 'Good', weeklyHours: 32, streak: 11, rank: 5 },
  { weekOf: '20 – 26 Jul 2026', level: 'Good', weeklyHours: 30.5, streak: 7, rank: 6 },
];

export const mockAnnouncements: Announcement[] = [
  {
    title: 'Sunday revision session',
    message: 'Live doubt-solving session starts at 10:00 AM. Keep your marked questions ready.',
    date: '14 Aug',
  },
  {
    title: 'New Taxation notes uploaded',
    message: 'Chapter-wise summary notes are now available in Study Material.',
    date: '12 Aug',
  },
];

export const mockMentorNotes: MentorNote[] = [
  {
    date: '13 Aug 2026',
    note: 'Consistency looks strong this week. Focus on one timed Law answer-writing session tomorrow.',
  },
];

export const mockStudyNotes: StudyNote[] = [
  { id: 'n1', title: 'AS 16 – Borrowing Costs', description: 'Concept summary and practice illustrations', date: '12 Aug', subject: 'Advanced Accounts', category: 'Accounting Standards' },
  { id: 'n2', title: 'Company Audit Checklist', description: 'Fast revision checklist', date: '10 Aug', subject: 'Auditing', category: 'Revision Notes' },
  { id: 'n3', title: 'Capital Gains Summary', description: 'Amendments applicable for Sep 2026', date: '08 Aug', subject: 'Taxation', category: 'Direct Tax' },
  { id: 'n4', title: 'Input Tax Credit Charts', description: 'Eligibility and blocked credits', date: '05 Aug', subject: 'Taxation', category: 'GST' },
  { id: 'n5', title: 'Directors – Quick Revision', description: 'Sections, limits and important cases', date: '01 Aug', subject: 'Corporate Law', category: 'Revision Notes' },
];

export const mockFeedback: MentorFeedback[] = [
  {
    id: 'f1',
    mentor: 'Ujjwal Pathak',
    date: '13 Aug 2026',
    time: '7:20 PM',
    message: 'Good improvement in daily hours. Keep the morning slot for your weakest chapter and revise it again at night.',
  },
];
