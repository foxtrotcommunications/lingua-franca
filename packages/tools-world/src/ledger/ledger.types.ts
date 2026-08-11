/**
 * Learner-ledger domain types. The Coach pod owns this state; it is the
 * canonical, code-owned "deterministic floor" for one learner.
 */

export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export const CEFR_ORDER: readonly Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export type GrammarPointId = string;
export type VocabId = string;

/** The three outcomes of a communicative attempt — richer than pass/fail. */
export type Outcome = 'understood' | 'repaired' | 'failed';

/**
 * The Coach's private evaluation of one learner utterance. Scores are 0..1.
 * The player never sees these numbers; the game uses them to drive character
 * understanding, objective progress, and later feedback.
 */
export interface CoachVerdict {
  communicativeIntent: string;
  meaningUnderstood: boolean;
  repairNeeded: boolean;
  objectiveProgress: number;
  grammar: number;
  vocabulary: number;
  naturalness: number;
  vocabUsed: VocabId[];
  grammarUsed: Array<{ point: GrammarPointId; correct: boolean }>;
}

/** Per-grammar-point mastery (a simple Leitner-style box). */
export interface GrammarStat {
  correct: number;
  attempts: number;
  streak: number;
  lastSeenTurn: number;
}

/** The canonical, code-owned state for one learner. */
export interface LedgerState {
  learnerId: string;
  targetLanguage: string;
  turn: number;
  vocab: Record<VocabId, number>;
  grammar: Record<GrammarPointId, GrammarStat>;
  comprehensionSamples: boolean[];
  objectives: Record<string, number>;
  cefr: Cefr;
}

/** What the pre-consult hands the World/character agents so input stays i+1. */
export interface I1Calibration {
  known: string[];
  stretching: string[];
  avoid: string[];
  dueForReview: GrammarPointId[];
}

/** A scene objective — the facts a learner must make understood to complete it. */
export interface Objective {
  id: string;
  description: string;
  requiredFacts: string[];
}
