// Production RoundtableClient — drives the real pods over A2A.
//
// Drop-in replacement for FakeRoundtableClient. Character replies and Coach
// evaluation are full inference on their pods (message/send). The Coach pod owns
// the deterministic ledger via @lingua-franca/tools-world, so it returns
// structured data artifacts (calibration, verdict result, state) alongside its
// text; the determinism still lives on the pod, not here.

import type {
  CoachVerdict,
  I1Calibration,
  LedgerState,
  Objective,
  Outcome,
} from '@lingua-franca/tools-world';
import {
  sendA2aMessage,
  extractDataArtifact,
  extractResponseText,
  type A2aArtifact,
} from '../services/roundtable.js';
import type {
  AskCharacterParams,
  EvaluateParams,
  RoundtableClient,
} from './roundtableClient.js';

/** Where each pod lives + its A2A key. Populated by provisioning. */
export interface PodRef {
  workspaceUrl: string;
  a2aApiKey: string;
}

export interface PodDirectory {
  world: PodRef;
  coach: PodRef;
  /** Character pods keyed by characterId (lucia / mateo / inspector). */
  characters: Record<string, PodRef>;
}

export class A2ARoundtableClient implements RoundtableClient {
  constructor(private readonly dir: PodDirectory) {}

  private character(characterId: string): PodRef {
    const ref = this.dir.characters[characterId];
    if (!ref) throw new Error(`No pod provisioned for character: ${characterId}`);
    return ref;
  }

  async preConsultLedger(learnerId: string, objective: Objective): Promise<I1Calibration> {
    const { artifacts } = await this.callCoach({
      op: 'preConsult',
      learnerId,
      objective,
    });
    const cal = extractDataArtifact<I1Calibration>(artifacts, 'calibration');
    return cal ?? { known: [], stretching: [...objective.requiredFacts], avoid: [], dueForReview: [] };
  }

  async askCharacter(params: AskCharacterParams): Promise<string> {
    const pod = this.character(params.characterId);
    // The World hands the pod the learner utterance plus the i+1 constraint; the
    // character pod replies in character, from its own knowledge, at that level.
    const prompt = JSON.stringify({
      learnerId: params.learnerId,
      sceneId: params.sceneId,
      utterance: params.utterance,
      calibration: params.calibration,
    });
    const { text } = await sendA2aMessage(pod.workspaceUrl, pod.a2aApiKey, prompt);
    return text;
  }

  async evaluate(params: EvaluateParams): Promise<CoachVerdict> {
    const { artifacts } = await this.callCoach({
      op: 'evaluate',
      learnerId: params.learnerId,
      sceneId: params.sceneId,
      objective: params.objective,
      utterance: params.utterance,
    });
    const verdict = extractDataArtifact<CoachVerdict>(artifacts, 'verdict');
    if (!verdict) throw new Error('Coach returned no verdict artifact');
    return verdict;
  }

  async recordVerdict(
    learnerId: string,
    sceneId: string,
    verdict: CoachVerdict,
  ): Promise<{ outcome: Outcome; state: LedgerState }> {
    const { artifacts } = await this.callCoach({ op: 'record', learnerId, sceneId, verdict });
    const result = extractDataArtifact<{ outcome: Outcome; state: LedgerState }>(artifacts, 'record');
    if (!result) throw new Error('Coach returned no record artifact');
    return result;
  }

  async getState(learnerId: string): Promise<LedgerState> {
    const { artifacts } = await this.callCoach({ op: 'getState', learnerId });
    const state = extractDataArtifact<LedgerState>(artifacts, 'state');
    if (!state) throw new Error('Coach returned no state artifact');
    return state;
  }

  async advanceScene(
    learnerId: string,
    sceneId: string,
    objectiveId: string,
  ): Promise<{ completed: string[] }> {
    const pod = this.dir.world;
    const prompt = JSON.stringify({ op: 'advance', learnerId, sceneId, objectiveId });
    const { artifacts } = await sendA2aMessage(pod.workspaceUrl, pod.a2aApiKey, prompt);
    return extractDataArtifact<{ completed: string[] }>(artifacts, 'scene') ?? { completed: [] };
  }

  /** Send a structured op to the Coach pod and return its artifacts. */
  private async callCoach(op: Record<string, unknown>): Promise<{ text: string; artifacts: A2aArtifact[] }> {
    const { workspaceUrl, a2aApiKey } = this.dir.coach;
    const res = await sendA2aMessage(workspaceUrl, a2aApiKey, JSON.stringify(op));
    return { text: extractResponseText(res.artifacts), artifacts: res.artifacts };
  }
}
