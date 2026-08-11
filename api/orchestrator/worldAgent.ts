// The World orchestrator as a Google ADK agent.
//
// buildWorldAgent wraps the deterministic turn tools (tools.ts) in ADK
// FunctionTools and hands them to an LlmAgent driven by the World system prompt.
// The agent decides ROUTING (which character, whether to try advancing); the
// tools decide TRUTH (i+1 calibration, verdicts, the objective gate). runTurn
// executes one learner utterance with an InMemoryRunner and returns the reply.

import { FunctionTool, InMemoryRunner, LlmAgent, isFinalResponse } from '@google/adk';
import type { z } from 'zod';
import { WORLD_SYSTEM_PROMPT } from '../application/prompts/world.js';
import type { RoundtableClient } from './roundtableClient.js';
import { buildTurnTools, type TurnContext } from './tools.js';
import { configureVertex, WORLD_MODEL } from './vertex.js';

export interface WorldAgentOptions {
  client: RoundtableClient;
  ctx: TurnContext;
  model?: string;
}

/**
 * Wrap one deterministic tool in an ADK FunctionTool. The casts bridge the two
 * Zod instances (ADK bundles its own copy, so the schema classes are nominally
 * distinct) — the shapes are identical and the execute logic is unit-tested in
 * tools.test.ts, so the boundary cast is safe.
 */
function toFunctionTool(tool: {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (input: never) => Promise<unknown>;
}): FunctionTool {
  const options = {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: (input: unknown) => tool.execute(input as never),
  };
  // ADK bundles its own Zod, so ToolOptions' parameter type is nominally
  // distinct from ours. Cast at the constructor boundary; shapes are identical.
  return new FunctionTool(options as unknown as ConstructorParameters<typeof FunctionTool>[0]);
}

/** Build a per-turn World LlmAgent with context-bound tools. */
export function buildWorldAgent(opts: WorldAgentOptions): LlmAgent {
  configureVertex();
  const tools = buildTurnTools(opts.client, opts.ctx).map(toFunctionTool);
  return new LlmAgent({
    name: 'world',
    model: opts.model ?? WORLD_MODEL,
    description: 'The World game master that runs a Lingua Franca scene.',
    instruction: WORLD_SYSTEM_PROMPT,
    tools,
  });
}

/**
 * Run one turn: feed the learner's utterance to the World agent and return the
 * concatenated final-response text (the in-character reply the learner sees).
 * Cross-turn memory lives in the ledger and the pods, not the ADK session, so an
 * ephemeral run per turn is sufficient.
 */
export async function runTurn(opts: WorldAgentOptions & { utterance: string }): Promise<string> {
  const agent = buildWorldAgent(opts);
  const runner = new InMemoryRunner({ agent, appName: 'lingua-franca' });

  let text = '';
  for await (const event of runner.runEphemeral({
    userId: opts.ctx.learnerId,
    newMessage: { parts: [{ text: opts.utterance }] },
  })) {
    if (isFinalResponse(event)) {
      for (const part of event.content?.parts ?? []) {
        if (typeof part.text === 'string') text += part.text;
      }
    }
  }
  return text;
}
