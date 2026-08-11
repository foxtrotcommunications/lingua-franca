// App-side scene content types. Scenes are Lingua Franca application data (not
// plugin infrastructure): they drive which blueprints get provisioned and seed
// the World agent's objective. The required facts must match what the Coach's
// ledger.preConsult expects (see @lingua-franca/tools-world Objective).

export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface Objective {
  id: string;
  /** Player-facing goal, in the learner's native language. */
  description: string;
  /** Machine ids of the facts the learner must make understood (for matching). */
  requiredFacts: string[];
  /** Human-readable task labels, aligned to requiredFacts (what the player reads). */
  checklist?: string[];
  /**
   * characterId that each required fact must be directed at, aligned to
   * requiredFacts. Asking the wrong person earns no credit — working out who
   * holds what is the puzzle in a multi-character scene.
   */
  factOwners?: string[];
}

export interface SceneCharacter {
  /** Matches the blueprint metadata.characterId and the provisioned pod. */
  characterId: string;
  name: string;
  /** One vivid sentence: role, temperament, how they speak. */
  persona: string;
  /** Things THIS character knows (asymmetric — not everyone is omniscient). */
  knows: string[];
  /** CEFR level this character's speech targets. */
  speaksAt: string;
  entersWhen: 'start' | 'after_objective';
  /** Provisioning template id — fixture / ADK-orchestrator path only. */
  blueprint?: string;
}

export interface Scene {
  id: string;
  location: string;
  /** Flag emoji + short setting label for the scene header. */
  banner: string;
  /** Human language name the characters speak, e.g. "Spanish", "Italian". */
  language: string;
  /**
   * 2-3 sentence second-person orientation shown as the scene opens. English
   * at tiers 1-3; written in the target language at tiers 4-5, where the whole
   * scene surface is comprehensible input.
   */
  briefing?: string;
  /**
   * Target-language one-liner about the level's accuracy expectations, shown
   * beside the active character's name. Generated at tiers 4-5 only; tiers 1-3
   * fall back to the client's English nudge.
   */
  nudge?: string;
  /** "Mission complete!" in the target language, for the completion card. */
  completeLabel?: string;
  /** Difficulty tier 1-5 (drives cast size + grading strictness). */
  difficulty: number;
  objective: Objective;
  characters: SceneCharacter[];
}
