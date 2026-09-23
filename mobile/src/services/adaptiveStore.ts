/**
 * Persistence for the adaptive engine.
 *
 * Everything is stored per student on the device, matching how the rest of the
 * app already works (focus sessions, study receipts). Nothing here talks to the
 * network - adaptiveStore is about state, not sync.
 *
 * The stored shape is versioned. If the rules or the record layout change, bump
 * STORE_VERSION and the old record is discarded rather than mis-read, which
 * would silently corrupt a student's strength map.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type AttemptInput,
  type ConceptStat,
  type Confidence,
  type MistakeType,
  emptyStat,
  recordAttempt,
} from './adaptiveEngine';

export const STORE_VERSION = 1;

export type AdaptiveState = {
  version: number;
  /** One entry per micro-concept the student has touched or been shown. */
  concepts: Record<string, ConceptStat>;
  /** Question ids already served, so the same one is not repeated. */
  seenQuestions: string[];
  /** Flat log of the last 500 attempts - powers the trend line only. */
  log: {
    at: number;
    concept: string;
    subject: string;
    correct: boolean;
    confidence: Confidence;
    mistakeType?: MistakeType;
  }[];
};

export const emptyState = (): AdaptiveState => ({
  version: STORE_VERSION,
  concepts: {},
  seenQuestions: [],
  log: [],
});

const key = (studentId: string) => `ump_adaptive_v${STORE_VERSION}_${studentId}`;

export const loadState = async (studentId: string): Promise<AdaptiveState> => {
  try {
    const raw = await AsyncStorage.getItem(key(studentId));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as AdaptiveState;
    if (!parsed || parsed.version !== STORE_VERSION) return emptyState();
    return {
      version: STORE_VERSION,
      concepts: parsed.concepts || {},
      seenQuestions: parsed.seenQuestions || [],
      log: parsed.log || [],
    };
  } catch {
    // A corrupt record must never block the student from studying.
    return emptyState();
  }
};

export const saveState = async (studentId: string, state: AdaptiveState): Promise<void> => {
  try {
    const trimmed: AdaptiveState = {
      ...state,
      seenQuestions: state.seenQuestions.slice(-3000),
      log: state.log.slice(-500),
    };
    await AsyncStorage.setItem(key(studentId), JSON.stringify(trimmed));
  } catch {
    // Persistence failing is not worth interrupting a practice session over.
  }
};

/** Concept names are matched case-insensitively so "Section 43" and
 *  "section 43" do not become two different strengths. */
export const conceptKey = (concept: string): string =>
  (concept || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const applyAttempt = (
  state: AdaptiveState,
  input: AttemptInput,
): AdaptiveState => {
  const k = conceptKey(input.concept);
  if (!k) return state;

  const existing = state.concepts[k] || emptyStat(input.concept, input.subject, input.chapterId);
  const updated = recordAttempt(existing, input, input.at ?? Date.now());

  return {
    ...state,
    concepts: { ...state.concepts, [k]: updated },
    log: [
      ...state.log,
      {
        at: input.at ?? Date.now(),
        concept: input.concept,
        subject: input.subject,
        correct: input.correct,
        confidence: input.confidence,
        mistakeType: input.mistakeType,
      },
    ],
  };
};

export const markQuestionsSeen = (state: AdaptiveState, ids: string[]): AdaptiveState => ({
  ...state,
  seenQuestions: Array.from(new Set([...state.seenQuestions, ...ids])),
});

export const conceptList = (state: AdaptiveState): ConceptStat[] =>
  Object.values(state.concepts);
