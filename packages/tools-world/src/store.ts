// Workspace-scoped state stores for the plugin.
//
// In-memory by default so the plugin runs and tests without a database. In
// production these swap for Cloud SQL-backed stores with identical semantics
// (the same pattern tools-plaid uses with withPool()). Every store is keyed by
// workspace so a character pod only ever sees its own rows — the Chinese Wall
// is enforced at the store boundary, not left to the prompt.

import { InMemoryLedgerStore, type LedgerStore } from './ledger/ledger.js';

/** One character's memory of one learner: short notes it may recall later. */
export interface CharacterMemory {
  learnerId: string;
  notes: string[];
}

export interface CharacterMemoryStore {
  recall(workspaceId: string, learnerId: string): string[];
  remember(workspaceId: string, learnerId: string, note: string): void;
  forget(workspaceId: string, learnerId: string): void;
}

export class InMemoryCharacterMemoryStore implements CharacterMemoryStore {
  private readonly rows = new Map<string, string[]>();
  private key(ws: string, learner: string): string {
    return `${ws}::${learner}`;
  }
  recall(ws: string, learner: string): string[] {
    return [...(this.rows.get(this.key(ws, learner)) ?? [])];
  }
  remember(ws: string, learner: string, note: string): void {
    const k = this.key(ws, learner);
    const list = this.rows.get(k) ?? [];
    list.push(note);
    this.rows.set(k, list);
  }
  forget(ws: string, learner: string): void {
    this.rows.delete(this.key(ws, learner));
  }
}

/** The World agent's per-scene runtime state (which characters/objectives are live). */
export interface SceneState {
  sceneId: string;
  learnerId: string;
  completedObjectives: string[];
  turn: number;
}

export interface SceneStateStore {
  get(workspaceId: string, learnerId: string, sceneId: string): SceneState;
  save(workspaceId: string, state: SceneState): void;
}

export class InMemorySceneStateStore implements SceneStateStore {
  private readonly rows = new Map<string, SceneState>();
  private key(ws: string, learner: string, scene: string): string {
    return `${ws}::${learner}::${scene}`;
  }
  get(ws: string, learner: string, scene: string): SceneState {
    return (
      this.rows.get(this.key(ws, learner, scene)) ?? {
        sceneId: scene,
        learnerId: learner,
        completedObjectives: [],
        turn: 0,
      }
    );
  }
  save(ws: string, state: SceneState): void {
    this.rows.set(this.key(ws, state.learnerId, state.sceneId), { ...state });
  }
}

// Module-level singletons — one process serves one pod, so a singleton per
// store type is correct and matches tools-plaid's per-pod pool singleton.
export const ledgerStore: LedgerStore = new InMemoryLedgerStore();
export const characterMemoryStore: CharacterMemoryStore = new InMemoryCharacterMemoryStore();
export const sceneStateStore: SceneStateStore = new InMemorySceneStateStore();
