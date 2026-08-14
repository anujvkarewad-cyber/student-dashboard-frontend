import { config } from '../config';
import type {
  Announcement,
  ApiSuccess,
  LeaderboardEntry,
  MentorFeedback,
  MentorNote,
  Stats,
  Student,
  StudyLog,
  StudyLogPayload,
  StudyNote,
  WeeklyReport,
} from '../types';
import {
  mockAnnouncements,
  mockFeedback,
  mockLeaderboard,
  mockMentorNotes,
  mockReports,
  mockStats,
  mockStudent,
  mockStudyLog,
  mockStudyNotes,
} from './mockData';

type ApiEnvelope<T> = { result?: T; error?: string };

const wait = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let demoStats = clone(mockStats);
let demoLog = clone(mockStudyLog);

class ApiClient {
  private async call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      });

      let data: ApiEnvelope<T>;
      try {
        data = (await response.json()) as ApiEnvelope<T>;
      } catch {
        throw new Error('Server returned an unreadable response. Please try again.');
      }

      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status}).`);
      }
      if (data.error) throw new Error(data.error);
      return data.result as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('The server is taking too long to respond. Please try again.');
      }
      if (error instanceof TypeError) {
        throw new Error('Unable to connect. Check your internet connection and try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async validateLogin(studentId: string, password: string): Promise<Student> {
    if (!config.useMocks) return this.call<Student>('validateLogin', { studentId, password });
    await wait();
    if (studentId.toUpperCase() !== 'UMP2407' || password !== 'demo123') {
      return { ...clone(mockStudent), success: false, message: 'Use UMP2407 and demo123 in safe demo mode.' };
    }
    return clone(mockStudent);
  }

  async forgotPassword(studentId: string, email: string): Promise<ApiSuccess> {
    if (!config.useMocks) return this.call<ApiSuccess>('forgotPassword', { studentId, email });
    await wait();
    return { success: true, message: 'Demo OTP sent. Use 123456.' };
  }

  async verifyOTP(studentId: string, otp: string): Promise<ApiSuccess> {
    if (!config.useMocks) return this.call<ApiSuccess>('verifyOTP', { studentId, otp });
    await wait();
    return otp === '123456'
      ? { success: true }
      : { success: false, message: 'Use 123456 in demo mode.' };
  }

  async resetPassword(studentId: string, password: string): Promise<ApiSuccess> {
    if (!config.useMocks) return this.call<ApiSuccess>('resetPassword', { studentId, password });
    await wait();
    return { success: true };
  }

  async changePassword(studentId: string, currentPassword: string, newPassword: string): Promise<ApiSuccess> {
    if (!config.useMocks) {
      return this.call<ApiSuccess>('changePassword', { studentId, currentPassword, newPassword });
    }
    await wait();
    return { success: true };
  }

  async getStats(studentId: string): Promise<Stats> {
    if (!config.useMocks) return this.call<Stats>('getStats', { studentId });
    await wait(180);
    return clone(demoStats);
  }

  async getStudyLog(studentId: string): Promise<StudyLog[]> {
    if (!config.useMocks) return this.call<StudyLog[]>('getStudyLog', { studentId });
    await wait(220);
    return clone(demoLog);
  }

  async addStudyLog(studentId: string, entry: StudyLogPayload): Promise<ApiSuccess> {
    if (!config.useMocks) return this.call<ApiSuccess>('addStudyLog', { studentId, ...entry });
    await wait(500);
    demoLog = [
      { date: entry.date, topic: entry.subjects || entry.reason, hours: entry.hours, proof: '' },
      ...demoLog,
    ];
    const previousTotal = Number(demoStats.totalHours || 0);
    const previousEntries = Number(demoStats.totalEntries || 0);
    demoStats = {
      ...demoStats,
      todayHours: entry.hours,
      weeklyHours: Number(demoStats.weeklyHours || 0) + entry.hours,
      monthlyHours: Number(demoStats.monthlyHours || 0) + entry.hours,
      totalHours: previousTotal + entry.hours,
      totalEntries: previousEntries + 1,
      averageHours: (previousTotal + entry.hours) / (previousEntries + 1),
      lastSubmission: entry.date,
    };
    return { success: true };
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    if (!config.useMocks) return this.call<LeaderboardEntry[]>('getLeaderboard');
    await wait(200);
    return clone(mockLeaderboard);
  }

  async getWeeklyReports(studentId: string): Promise<WeeklyReport[]> {
    if (!config.useMocks) return this.call<WeeklyReport[]>('getWeeklyReports', { studentId });
    await wait(260);
    return clone(mockReports);
  }

  async getAnnouncements(): Promise<Announcement[]> {
    if (!config.useMocks) return this.call<Announcement[]>('getAnnouncements');
    await wait(180);
    return clone(mockAnnouncements);
  }

  async getStudentMentorNotes(studentId: string): Promise<MentorNote[]> {
    if (!config.useMocks) return this.call<MentorNote[]>('getStudentMentorNotes', { studentId });
    await wait(180);
    return clone(mockMentorNotes);
  }

  async getNotes(studentId: string): Promise<StudyNote[]> {
    if (!config.useMocks) return this.call<StudyNote[]>('notes.listForStudent', { studentId });
    await wait(250);
    return clone(mockStudyNotes);
  }

  async getMentorFeedback(studentId: string): Promise<MentorFeedback[]> {
    if (!config.useMocks) return this.call<MentorFeedback[]>('getStudentFeedback', { studentId });
    await wait(200);
    return clone(mockFeedback);
  }

  async markMentorFeedbackRead(id: string): Promise<ApiSuccess> {
    if (!config.useMocks) return this.call<ApiSuccess>('feedback.read', { id });
    return { success: true };
  }
}

export const api = new ApiClient();
