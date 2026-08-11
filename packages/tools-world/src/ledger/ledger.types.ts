/**
 * Learner-ledger domain types. The Coach pod owns this state; it is the
 * canonical, code-owned "deterministic floor" for one learner.
 */

export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export const CEFR_ORDER: readonly Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export type GrammarPointId = string;
export type VocabId = string;

/**
 * Outcomes of a communicative attempt — richer than pass/fail.
 *
 * - 'understood' — landed cleanly; the character can act.
 * - 'repaired'   — rough language, but the character worked out what to do and
 *                  acted. Credits: communication succeeded.
 * - 'partial'    — the character caught the TOPIC but not enough to act on, and
 *                  had to ask for the missing specifics. Credits nothing:
 *                  semantic recognition is not successful communication.
 * - 'failed'     — did not land at all.
 * - 'hint'       — a help request in the target language ("comment je dis...?"):
 *                  a real conversational skill, neither success nor failure.
 */
export type Outcome = 'understood' | 'repaired' | 'partial' | 'failed' | 'hint';

/**
 * The Coach's private evaluation of one learner utterance. Scores are 0..1.
 * The player never sees these numbers; the game uses them to drive character
 * understanding, objective progress, and later feedback.
 */
export interface CoachVerdict {
  communicativeIntent: string;
  meaningUnderstood: boolean;
  repairNeeded: boolean;
  /** The learner asked (in the target language) how to say something. */
  hintRequested?: boolean;
  /**
   * The character caught the topic but lacks the specifics needed to act, and
   * had to ask. Nothing credits on such a turn.
   */
  clarificationNeeded?: boolean;
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
