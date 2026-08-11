// Character domain — the cast (Lucía, Mateo, Inspector).
//
// One registrar shared by every character pod, exactly as Pendragon's checking
// registrar is shared by checking + savings. Identity (name, persona, what this
// character KNOWS) comes from the blueprint metadata, not from this file. The
// asymmetry is the point: a character can only recall its own memory rows and
// should answer from its own knowledge scope — Lucía knows the schedule, Mateo
// does not.

import { characterMemoryStore } from '../store.js';
import type { CapabilityRegistry, ToolRegistry, WorldPluginConfig } from '../types.js';

export const CHARACTER_CAPS = [
  'character.recall',
  'character.remember',
  'character.forget',
] as const;

export function registerCharacterCapabilities(
  registry: CapabilityRegistry,
  config: WorldPluginConfig,
): void {
  // recall/remember are scoped to THIS pod's workspaceId, so one character can
  // never read another's memory of the learner even though they share a DB.
  registry.register('character.recall', (input, ctx) => {
    const learnerId = String(input.learnerId);
    return { notes: characterMemoryStore.recall(ctx.workspaceId, learnerId) };
  });

  registry.register('character.remember', (input, ctx) => {
    const learnerId = String(input.learnerId);
    const note = String(input.note);
    characterMemoryStore.remember(ctx.workspaceId, learnerId, note);
    return { ok: true };
  });

  registry.register('character.forget', (input, ctx) => {
    characterMemoryStore.forget(ctx.workspaceId, String(input.learnerId));
    return { ok: true };
  });

  void config;
}

export function registerCharacterTools(registry: ToolRegistry, config: WorldPluginConfig): void {
  const characterId = config.characterId ?? config.workspaceId;

  registry.register('recall_learner', {
    description:
      'Recall what you (this character) personally remember about this learner from earlier ' +
      'scenes. Returns only YOUR notes — you cannot see what other characters know.',
    handler: (args) => ({
      character: characterId,
      notes: characterMemoryStore.recall(config.workspaceId, String(args.learnerId)),
    }),
  });

  registry.register('remember_about_learner', {
    description:
      'Note something worth remembering about this learner (a preference, a struggle, a fact ' +
      'they shared) so you can bring it up naturally in a later scene.',
    handler: (args) => {
      characterMemoryStore.remember(config.workspaceId, String(args.learnerId), String(args.note));
      return { ok: true };
    },
  });
}
