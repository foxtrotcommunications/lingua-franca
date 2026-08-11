import type { LedgerBlob, Scene, TurnResponse } from './types';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  generateScenario: (description: string, difficulty = 2) =>
    post<{ scene: Scene }>('/api/scenario/generate', { description, difficulty }).then((r) => r.scene),

  sceneImage: (location: string, detail: string, reference?: string) =>
    post<{ dataUrl: string }>('/api/images/scene', { location, detail, reference }).then((r) => r.dataUrl),

  characterImage: (name: string, persona: string, reference?: string) =>
    post<{ dataUrl: string }>('/api/images/character', { name, persona, reference }).then((r) => r.dataUrl),

  turn: (body: {
    learnerId: string;
    scene: Scene;
    utterance: string;
    characterId?: string;
    history?: { role: 'learner' | 'character'; text: string }[];
    ledgerState?: LedgerBlob;
    factsSoFar?: string[];
  }) => post<TurnResponse>('/api/play/turn', body),

  debrief: (
    learnerId: string,
    scene: Scene,
    said: string[],
    understood: Array<string | null>,
    upgrades: Array<string | null>,
    ledgerState?: LedgerBlob,
  ) =>
    post<{ right: string; improve: string }>('/api/play/debrief', {
      learnerId,
      scene,
      said,
      understood,
      upgrades,
      ledgerState,
    }),
};
