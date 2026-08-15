import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiMode } from '../api/client';
import { clearSavedSession, getSavedSession, saveSession } from '../storage/session';
import type { Student } from '../types';

type AuthContextValue = {
  student: Student | null;
  booting: boolean;
  backendMode: ApiMode;
  switchBackendMode: (mode: ApiMode) => Promise<void>;
  login: (studentId: string, password: string) => Promise<Student>;
  logout: () => Promise<void>;
  updateSavedPassword: (newPassword: string) => Promise<void>;
  completeRequiredPasswordChange: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [student, setStudent] = useState<Student | null>(null);
  const [booting, setBooting] = useState(true);
  const [backendMode, setBackendMode] = useState<ApiMode>(api.getMode());

  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      const mode = await api.initializeMode();
      if (mounted) setBackendMode(mode);
      const saved = await getSavedSession();
      if (!saved) {
        if (mounted) setBooting(false);
        return;
      }
      try {
        const result = await api.validateLogin(saved.studentId, saved.password);
        if (result.success === false || (result.forcePasswordChange && mode === 'live-readonly')) {
          await clearSavedSession();
        } else if (mounted) {
          setStudent(result);
        }
      } catch {
        // Keep the encrypted session for a later retry, but show login now instead
        // of trapping the user behind a permanent loading screen.
      } finally {
        if (mounted) setBooting(false);
      }
    };
    restore();
    return () => { mounted = false; };
  }, []);

  const switchBackendMode = useCallback(async (mode: ApiMode) => {
    if (student) throw new Error('Sign out before changing data mode.');
    await clearSavedSession();
    await api.setMode(mode);
    setBackendMode(mode);
  }, [student]);

  const login = useCallback(async (studentId: string, password: string) => {
    const normalizedId = studentId.trim().toUpperCase();
    const result = await api.validateLogin(normalizedId, password);
    if (result.success === false) {
      throw new Error(result.message || 'Student ID or password is incorrect.');
    }
    if (result.forcePasswordChange && backendMode === 'live-readonly') {
      throw new Error('Your account requires a password change. Select Full live to complete it securely.');
    }
    await saveSession({ studentId: normalizedId, password });
    setStudent(result);
    return result;
  }, [backendMode]);

  const logout = useCallback(async () => {
    await clearSavedSession();
    setStudent(null);
  }, []);

  const updateSavedPassword = useCallback(async (newPassword: string) => {
    if (!student) return;
    await saveSession({ studentId: student.studentId, password: newPassword });
  }, [student]);

  const completeRequiredPasswordChange = useCallback(() => {
    setStudent((current) => current ? { ...current, forcePasswordChange: false } : current);
  }, []);

  const value = useMemo(
    () => ({ student, booting, backendMode, switchBackendMode, login, logout, updateSavedPassword, completeRequiredPasswordChange }),
    [student, booting, backendMode, switchBackendMode, login, logout, updateSavedPassword, completeRequiredPasswordChange],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
