import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { config } from '../config';
import { EnrichedMcqQuestion } from '../data/mcqMetadata';

// Published-bank requests use only the encrypted Cloudflare gateway route.
const HOSTS = [config.mentorApiUrl].filter((host): host is string => typeof host === 'string' && host.length > 0);

// v2 cached whatever the dead hosts returned; bumping forces a clean refetch.
const CACHE_KEY = 'ump_live_published_bank_v3';
const REQUEST_TIMEOUT_MS = 45_000;
const REVISION_POLL_MS = 5 * 60 * 1000;

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
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

// Only the configured encrypted gateway is trusted. Do not probe metadata before
// every full download or race a stale saved deployment against the current one.
const pickHost = async (): Promise<string> => {
  if (!HOSTS[0]) throw new Error('Cloudflare gateway is not configured');
  return HOSTS[0];
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

  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const active = useRef(true);
  const flight = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (flight.current) return flight.current;
    setRefreshing(true);
    const run = (async () => {
      try {
        const host = await pickHost();
        const raw = await fetchJson(`${host}/api/content/student/bank.json`, REQUEST_TIMEOUT_MS);
        const next = normalizePayload(raw as PublishedBankPayload);
        if (next.count === 0) {
          const meta = await fetchJson(`${host}/api/content/student/bank-meta.json`, 12_000);
          if (Number(meta?.count) !== 0) throw new Error('Published bank response was incomplete. Saved questions retained.');
        }
        if (!active.current) return;
        payloadRef.current = next;
        setPayload(next);
        setError(undefined);
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch (reason) {
        const message = reason instanceof Error && reason.name === 'AbortError'
          ? 'Question bank download timed out. Retry when connected.'
          : reason instanceof Error ? reason.message : 'Could not load published MCQs.';
        if (active.current) setError(message);
      } finally {
        if (active.current) { setRefreshing(false); setHydrated(true); }
        flight.current = null;
      }
    })();
    flight.current = run;
    return run;
  }, []);

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
    active.current = true;
    let mounted = true;
    AsyncStorage.getItem(CACHE_KEY).then((saved) => {
      if (!mounted) return;
      if (saved) {
        try {
          const cached = normalizePayload(JSON.parse(saved) as PublishedBankPayload);
          payloadRef.current = cached;
          setPayload(cached);
        } catch { /* invalid cached payload, never delete attempts */ }
      }
    }).catch(() => undefined).finally(() => {
      if (mounted) { setHydrated(true); void refresh(); }
    });
    return () => { mounted = false; active.current = false; };
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
