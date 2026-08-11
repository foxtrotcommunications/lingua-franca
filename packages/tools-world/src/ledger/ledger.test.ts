import { describe, it, expect } from 'vitest';
import { Ledger, InMemoryLedgerStore, emptyLedger } from './ledger.js';
import type { CoachVerdict, Objective } from './ledger.types.js';

const SCENE = 'madrid-station';
const OBJECTIVE: Objective = {
  id: 'buy-ticket-toledo',
  description: 'Get a ticket to Toledo for tomorrow morning.',
  requiredFacts: ['destination:toledo', 'date:tomorrow', 'time:morning', 'payment'],
};

function verdict(over: Partial<CoachVerdict> = {}): CoachVerdict {
  return {
    communicativeIntent: 'request_train_ticket',
    meaningUnderstood: true,
    repairNeeded: false,
    objectiveProgress: 0.5,
    grammar: 0.7,
    vocabulary: 0.8,
    naturalness: 0.5,
    vocabUsed: ['querer', 'toledo', 'mañana'],
    grammarUsed: [{ point: 'present-querer', correct: true }],
    ...over,
  };
}

describe('Ledger — deterministic floor', () => {
  it('classifies the three outcome tiers from the verdict alone', () => {
    const ledger = new Ledger(new InMemoryLedgerStore());
    expect(ledger.outcome(verdict())).toBe('understood');
    expect(ledger.outcome(verdict({ repairNeeded: true }))).toBe('repaired');
    expect(ledger.outcome(verdict({ meaningUnderstood: false }))).toBe('failed');
  });

  it('credits objective progress and "understood" even when grammar is imperfect', () => {
    const ledger = new Ledger(new InMemoryLedgerStore());
    let state = ledger.get('learner-1', 'es');
    state = ledger.record(state, SCENE, verdict({
      grammar: 0.4,
      objectiveProgress: 0.65,
      grammarUsed: [{ point: 'present-querer', correct: false }],
    }));
    expect(ledger.outcome(verdict({ grammar: 0.4 }))).toBe('understood');
    expect(state.objectives[SCENE]).toBeCloseTo(0.65);
    expect(state.vocab['toledo']).toBe(1);
  });

  it('never regresses objective progress on a later weaker turn', () => {
    const ledger = new Ledger(new InMemoryLedgerStore());
    let state = ledger.get('learner-2', 'es');
    state = ledger.record(state, SCENE, verdict({ objectiveProgress: 0.8 }));
    state = ledger.record(state, SCENE, verdict({ objectiveProgress: 0.2 }));
    expect(state.objectives[SCENE]).toBeCloseTo(0.8);
  });

  it('tracks mastery via streaks and surfaces struggling points for review', () => {
    const ledger = new Ledger(new InMemoryLedgerStore());
    let state = ledger.get('learner-3', 'es');
    for (let i = 0; i < 3; i++) {
      state = ledger.record(state, SCENE, verdict({
        grammarUsed: [{ point: 'numbers-time', correct: true }],
      }));
    }
    expect(ledger.dueForReview(state)).toContain('numbers-time');
    state = ledger.record(state, SCENE, verdict({
      grammarUsed: [{ point: 'numbers-time', correct: true }],
    }));
    expect(ledger.dueForReview(state)).not.toContain('numbers-time');
  });

  it('preConsult puts unseen required facts on the +1 frontier, not in known', () => {
    const ledger = new Ledger(new InMemoryLedgerStore());
    const state = ledger.get('learner-4', 'es');
    const cal = ledger.preConsult(state, OBJECTIVE);
    expect(cal.stretching).toContain('payment');
    expect(cal.known).not.toContain('payment');
  });

  it('a hint request is its own outcome and does not move comprehension', () => {
    const ledger = new Ledger(new InMemoryLedgerStore());
    expect(ledger.outcome(verdict({ hintRequested: true }))).toBe('hint');
    // hint wins even if the coach also marked the meaning as not understood
    expect(ledger.outcome(verdict({ hintRequested: true, meaningUnderstood: false }))).toBe('hint');
    let state = ledger.get('learner-h', 'es');
    state = ledger.record(state, SCENE, verdict({ meaningUnderstood: true }));
    state = ledger.record(state, SCENE, verdict({ hintRequested: true, meaningUnderstood: false }));
    expect(ledger.comprehensionRate(state)).toBeCloseTo(1); // hint turn not sampled
  });

  it('comprehension rate is a rolling fraction of understood turns', () => {
    const ledger = new Ledger(new InMemoryLedgerStore());
    let state = ledger.get('learner-5', 'es');
    state = ledger.record(state, SCENE, verdict({ meaningUnderstood: true }));
    state = ledger.record(state, SCENE, verdict({ meaningUnderstood: false }));
    expect(ledger.comprehensionRate(state)).toBeCloseTo(0.5);
  });

  it('starts fresh learners at A1', () => {
    expect(emptyLedger('x', 'es').cefr).toBe('A1');
  });
});
