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
  outcome: 'understood' | 'repaired' | 'failed';
  objectiveProgress: number;
  complete: boolean;
  cefr: string;
  naturalUpgrade: string | null;
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
