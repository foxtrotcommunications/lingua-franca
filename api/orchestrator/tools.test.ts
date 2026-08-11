import { describe, it, expect } from 'vitest';
import { FakeRoundtableClient } from './roundtableClient.js';
import {
  preConsultLedgerTool,
  evaluateUtteranceTool,
  advanceSceneTool,
  type TurnContext,
} from './tools.js';
import { madridStation } from '../scenes/madrid-station.js';

function ctx(learnerId: string): TurnContext {
  return { learnerId, sceneId: madridStation.id, objective: madridStation.objective };
}

describe('orchestrator tools — deterministic state transitions', () => {
  it('preconsult puts the objective\'s unmet facts on the +1 frontier', async () => {
    const client = new FakeRoundtableClient();
    const cal = (await preConsultLedgerTool(client, ctx('l1')).execute({})) as {
      stretching: string[];
      known: string[];
    };
    expect(cal.stretching).toContain('payment');
    expect(cal.known).not.toContain('payment');
  });

  it('a broken-but-complete utterance is understood and reaches full progress', async () => {
    const client = new FakeRoundtableClient();
    const c = ctx('l2');
    const res = (await evaluateUtteranceTool(client, c).execute({
      // Broken Spanish, but destination + date + time + payment all land.
      utterance: 'Quiero Toledo mañana nueve, tarjeta',
    })) as { outcome: string; objectiveProgress: number };
    expect(res.outcome).toBe('understood');
    expect(res.objectiveProgress).toBeCloseTo(1);
  });

  it('advance_scene is gated: refused before the objective is complete, allowed after', async () => {
    const client = new FakeRoundtableClient();
    const c = ctx('l3');

    // Only destination communicated so far → partial progress.
    await evaluateUtteranceTool(client, c).execute({ utterance: 'Toledo' });
    const blocked = (await advanceSceneTool(client, c).execute({})) as { advanced: boolean };
    expect(blocked.advanced).toBe(false);

    // Now communicate the rest → full progress → advance allowed.
    await evaluateUtteranceTool(client, c).execute({
      utterance: 'mañana a las nueve, pago con tarjeta',
    });
    const ok = (await advanceSceneTool(client, c).execute({})) as {
      advanced: boolean;
      completed: string[];
    };
    expect(ok.advanced).toBe(true);
    expect(ok.completed).toContain(madridStation.objective.id);
  });

  it('an utterance that communicates nothing fails and does not advance', async () => {
    const client = new FakeRoundtableClient();
    const c = ctx('l4');
    const res = (await evaluateUtteranceTool(client, c).execute({
      utterance: 'dinero dinero dinero',
    })) as { outcome: string };
    expect(res.outcome).toBe('failed');
    const adv = (await advanceSceneTool(client, c).execute({})) as { advanced: boolean };
    expect(adv.advanced).toBe(false);
  });
});
