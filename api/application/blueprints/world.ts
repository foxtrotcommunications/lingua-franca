import type { WorkspaceBlueprint } from '../types.js';
import { WORLD_SYSTEM_PROMPT } from '../prompts/world.js';

export const world: WorkspaceBlueprint = {
  name: 'World',
  systemPrompt: WORLD_SYSTEM_PROMPT,
  toolsEnabled: ['scene_state'],
  domainType: 'world',
  metadata: { role: 'orchestrator' },
};
