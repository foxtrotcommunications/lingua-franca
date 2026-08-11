/**
 * The deterministic learner ledger — Lingua Franca's "deterministic floor".
 *
 * The Coach model produces verdicts; this module owns the canonical state and
 * every progression decision. Nothing here calls an LLM. That is deliberate: a
 * charitable model cannot inflate a learner past what the ledger records, and
 * difficulty calibration (i+1) is COMPUTED, never narrated.
 *
 * Storage is behind LedgerStore so the semantics don't depend on where state
 * lives. The app runtime holds state client-side (the browser stores the blob
 * and returns it each turn; the server stays stateless for Cloud Run) and uses
 * a per-request in-memory store; the pod fleet uses per-pod stores.
 */

import {
  CEFR_ORDER,
  type Cefr,
  type CoachVerdict,
  type GrammarPointId,
  type GrammarStat,
  type I1Calibration,
  type LedgerState,
  type Objective,
  type Outcome,
} from './ledger.types.js';

export interface LedgerStore {
  load(learnerId: string): LedgerState | undefined;
  save(state: LedgerState): void;
}

export class InMemoryLedgerStore implements LedgerStore {
  private readonly states = new Map<string, LedgerState>();

  load(learnerId: string): LedgerState | undefined {
    const s = this.states.get(learnerId);
    return s ? structuredClone(s) : undefined;
  }

  save(state: LedgerState): void {
    this.states.set(state.learnerId, structuredClone(state));
  }
}

const COMPREHENSION_WINDOW = 12;
const MASTERY_STREAK = 4;
const REVIEW_STALENESS = 20;

export function emptyLedger(learnerId: string, targetLanguage: string): LedgerState {
  return {
    learnerId,
    targetLanguage,
    turn: 0,
    vocab: {},
    grammar: {},
    comprehensionSamples: [],
    objectives: {},
    cefr: 'A1',
  };
}

export class Ledger {
  constructor(private readonly store: LedgerStore) {}

  get(learnerId: string, targetLanguage: string): LedgerState {
    return this.store.load(learnerId) ?? emptyLedger(learnerId, targetLanguage);
  }

  /**
   * Record a Coach verdict for one utterance. The single write path: advances
   * the SRS clock, updates vocab exposure and grammar mastery, samples
   * comprehension, moves objective progress, re-derives CEFR. Returns the
   * updated (persisted) state.
   */
  record(state: LedgerState, sceneId: string, verdict: CoachVerdict): LedgerState {
    const next: LedgerState = structuredClone(state);
    next.turn += 1;

    for (const v of verdict.vocabUsed) {
      next.vocab[v] = (next.vocab[v] ?? 0) + 1;
    }

    for (const g of verdict.grammarUsed) {
      const stat: GrammarStat = next.grammar[g.point] ?? {
        correct: 0,
        attempts: 0,
        streak: 0,
        lastSeenTurn: next.turn,
      };
      stat.attempts += 1;
      stat.lastSeenTurn = next.turn;
      if (g.correct) {
        stat.correct += 1;
        stat.streak += 1;
      } else {
        stat.streak = 0;
      }
      next.grammar[g.point] = stat;
    }

    next.comprehensionSamples.push(verdict.meaningUnderstood);
    if (next.comprehensionSamples.length > COMPREHENSION_WINDOW) {
      next.comprehensionSamples.splice(0, next.comprehensionSamples.length - COMPREHENSION_WINDOW);
    }

    // Objective progress is monotonic — a later weaker utterance never regresses it.
    const prior = next.objectives[sceneId] ?? 0;
    next.objectives[sceneId] = Math.max(prior, clamp01(verdict.objectiveProgress));

    next.cefr = deriveCefr(next);
    this.store.save(next);
    return next;
  }

  comprehensionRate(state: LedgerState): number {
    const s = state.comprehensionSamples;
    if (s.length === 0) return 0;
    return s.filter(Boolean).length / s.length;
  }

  /** Deterministic tier from the verdict alone. */
  outcome(verdict: CoachVerdict): Outcome {
    if (!verdict.meaningUnderstood) return 'failed';
    return verdict.repairNeeded ? 'repaired' : 'understood';
  }

  dueForReview(state: LedgerState): GrammarPointId[] {
    const due: GrammarPointId[] = [];
    for (const [point, stat] of Object.entries(state.grammar)) {
      const struggling = stat.streak < MASTERY_STREAK;
      const stale = state.turn - stat.lastSeenTurn >= REVIEW_STALENESS;
      if (struggling || stale) due.push(point);
    }
    return due;
  }

  /**
   * The mandatory pre-consult: what character speech may lean on (known), what
   * to stretch toward (+1), what to keep out of generated speech (avoid). This
   * is Krashen's i+1 as an engineering invariant, not a model vibe.
   */
  preConsult(state: LedgerState, objective: Objective): I1Calibration {
    const known: string[] = [];
    const stretching: string[] = [];
    const avoid: string[] = [];

    for (const [point, stat] of Object.entries(state.grammar)) {
      if (stat.streak >= MASTERY_STREAK) known.push(point);
      else if (stat.attempts > 0) stretching.push(point);
      else avoid.push(point);
    }
    for (const [lemma, count] of Object.entries(state.vocab)) {
      if (count >= 3) known.push(lemma);
      else stretching.push(lemma);
    }
    for (const fact of objective.requiredFacts) {
      if (!known.includes(fact) && !stretching.includes(fact)) stretching.push(fact);
    }

    return { known, stretching, avoid, dueForReview: this.dueForReview(state) };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Derive a CEFR estimate deterministically from breadth of known vocab and
 * grammar accuracy. Intentionally conservative: it can only rise on evidence.
 */
function deriveCefr(state: LedgerState): Cefr {
  const knownVocab = Object.values(state.vocab).filter((c) => c >= 3).length;
  const grammarStats = Object.values(state.grammar);
  const attempts = grammarStats.reduce((a, s) => a + s.attempts, 0);
  const correct = grammarStats.reduce((a, s) => a + s.correct, 0);
  const accuracy = attempts === 0 ? 0 : correct / attempts;

  let level = 0;
  if (knownVocab >= 15 && accuracy >= 0.6) level = 1; // A2
  if (knownVocab >= 40 && accuracy >= 0.7) level = 2; // B1
  if (knownVocab >= 80 && accuracy >= 0.8) level = 3; // B2

  const derived = CEFR_ORDER[level] ?? 'A1';
  return CEFR_ORDER.indexOf(derived) >= CEFR_ORDER.indexOf(state.cefr) ? derived : state.cefr;
}
