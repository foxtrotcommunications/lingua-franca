// Coach domain — owns the deterministic learner ledger.
//
// The Coach pod is the SINGLE WRITER of canonical learner state, exactly as
// Pendragon's demographics pod is the single owner of household memory. The
// model on this pod produces a CoachVerdict; the capabilities below record it
// deterministically. Other pods (World, characters) only ever READ a slice via
// ledger.get / ledger.preConsult.

import { Ledger } from '../ledger/ledger.js';
import { ledgerStore } from '../store.js';
import type {
  CapabilityRegistry,
  ToolRegistry,
  WorldPluginConfig,
  CoachVerdict,
  Objective,
} from '../types.js';

export const LEDGER_CAPS = [
  'ledger.get',
  'ledger.preConsult',
  'ledger.record',
  'ledger.dueForReview',
] as const;

const ledger = new Ledger(ledgerStore);

function asObjective(input: Record<string, unknown>): Objective {
  const o = (input.objective ?? {}) as Partial<Objective>;
  return {
    id: String(o.id ?? input.sceneId ?? 'scene'),
    description: String(o.description ?? ''),
    requiredFacts: Array.isArray(o.requiredFacts) ? o.requiredFacts.map(String) : [],
  };
}

export function registerCoachCapabilities(
  registry: CapabilityRegistry,
  config: WorldPluginConfig,
): void {
  const lang = config.targetLanguage;

  registry.register('ledger.get', (input) => {
    const learnerId = String(input.learnerId);
    return ledger.get(learnerId, lang);
  });

  // The mandatory pre-consult the World agent runs before every turn so
  // generated character speech stays comprehensible-but-stretching (i+1).
  registry.register('ledger.preConsult', (input) => {
    const learnerId = String(input.learnerId);
    const state = ledger.get(learnerId, lang);
    return ledger.preConsult(state, asObjective(input));
  });

  registry.register('ledger.record', (input) => {
    const learnerId = String(input.learnerId);
    const sceneId = String(input.sceneId ?? 'scene');
    const verdict = input.verdict as CoachVerdict;
    const state = ledger.get(learnerId, lang);
    const next = ledger.record(state, sceneId, verdict);
    return { outcome: ledger.outcome(verdict), state: next };
  });

  registry.register('ledger.dueForReview', (input) => {
    const learnerId = String(input.learnerId);
    return ledger.dueForReview(ledger.get(learnerId, lang));
  });
}

export function registerCoachTools(registry: ToolRegistry, _config: WorldPluginConfig): void {
  // The Coach's own model calls this after evaluating an utterance. It writes
  // through the same deterministic ledger — the model never edits state directly.
  registry.register('record_verdict', {
    description:
      'Record your evaluation of the learner\'s utterance to the deterministic ledger. ' +
      'Returns the learning outcome tier (understood / repaired / failed) and updated state.',
    handler: (args) => {
      const learnerId = String(args.learnerId);
      const sceneId = String(args.sceneId ?? 'scene');
      const verdict = args.verdict as CoachVerdict;
      const state = ledger.get(learnerId, _config.targetLanguage);
      const next = ledger.record(state, sceneId, verdict);
      return { outcome: ledger.outcome(verdict), cefr: next.cefr, turn: next.turn };
    },
  });
}
