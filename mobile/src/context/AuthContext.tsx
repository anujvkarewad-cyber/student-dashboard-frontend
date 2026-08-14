import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { clearSavedSession, getSavedSession, saveSession } from '../storage/session';
import type { Student } from '../types';

type AuthContextValue = {
  student: Student | null;
  booting: boolean;
  login: (studentId: string, password: string) => Promise<Student>;
  logout: () => Promise<void>;
  updateSavedPassword: (newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [student, setStudent] = useState<Student | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      const saved = await getSavedSession();
      if (!saved) {
        if (mounted) setBooting(false);
        return;
      }
      try {
        const result = await api.validateLogin(saved.studentId, saved.password);
        if (result.success === false) {
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

  const login = useCallback(async (studentId: string, password: string) => {
    const normalizedId = studentId.trim().toUpperCase();
    const result = await api.validateLogin(normalizedId, password);
    if (result.success === false) {
      throw new Error(result.message || 'Student ID or password is incorrect.');
    }
    await saveSession({ studentId: normalizedId, password });
    setStudent(result);
    return result;
  }, []);

  const logout = useCallback(async () => {
    await clearSavedSession();
    setStudent(null);
  }, []);

  const updateSavedPassword = useCallback(async (newPassword: string) => {
    if (!student) return;
    await saveSession({ studentId: student.studentId, password: newPassword });
  }, [student]);

  const value = useMemo(
    () => ({ student, booting, login, logout, updateSavedPassword }),
    [student, booting, login, logout, updateSavedPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
