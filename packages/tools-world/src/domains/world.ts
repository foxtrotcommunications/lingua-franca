// World domain — the orchestrator (Arthur analog).
//
// Owns scene/objective runtime state and routes the learner's utterance to the
// addressed character over A2A. It does NOT write the ledger (that's the Coach)
// and does NOT hold character knowledge (that's each character pod). It reads a
// ledger slice via the Coach's pre-consult so it can keep generated narration
// at i+1, and it advances objectives as the Coach confirms progress.

import { sceneStateStore } from '../store.js';
import type { CapabilityRegistry, ToolRegistry, WorldPluginConfig } from '../types.js';

export const SCENE_CAPS = ['scene.getState', 'scene.advance', 'scene.reset'] as const;

export function registerWorldCapabilities(
  registry: CapabilityRegistry,
  config: WorldPluginConfig,
): void {
  registry.register('scene.getState', (input, ctx) => {
    const learnerId = String(input.learnerId);
    const sceneId = String(input.sceneId ?? config.sceneId ?? 'scene');
    return sceneStateStore.get(ctx.workspaceId, learnerId, sceneId);
  });

  // Called when the Coach confirms an objective was communicated. Idempotent:
  // completing the same objective twice does not double-count.
  registry.register('scene.advance', (input, ctx) => {
    const learnerId = String(input.learnerId);
    const sceneId = String(input.sceneId ?? config.sceneId ?? 'scene');
    const objectiveId = String(input.objectiveId);
    const state = sceneStateStore.get(ctx.workspaceId, learnerId, sceneId);
    state.turn += 1;
    if (!state.completedObjectives.includes(objectiveId)) {
      state.completedObjectives.push(objectiveId);
    }
    sceneStateStore.save(ctx.workspaceId, state);
    return state;
  });

  registry.register('scene.reset', (input, ctx) => {
    const learnerId = String(input.learnerId);
    const sceneId = String(input.sceneId ?? config.sceneId ?? 'scene');
    sceneStateStore.save(ctx.workspaceId, {
      sceneId,
      learnerId,
      completedObjectives: [],
      turn: 0,
    });
    return { ok: true };
  });
}

export function registerWorldTools(registry: ToolRegistry, config: WorldPluginConfig): void {
  registry.register('scene_state', {
    description:
      'Read the current scene state: which objectives the learner has completed and the turn ' +
      'count. Use this to decide whether the scene is finished or which character to bring in.',
    handler: (args) => {
      const learnerId = String(args.learnerId);
      const sceneId = String(args.sceneId ?? config.sceneId ?? 'scene');
      return sceneStateStore.get(config.workspaceId, learnerId, sceneId);
    },
  });
}
