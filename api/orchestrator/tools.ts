// Turn-orchestration tools, as plain testable factories.
//
// Each returns a { name, description, parameters, execute } option object. The
// execute logic is deterministic and unit-tested directly; worldAgent.ts wraps
// each in an ADK FunctionTool so the World LlmAgent can call them. State
// transitions live HERE (and in the ledger), never in the model — the model
// decides routing, the tools decide truth.

import { z } from 'zod';
import type { Objective } from '@lingua-franca/tools-world';
import type { RoundtableClient } from './roundtableClient.js';

/** Per-turn context bound into the tools so the model can't fumble identity. */
export interface TurnContext {
  learnerId: string;
  sceneId: string;
  objective: Objective;
}

export interface OrchestratorTool<P extends z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: P;
  execute: (input: z.infer<P>) => Promise<unknown>;
}

/** Identity helper: infers the parameter schema so `execute`'s input is typed. */
function defineTool<P extends z.ZodTypeAny>(tool: OrchestratorTool<P>): OrchestratorTool<P> {
  return tool;
}

/** Coach pre-consult — call before generating any character speech. */
export function preConsultLedgerTool(client: RoundtableClient, ctx: TurnContext) {
  return defineTool({
    name: 'preconsult_ledger',
    description:
      'Get the learner\'s i+1 calibration (known / stretching / avoid / dueForReview) before ' +
      'generating character speech. Character dialogue must stay within this.',
    parameters: z.object({}),
    execute: async (_input) => client.preConsultLedger(ctx.learnerId, ctx.objective),
  });
}

/** Delegate the in-character reply to a character pod (constrained to i+1). */
export function askCharacterTool(client: RoundtableClient, ctx: TurnContext) {
  return defineTool({
    name: 'ask_character',
    description:
      'Get an in-character reply from a character (e.g. "lucia", "mateo", "inspector"). The ' +
      'character answers from ITS OWN knowledge only, in Spanish, at the learner\'s level.',
    parameters: z.object({
      characterId: z.string().describe('The character to address: lucia | mateo | inspector'),
      utterance: z.string().describe('The learner\'s message being responded to'),
    }),
    execute: async ({ characterId, utterance }) => {
      const calibration = await client.preConsultLedger(ctx.learnerId, ctx.objective);
      const reply = await client.askCharacter({
        characterId,
        utterance,
        learnerId: ctx.learnerId,
        sceneId: ctx.sceneId,
        calibration,
      });
      return { reply };
    },
  });
}

/** Coach evaluates the utterance and records the verdict to the ledger. */
export function evaluateUtteranceTool(client: RoundtableClient, ctx: TurnContext) {
  return defineTool({
    name: 'evaluate_utterance',
    description:
      'Send the learner\'s utterance to the Coach for a private evaluation. Records the verdict ' +
      'to the deterministic ledger and returns the learning outcome, objective progress, and CEFR.',
    parameters: z.object({
      utterance: z.string().describe('The learner\'s message to evaluate'),
    }),
    execute: async ({ utterance }) => {
      const verdict = await client.evaluate({
        utterance,
        learnerId: ctx.learnerId,
        sceneId: ctx.sceneId,
        objective: ctx.objective,
      });
      const { outcome, state } = await client.recordVerdict(ctx.learnerId, ctx.sceneId, verdict);
      return {
        outcome,
        objectiveProgress: state.objectives[ctx.sceneId] ?? 0,
        cefr: state.cefr,
      };
    },
  });
}

/**
 * Advance the scene — but only if the ledger says every required fact has been
 * communicated. The gate is deterministic and lives here, not in the model's
 * judgment: a charitable World agent cannot skip the objective.
 */
export function advanceSceneTool(client: RoundtableClient, ctx: TurnContext) {
  return defineTool({
    name: 'advance_scene',
    description:
      'Attempt to complete the current objective and advance the scene. Only succeeds when the ' +
      'ledger confirms all required facts were communicated; otherwise reports remaining progress.',
    parameters: z.object({}),
    execute: async (_input) => {
      const state = await client.getState(ctx.learnerId);
      const progress = state.objectives[ctx.sceneId] ?? 0;
      if (progress >= 1) {
        const { completed } = await client.advanceScene(ctx.learnerId, ctx.sceneId, ctx.objective.id);
        return { advanced: true, completed };
      }
      return { advanced: false, progress, reason: 'objective not fully communicated yet' };
    },
  });
}

export function buildTurnTools(client: RoundtableClient, ctx: TurnContext) {
  return [
    preConsultLedgerTool(client, ctx),
    askCharacterTool(client, ctx),
    evaluateUtteranceTool(client, ctx),
    advanceSceneTool(client, ctx),
  ];
}
