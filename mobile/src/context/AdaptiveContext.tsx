import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  accuracyOf,
  buildInsights,
  buildRevisionPlan,
  type ConceptStat,
  type Confidence,
  type MistakeType,
} from '../services/adaptiveEngine';
import { conceptKey, type ConceptSource, primaryConcept } from '../services/conceptResolver';
import {
  applyAttempt,
  conceptList,
  emptyState,
  loadState,
  markQuestionsSeen,
  saveState,
  type AdaptiveState,
} from '../services/adaptiveStore';
import { useAuth } from './AuthContext';

export type RecordAnswerInput = {
  question: ConceptSource;
  correct: boolean;
  confidence: Confidence;
  mistakeType?: MistakeType;
};

type AdaptiveValue = {
  hydrated: boolean;
  concepts: ConceptStat[];
  dueToday: ConceptStat[];
  overdue: ConceptStat[];
  weak: ConceptStat[];
  insights: ReturnType<typeof buildInsights>;
  revisionPlan: ReturnType<typeof buildRevisionPlan>;
  /** Concepts to prioritise for the next adaptive session. */
  focusConcepts: ConceptStat[];
  /** Question ids already served, so a session does not repeat them. */
  seenQuestionIds: Set<string>;
  totalTracked: number;
  recordAnswer: (input: RecordAnswerInput) => Promise<void>;
  noteQuestionsSeen: (ids: string[]) => Promise<void>;
  reset: () => Promise<void>;
};

const AdaptiveContext = createContext<AdaptiveValue | undefined>(undefined);

export const AdaptiveProvider = ({ children }: PropsWithChildren) => {
  const { student } = useAuth();
  const [state, setState] = useState<AdaptiveState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const studentId = student?.studentId;
  // Writes are serialised so two fast answers cannot clobber each other.
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let mounted = true;
    if (!studentId) {
      stateRef.current = emptyState();
      setState(emptyState());
      setHydrated(true);
      return () => { mounted = false; };
    }
    setHydrated(false);
    loadState(studentId).then((loaded) => {
      if (!mounted) return;
      stateRef.current = loaded;
      setState(loaded);
      setHydrated(true);
    });
    return () => { mounted = false; };
  }, [studentId]);

  const persist = useCallback(
    (next: AdaptiveState) => {
      if (!studentId) return Promise.resolve();
      writeChain.current = writeChain.current
        .then(() => saveState(studentId, next))
        .catch(() => undefined);
      return writeChain.current;
    },
    [studentId],
  );

  // The next state is computed from the ref, not inside a setState updater.
  // React runs updaters later, so reading the result straight afterwards would
  // always be undefined and the write would be silently dropped. Updating the
  // ref synchronously also keeps two answers in a row from clobbering each
  // other before the next render lands.
  const commit = useCallback(
    (next: AdaptiveState) => {
      stateRef.current = next;
      setState(next);
      return persist(next);
    },
    [persist],
  );

  const recordAnswer = useCallback(
    async ({ question, correct, confidence, mistakeType }: RecordAnswerInput) => {
      if (!studentId) return;
      const concept = primaryConcept(question);
      await commit(
        applyAttempt(stateRef.current, {
          concept: concept.label,
          subject: concept.subject,
          chapterId: concept.chapterId,
          correct,
          confidence,
          mistakeType,
          at: Date.now(),
        }),
      );
    },
    [commit, studentId],
  );

  const noteQuestionsSeen = useCallback(
    async (ids: string[]) => {
      if (!studentId || !ids.length) return;
      await commit(markQuestionsSeen(stateRef.current, ids));
    },
    [commit, studentId],
  );

  const reset = useCallback(async () => {
    if (!studentId) return;
    await commit(emptyState());
  }, [commit, studentId]);

  const value = useMemo<AdaptiveValue>(() => {
    const concepts = conceptList(state);
    const plan = buildRevisionPlan(concepts);
    return {
      hydrated,
      concepts,
      dueToday: plan.today,
      overdue: plan.overdue,
      weak: plan.weak,
      revisionPlan: plan,
      insights: buildInsights(concepts),
      focusConcepts: plan.overdue.length ? plan.overdue : plan.weak.length ? plan.weak : plan.today,
      seenQuestionIds: new Set(state.seenQuestions),
      totalTracked: concepts.reduce((sum, item) => sum + item.attempts, 0),
      recordAnswer,
      noteQuestionsSeen,
      reset,
    };
  }, [hydrated, noteQuestionsSeen, recordAnswer, reset, state]);

  return <AdaptiveContext.Provider value={value}>{children}</AdaptiveContext.Provider>;
};

export const useAdaptive = (): AdaptiveValue => {
  const context = useContext(AdaptiveContext);
  if (!context) throw new Error('useAdaptive must be used inside AdaptiveProvider.');
  return context;
};

/** Ranking helper shared by the adaptive session builder. */
export const rankByNeed = (concepts: ConceptStat[]): ConceptStat[] =>
  [...concepts].sort((a, b) => {
    if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
    if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    return accuracyOf(a) - accuracyOf(b);
  });

export { conceptKey };
