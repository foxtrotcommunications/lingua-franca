// The seam between the app-side turn orchestrator and the Roundtable pods.
//
// In production these methods are A2A calls: askCharacter/evaluate hit the
// character and Coach pods (Gemini inference on the pod), and the ledger methods
// hit the Coach pod's capabilities. For tests and local dev we ship a Fake that
// exercises the REAL deterministic ledger, so the orchestrator's state
// transitions are verified without a live model or network.

import { Ledger, InMemoryLedgerStore } from '@lingua-franca/tools-world';
import type {
  CoachVerdict,
  I1Calibration,
  LedgerState,
  Objective,
  Outcome,
} from '@lingua-franca/tools-world';

export interface AskCharacterParams {
  characterId: string;
  utterance: string;
  learnerId: string;
  sceneId: string;
  calibration: I1Calibration;
}

export interface EvaluateParams {
  utterance: string;
  learnerId: string;
  sceneId: string;
  objective: Objective;
}

export interface RoundtableClient {
  /** Coach: i+1 calibration so generated character speech stays comprehensible. */
  preConsultLedger(learnerId: string, objective: Objective): Promise<I1Calibration>;
  /** Character pod: the in-character reply (Gemini inference on the pod). */
  askCharacter(params: AskCharacterParams): Promise<string>;
  /** Coach pod: privately score the utterance into a verdict (Gemini inference). */
  evaluate(params: EvaluateParams): Promise<CoachVerdict>;
  /** Coach pod: record the verdict to the deterministic ledger (single writer). */
  recordVerdict(
    learnerId: string,
    sceneId: string,
    verdict: CoachVerdict,
  ): Promise<{ outcome: Outcome; state: LedgerState }>;
  /** Coach: read the current canonical state. */
  getState(learnerId: string): Promise<LedgerState>;
  /** World pod: advance the scene when an objective is fully communicated. */
  advanceScene(
    learnerId: string,
    sceneId: string,
    objectiveId: string,
  ): Promise<{ completed: string[] }>;
}

// ─── Fake for tests / local dev — backed by the real Ledger ──────────────────

/** Deterministic fact matchers for the Madrid scene (the model does this in prod). */
const FACT_MATCHERS: Record<string, RegExp> = {
  'destination:toledo': /toledo/i,
  'date:tomorrow': /\b(mañana|manana|tomorrow)\b/i,
  'time:morning': /\b(mañana|manana|morning|nueve|ocho|diez|nine|eight|ten|de la mañana)\b/i,
  payment: /\b(tarjeta|efectivo|pago|pagar|euros?|card|cash|pay)\b/i,
};

export class FakeRoundtableClient implements RoundtableClient {
  private readonly ledger = new Ledger(new InMemoryLedgerStore());
  private readonly targetLanguage: string;
  private readonly completed = new Map<string, string[]>();
  // Facts communicated so far per learner+scene. Objective progress accumulates
  // across turns (the real Coach pod derives this from ledger history) — a
  // learner can convey destination this turn and time the next.
  private readonly communicated = new Map<string, Set<string>>();

  constructor(targetLanguage = 'es') {
    this.targetLanguage = targetLanguage;
  }

  async preConsultLedger(learnerId: string, objective: Objective): Promise<I1Calibration> {
    return this.ledger.preConsult(this.ledger.get(learnerId, this.targetLanguage), objective);
  }

  async askCharacter(params: AskCharacterParams): Promise<string> {
    // Canned, deterministic in-character reply for tests. The real character pod
    // generates this with Gemini, constrained to params.calibration.
    return `[${params.characterId}] entiendo: "${params.utterance}"`;
  }

  async evaluate(params: EvaluateParams): Promise<CoachVerdict> {
    const u = params.utterance;
    const facts = params.objective.requiredFacts;
    const matched = facts.filter((f) => (FACT_MATCHERS[f] ?? new RegExp(f, 'i')).test(u));

    // Accumulate the union of facts communicated across the conversation.
    const key = `${params.learnerId}::${params.sceneId}`;
    const soFar = this.communicated.get(key) ?? new Set<string>();
    for (const f of matched) soFar.add(f);
    this.communicated.set(key, soFar);
    const objectiveProgress = facts.length === 0 ? 0 : soFar.size / facts.length;
    const hasQuerer = /\bquiero|quiere\b/i.test(u);

    return {
      communicativeIntent: matched.length > 0 ? 'request_train_ticket' : 'unclear',
      meaningUnderstood: matched.length > 0,
      repairNeeded: false,
      objectiveProgress,
      grammar: hasQuerer ? 0.7 : 0.4,
      vocabulary: Math.min(1, matched.length / 3),
      naturalness: 0.5,
      vocabUsed: u.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 6),
      grammarUsed: hasQuerer ? [{ point: 'present-querer', correct: true }] : [],
    };
  }

  async recordVerdict(
    learnerId: string,
    sceneId: string,
    verdict: CoachVerdict,
  ): Promise<{ outcome: Outcome; state: LedgerState }> {
    const state = this.ledger.record(this.ledger.get(learnerId, this.targetLanguage), sceneId, verdict);
    return { outcome: this.ledger.outcome(verdict), state };
  }

  async getState(learnerId: string): Promise<LedgerState> {
    return this.ledger.get(learnerId, this.targetLanguage);
  }

  async advanceScene(
    learnerId: string,
    sceneId: string,
    objectiveId: string,
  ): Promise<{ completed: string[] }> {
    const key = `${learnerId}::${sceneId}`;
    const done = this.completed.get(key) ?? [];
    if (!done.includes(objectiveId)) done.push(objectiveId);
    this.completed.set(key, done);
    return { completed: [...done] };
  }
}
