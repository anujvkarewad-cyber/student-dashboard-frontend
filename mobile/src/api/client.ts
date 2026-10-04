import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config';
import type {
  Announcement,
  ApiSuccess,
  AppRelease,
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
type ApiEnvelope<T> = { result?: T; error?: string };
export type ApiMode = 'mock' | 'live-readonly' | 'live';

const MODE_STORAGE_KEY = 'ump_api_mode_v2';
class ApiClient {
  private mode: ApiMode = config.defaultApiMode;
  private initialized = false;

  async initializeMode() {
    if (this.initialized) return this.mode;
    this.initialized = true;
    if (!config.allowModeSelection) {
      this.mode = config.defaultApiMode;
      return this.mode;
    }
    try {
      const saved = await AsyncStorage.getItem(MODE_STORAGE_KEY);
      if (saved === 'mock' || saved === 'live-readonly' || saved === 'live') this.mode = saved;
    } catch { /* retain the build's safe default */ }
    return this.mode;
  }

  async setMode(mode: ApiMode) {
    if (!config.allowModeSelection && mode !== config.defaultApiMode) {
      throw new Error('Data mode is locked for this app build.');
    }
    this.mode = mode;
    this.initialized = true;
    await AsyncStorage.setItem(MODE_STORAGE_KEY, mode);
  }

  getMode() { return this.mode; }
  isUsingMocks() { return this.mode === 'mock'; }
  isReadOnlyMode() { return this.mode === 'live-readonly'; }
  isLiveMode() { return this.mode === 'live'; }

  private blockBackendWrite(action: string) {
    if (this.isReadOnlyMode()) {
      throw new Error(`${action} is disabled in Live read-only mode. Select Full live to send backend updates.`);
    }
  }

  private async call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!config.apiUrl) throw new Error('Cloudflare gateway is not configured for this build.');
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

  async getAppRelease(): Promise<AppRelease> {
    return this.call<AppRelease>('app.version');
  }

  async validateLogin(studentId: string, password: string): Promise<Student> {
    return this.call<Student>('validateLogin', { studentId, password });
  }

  async validateStudent(studentId: string): Promise<ApiSuccess> {
    return this.call<ApiSuccess>('validateStudent', { studentId });
  }

  async forgotPassword(studentId: string, email: string): Promise<ApiSuccess> {
    this.blockBackendWrite('Password recovery');
    return this.call<ApiSuccess>('forgotPassword', { studentId, email });
  }

  async verifyOTP(studentId: string, otp: string): Promise<ApiSuccess> {
    this.blockBackendWrite('OTP verification');
    return this.call<ApiSuccess>('verifyOTP', { studentId, otp });
  }

  async resetPassword(studentId: string, password: string): Promise<ApiSuccess> {
    this.blockBackendWrite('Password reset');
    return this.call<ApiSuccess>('resetPassword', { studentId, password });
  }

  async changePassword(studentId: string, currentPassword: string, newPassword: string): Promise<ApiSuccess> {
    this.blockBackendWrite('Password changes');
    return this.call<ApiSuccess>('changePassword', { studentId, currentPassword, newPassword });
  }

  async getStats(studentId: string): Promise<Stats> {
    return this.call<Stats>('getStats', { studentId });
  }

  async getStudyLog(studentId: string): Promise<StudyLog[]> {
    return this.call<StudyLog[]>('getStudyLog', { studentId });
  }

  async deleteStudyLog(studentId: string, entry: { date: string; hours: number; topic?: string }): Promise<ApiSuccess> {
    this.blockBackendWrite('Study-log delete');
    return this.call<ApiSuccess>('deleteStudyLog', { studentId, ...entry });
  }

  async uploadProof(input: { studentId: string; password: string; fileName: string; mimeType: string; bytes: ArrayBuffer }): Promise<{ proofUrl: string }> {
    this.blockBackendWrite('Proof upload');
    if (!config.proofUploadUrl) throw new Error('Cloudflare proof upload is not configured for this build.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.proofUploadTimeoutMs);
    try {
      const response = await fetch(config.proofUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': input.mimeType,
          'X-Student-Id': input.studentId,
          'X-Session-Password': input.password,
          'X-File-Name': encodeURIComponent(input.fileName),
        },
        body: input.bytes,
        signal: controller.signal,
      });
      let result: { proofUrl?: string; error?: string };
      try {
        result = await response.json() as { proofUrl?: string; error?: string };
      } catch {
        throw new Error('Proof server returned an unreadable response. Please try again.');
      }
      if (!response.ok || !result.proofUrl) throw new Error(result.error || `Proof upload failed (${response.status}).`);
      return { proofUrl: result.proofUrl };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Proof upload is taking too long. Try a smaller file or a stronger connection.');
      }
      if (error instanceof TypeError) {
        throw new Error('Could not connect for proof upload. Check your internet and try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async addStudyLog(studentId: string, entry: StudyLogPayload): Promise<ApiSuccess> {
    this.blockBackendWrite('Study-log submission');
    return this.call<ApiSuccess>('addStudyLog', { studentId, ...entry });
  }

  async getLeaderboard(studentId?: string): Promise<LeaderboardEntry[]> {
    return this.call<LeaderboardEntry[]>('getLeaderboard', studentId ? { studentId } : {});
  }

  async getWeeklyReports(studentId: string): Promise<WeeklyReport[]> {
    return this.call<WeeklyReport[]>('getWeeklyReports', { studentId });
  }

  async getAnnouncements(): Promise<Announcement[]> {
    return this.call<Announcement[]>('getAnnouncements');
  }

  async getStudentMentorNotes(studentId: string): Promise<MentorNote[]> {
    return this.call<MentorNote[]>('getStudentMentorNotes', { studentId });
  }

  async getNotes(studentId: string): Promise<StudyNote[]> {
    return this.call<StudyNote[]>('notes.listForStudent', { studentId });
  }

  async getMentorFeedback(studentId: string): Promise<MentorFeedback[]> {
    return this.call<MentorFeedback[]>('getStudentFeedback', { studentId });
  }

  async markMentorFeedbackRead(id: string): Promise<ApiSuccess> {
    this.blockBackendWrite('Feedback read updates');
    return this.call<ApiSuccess>('feedback.read', { id });
  }

  async saveDeviceToken(studentId: string, token: string): Promise<ApiSuccess> {
    this.blockBackendWrite('Device-token registration');
    return this.call<ApiSuccess>('saveDeviceToken', { studentId, token });
  }
}

export const api = new ApiClient();
