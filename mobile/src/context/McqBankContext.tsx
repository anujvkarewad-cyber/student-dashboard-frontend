import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { EnrichedMcqQuestion } from '../data/mcqMetadata';

const DEFAULT_MENTOR_API = 'https://ujjwal-pathak-project.onrender.com';
const MENTOR_API = (process.env.EXPO_PUBLIC_MENTOR_API_URL || DEFAULT_MENTOR_API).replace(/\/+$/, '');
const BANK_URL = `${MENTOR_API}/api/content/student/bank.json`;
const BANK_META_URL = `${MENTOR_API}/api/content/student/bank-meta.json`;
const CACHE_KEY = 'ump_live_published_bank_v1';
const REQUEST_TIMEOUT_MS = 65_000;
const REVISION_POLL_MS = 10_000;

type PublishedBankPayload = {
  revision: string;
  generatedAt?: string;
  count: number;
  questions: EnrichedMcqQuestion[];
};

type McqBankValue = {
  hydrated: boolean;
  refreshing: boolean;
  revision: string;
  questions: EnrichedMcqQuestion[];
  error?: string;
  refresh: () => Promise<void>;
};

const McqBankContext = createContext<McqBankValue | undefined>(undefined);

const validQuestion = (question: EnrichedMcqQuestion) => Boolean(
  question &&
  question.id &&
  question.prompt &&
  Array.isArray(question.options) &&
  question.options.length === 4 &&
  Number.isInteger(question.answer) &&
  question.answer >= 0 &&
  question.answer < 4 &&
  question.chapterId &&
  question.officialChapter
);

const normalizePayload = (raw: PublishedBankPayload): PublishedBankPayload => {
  if (!raw || !Array.isArray(raw.questions)) throw new Error('Invalid published MCQ bank response');
  const questions = raw.questions.filter(validQuestion);
  return {
    revision: String(raw.revision || 'published-r0'),
    generatedAt: raw.generatedAt,
    count: questions.length,
    questions,
  };
};

export const McqBankProvider = ({ children }: PropsWithChildren) => {
  const [payload, setPayload] = useState<PublishedBankPayload>({
    revision: 'published-loading',
    count: 0,
    questions: [],
  });
  const [hydrated, setHydrated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(BANK_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`Content server returned HTTP ${response.status}`);
      const next = normalizePayload(await response.json() as PublishedBankPayload);
      setPayload(next); // Empty is authoritative and removes previous questions.
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
      setError(undefined);
    } catch (reason) {
      const message = reason instanceof Error && reason.name === 'AbortError'
        ? 'The content server took too long to wake up.'
        : reason instanceof Error ? reason.message : 'Could not load published MCQs.';
      setError(message);
    } finally {
      clearTimeout(timeout);
      setRefreshing(false);
      setHydrated(true);
    }
  }, []);

  const checkPublishedRevision = useCallback(async () => {
    if (AppState.currentState !== 'active') return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(BANK_META_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) return;
      const meta = await response.json() as { revision?: string; count?: number };
      if (!refreshing && (String(meta.revision || '') !== payload.revision || Number(meta.count || 0) !== payload.count)) {
        await refresh();
      }
    } catch {
      // Background revision polling is best-effort; keep the current cached bank.
    } finally {
      clearTimeout(timeout);
    }
  }, [payload.count, payload.revision, refresh, refreshing]);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(CACHE_KEY).then((saved) => {
      if (!mounted) return;
      if (saved) {
        try {
          setPayload(normalizePayload(JSON.parse(saved) as PublishedBankPayload));
          setHydrated(true);
        } catch { /* refresh below */ }
      }
      return refresh();
    }).catch(() => refresh());
    return () => { mounted = false; };
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(checkPublishedRevision, REVISION_POLL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPublishedRevision();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [checkPublishedRevision]);

  const value = useMemo<McqBankValue>(() => ({
    hydrated,
    refreshing,
    revision: payload.revision,
    questions: payload.questions,
    error,
    refresh,
  }), [error, hydrated, payload.questions, payload.revision, refresh, refreshing]);

  return <McqBankContext.Provider value={value}>{children}</McqBankContext.Provider>;
};

export const useMcqBank = () => {
  const context = useContext(McqBankContext);
  if (!context) throw new Error('useMcqBank must be used inside McqBankProvider');
  return context;
};
