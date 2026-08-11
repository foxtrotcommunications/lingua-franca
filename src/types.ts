export interface Objective {
  id: string;
  description: string;
  requiredFacts: string[];
  checklist?: string[];
  factOwners?: string[];
}

export interface SceneCharacter {
  characterId: string;
  name: string;
  persona: string;
  knows: string[];
  speaksAt: string;
  entersWhen: 'start' | 'after_objective';
}

export interface Scene {
  id: string;
  location: string;
  banner: string;
  language: string;
  briefing?: string;
  /** Target-language level nudge (tiers 4-5); absent at 1-3. */
  nudge?: string;
  completeLabel?: string;
  difficulty: number;
  objective: Objective;
  characters: SceneCharacter[];
}

/**
 * The learner ledger, as the client sees it: an opaque blob. The server owns
 * its shape and every decision made from it; the client only stores it
 * (localStorage, keyed per language) and returns it with the next turn. Never
 * read fields off this.
 */
export type LedgerBlob = Record<string, unknown>;

export interface TurnResponse {
  characterId: string;
  characterName: string;
  reply: string;
  outcome: 'understood' | 'repaired' | 'partial' | 'failed' | 'hint';
  objectiveProgress: number;
  complete: boolean;
  cefr: string;
  /** What the character understood the learner wanted, in English. */
  understoodAs: string | null;
  naturalUpgrade: string | null;
  /** Why the naturalUpgrade is an improvement (1-2 English sentences). */
  upgradeWhy: string | null;
  factsCommunicated: string[];
  wrongLanguage?: boolean;
  askInstead?: string | null;
  ledgerState: LedgerBlob;
}

export type ChatTurn =
  | {
      role: 'learner';
      text: string;
      outcome?: TurnResponse['outcome'];
      wrongLanguage?: boolean;
      askInstead?: string | null;
    }
  | { role: 'character'; text: string; characterName: string };
