// Learning provenance + activity labels — registered into core via app hooks.
//
// Parallel to tools-plaid's financial provenance extractor. Core stays
// vertical-agnostic; Lingua Franca teaches it how to (a) turn a turn's tool
// results into a "feedback with receipts" artifact and (b) label ai-status
// steps in game language instead of generic "Consulting <workspace>".

import type { ProvenanceExtractor, ActivityDescriptor } from '../types.js';

interface LedgerSlice {
  cefr?: string;
  dueForReview?: string[];
}
interface VerdictLike {
  outcome?: 'understood' | 'repaired' | 'failed';
  communicativeIntent?: string;
  grammarUsed?: Array<{ point: string; correct: boolean }>;
  vocabUsed?: string[];
}

/** Build the per-turn learning artifact the client renders under the reply. */
export const extractLearningProvenance: ProvenanceExtractor = (toolResults) => {
  let verdict: VerdictLike | undefined;
  let ledger: LedgerSlice | undefined;

  for (const r of toolResults) {
    const rec = r as Record<string, unknown>;
    if (rec && typeof rec === 'object') {
      if ('outcome' in rec || 'communicativeIntent' in rec) verdict = rec as VerdictLike;
      if ('cefr' in rec || 'dueForReview' in rec) ledger = rec as LedgerSlice;
    }
  }
  if (!verdict && !ledger) return null;

  const missed = (verdict?.grammarUsed ?? []).filter((g) => !g.correct).map((g) => g.point);
  return {
    kind: 'learning',
    outcome: verdict?.outcome ?? 'understood',
    intent: verdict?.communicativeIntent ?? null,
    vocabUsed: verdict?.vocabUsed ?? [],
    grammarMissed: missed,
    cefr: ledger?.cefr ?? null,
    dueForReview: ledger?.dueForReview ?? [],
  };
};

/** Human-friendly ai-status labels for the routing DAG. */
export const describeSceneActivity: ActivityDescriptor = (step, target) => {
  if (step.startsWith('intent_bridge:coach') || target === 'Coach') return 'Evaluating your Spanish';
  if (step.startsWith('intent_bridge:')) return target ? `${target} is thinking` : 'A character is thinking';
  if (step === 'composing') return 'The scene responds';
  return undefined;
};
