import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { config } from '../config';
import type { Announcement, ApiSuccess, AppRelease, AttendanceStatus, LeaderboardEntry, MentorFeedback, MentorNote, Stats, Student, StudyLog, StudyLogPayload, StudyNote, WeeklyReport } from '../types';
type ApiEnvelope<T> = { result?: T; error?: string };
type NativeJsonResponse<T> = { status: number; data: ApiEnvelope<T> };
export type ApiMode = 'mock' | 'live-readonly' | 'live';

const MODE_STORAGE_KEY = 'ump_api_mode_v2';

/**
 * React Native's fetch implementation can cancel otherwise healthy Android
 * requests before response.json() runs (the affected devices report
 * "fetch request has been canceled"). XHR uses React Native's mature native
 * networking bridge and gives us deterministic timeout/status/response text.
 *
 * Deliberately one request only: silently retrying generic API calls could
 * duplicate writes such as study logs or password changes.
 */
function postJsonNative<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<NativeJsonResponse<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    xhr.open('POST', url, true);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = () => {
      if (settled) return;
      const raw = String(xhr.responseText || '').trim();
      let data: ApiEnvelope<T>;
      try {
        data = JSON.parse(raw) as ApiEnvelope<T>;
      } catch {
        fail(`Server returned an unreadable response (HTTP ${xhr.status || 0}). Please try again.`);
        return;
      }
      settled = true;
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => fail('Unable to connect. Check your internet connection and try again.');
    xhr.ontimeout = () => fail('The server is taking too long to respond. Please try again.');
    xhr.onabort = () => fail('The request was cancelled before completion. Please try again.');

    try {
      xhr.send(JSON.stringify(body));
    } catch {
      fail('Unable to start the request. Please reopen the app and try again.');
    }
  });
}

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
    if (!config.apiUrl) throw new Error('Cloud gateway is not configured for this build.');

    const { status, data } = await postJsonNative<T>(
      config.apiUrl,
      { action, payload },
      config.requestTimeoutMs,
    );

    if (status < 200 || status >= 300) {
      throw new Error(data.error || `Request failed (${status}).`);
    }
    if (data.error) throw new Error(data.error);
    return data.result as T;
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

  async uploadProof(input: { studentId: string; password: string; fileName: string; mimeType: string; fileUri: string }): Promise<{ proofUrl: string }> {
    this.blockBackendWrite('Proof upload');
    if (!config.proofUploadUrl) throw new Error('Proof upload is not configured for this build.');

    // Stream from the app cache in native code. Loading the whole proof into a
    // JavaScript ArrayBuffer made low-memory/older Android phones hang or lose
    // the picked file before the request ever reached Cloud Run.
    const uploadTask = FileSystem.createUploadTask(config.proofUploadUrl, input.fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      mimeType: input.mimeType,
      headers: {
        'Content-Type': input.mimeType,
        'X-Student-Id': input.studentId,
        'X-Session-Password': input.password,
        'X-File-Name': encodeURIComponent(input.fileName),
      },
    });
    const upload = uploadTask.uploadAsync();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void uploadTask.cancelAsync();
        reject(new Error('Proof upload is taking too long. Check your connection and try once more.'));
      }, 90_000);
    });

    try {
      const response = await Promise.race([upload, timeout]);
      if (!response) throw new Error('Proof upload was cancelled. Please select the file again.');
      let result: { proofUrl?: string; error?: string } = {};
      try { result = JSON.parse(response.body || '{}') as typeof result; }
      catch { throw new Error('Proof server returned an unreadable response. Please try again.'); }
      if (response.status < 200 || response.status >= 300 || !result.proofUrl) {
        throw new Error(result.error || `Proof upload failed (${response.status}).`);
      }
      return { proofUrl: result.proofUrl };
    } finally {
      if (timer) clearTimeout(timer);
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

  /**
   * Leave / absent self-reporting (owner spec 14-Oct-2026). The mentor tracker
   * shows these days as Leave/Absent instead of Missed and the 23:00 / 07:00 /
   * 14:00 "tracker missing" reminders skip them.
   */
  async getAttendanceStatus(studentId: string): Promise<AttendanceStatus> {
    return this.call<AttendanceStatus>('attendance.status', { studentId });
  }

  async markAbsent(studentId: string, payload: { date?: string; reason?: string }): Promise<ApiSuccess> {
    return this.call<ApiSuccess>('attendance.markAbsent', { studentId, ...payload });
  }

  async requestLeave(
    studentId: string,
    payload: { from: string; to: string; reason?: string },
  ): Promise<ApiSuccess> {
    return this.call<ApiSuccess>('attendance.requestLeave', { studentId, ...payload });
  }

  async cancelLeave(studentId: string, leaveId: string): Promise<ApiSuccess> {
    return this.call<ApiSuccess>('attendance.cancelLeave', { studentId, leaveId });
  }
}

export const api = new ApiClient();
