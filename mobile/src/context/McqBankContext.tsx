import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { EnrichedMcqQuestion } from '../data/mcqMetadata';

const HOSTS = [
  'https://ujjwal-pathak-mentor-api.onrender.com',
  'https://ujjwal-pathak-project.onrender.com',
];
const CACHE_KEY = 'ump_live_published_bank_v2';
const HOST_KEY = 'ump_live_bank_host_v2';
const REQUEST_TIMEOUT_MS = 90_000;
const REVISION_POLL_MS = 15_000;

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

const fetchJson = async (url: string, ms: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const pickHost = async (): Promise<string> => {
  const saved = await AsyncStorage.getItem(HOST_KEY);
  const ordered = [saved, ...HOSTS].filter(Boolean).filter((host, index, all) => all.indexOf(host) === index) as string[];
  const results = await Promise.all(ordered.map(async (host) => {
    try {
      const meta = await fetchJson(`${host}/api/content/student/bank-meta.json`, 12_000);
      return { host, count: Number(meta?.count || 0) };
    } catch {
      return { host, count: -1 };
    }
  }));
  const best = results.reduce((win, row) => (row.count > win.count ? row : win), results[0]);
  if (best && best.count > 0) {
    await AsyncStorage.setItem(HOST_KEY, best.host);
    return best.host;
  }
  return saved || HOSTS[0];
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
    try {
      const host = await pickHost();
      const raw = await fetchJson(`${host}/api/content/student/bank.json`, REQUEST_TIMEOUT_MS);
      const next = normalizePayload(raw as PublishedBankPayload);
      if (next.count === 0 && payload.count > 0) {
        setError('Live bank came back empty — keeping last good questions.');
        return;
      }
      setPayload(next);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
      setError(undefined);
    } catch (reason) {
      const message = reason instanceof Error && reason.name === 'AbortError'
        ? 'The content server took too long to wake up.'
        : reason instanceof Error ? reason.message : 'Could not load published MCQs.';
      setError(message);
    } finally {
      setRefreshing(false);
      setHydrated(true);
    }
  }, [payload.count]);

  const checkPublishedRevision = useCallback(async () => {
    if (AppState.currentState !== 'active') return;
    try {
      const host = await pickHost();
      const meta = await fetchJson(`${host}/api/content/student/bank-meta.json`, 15_000) as { revision?: string; count?: number };
      if (!refreshing && (String(meta.revision || '') !== payload.revision || Number(meta.count || 0) !== payload.count)) {
        await refresh();
      }
    } catch {
      // keep cached bank
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
