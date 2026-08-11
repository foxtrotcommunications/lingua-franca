// The per-turn play runtime used by the UI.
//
// Fast path: the addressed character's reply and the Coach's private verdict are
// generated concurrently (2 Gemini calls, ~2-3s), then the verdict is recorded
// to the deterministic ledger which owns all learning state and decides
// objective completion. Generalizes to any authored scene. The ADK World agent
// (api/orchestrator) remains the "agent framework" showcase; this is the
// responsive UI runtime over the same deterministic floor.

import { Ledger, InMemoryLedgerStore } from '@lingua-franca/tools-world';
import type { CoachVerdict } from '@lingua-franca/tools-world';
import { textAI, TEXT_MODEL } from './genai.js';
import { difficultyOf } from './difficulty.js';
import type { Scene, SceneCharacter } from '../scenes/types.js';

const ledger = new Ledger(new InMemoryLedgerStore());
// Union of required facts communicated so far, per learner+scene (progress is
// cumulative across turns, not per-utterance).
const communicated = new Map<string, Set<string>>();

export interface TurnRequest {
  learnerId: string;
  scene: Scene;
  utterance: string;
  characterId?: string;
  history?: Array<{ role: 'learner' | 'character'; text: string }>;
}

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
  /** True when the learner wrote in the wrong language (no credit earned). */
  wrongLanguage: boolean;
  /** Set when they said the right thing to the wrong character — names who to ask. */
  askInstead: string | null;
}

function textOf(res: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }): string {
  return res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

function parseJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1]! : text;
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON in coach output');
  return JSON.parse(raw.slice(s, e + 1)) as T;
}

function addressedCharacter(scene: Scene, characterId?: string): SceneCharacter {
  if (characterId) {
    const c = scene.characters.find((x) => x.characterId === characterId);
    if (c) return c;
  }
  return scene.characters.find((c) => c.entersWhen === 'start') ?? scene.characters[0]!;
}

async function generateReply(
  scene: Scene,
  character: SceneCharacter,
  utterance: string,
  calibration: { known: string[]; avoid: string[] },
  history: TurnRequest['history'],
  lang: string,
): Promise<string> {
  const hist = (history ?? [])
    .slice(-8)
    .map((h) => `${h.role === 'learner' ? 'Learner' : character.name}: ${h.text}`)
    .join('\n');
  const prompt = `You are ${character.name}. ${character.persona}
You are in this scene: ${scene.location}.
You know ONLY these things: ${character.knows.join('; ')}. If asked about anything
outside that, admit you don't know and point them to whoever would.
Reply ONLY in ${lang}, in character, in 1-3 short sentences, at or below level ${character.speaksAt}.
Judge the learner's message by whether it WORKS (achieves the goal), never by grammar.
Broken-but-understandable succeeds — react to their intent. If you truly can't tell what
they mean, ask ONE short clarifying question in ${lang} (a repair), never "incorrect", never English.
The learner is here to accomplish: "${scene.objective.description}". Respond to what they
actually say, but do NOT do their task for them — never volunteer a recommendation, a
suggestion, or information they are meant to ask for themselves. Let the learner initiate;
only once they ask should you give it. Stay warm and in character — just let them lead.
YOU DO NOT SPEAK ENGLISH. If the learner writes in English (or any language that is not
${lang}), you cannot understand them: react in character as a real ${lang} speaker would —
politely signal you didn't understand and invite them to try in ${lang} ("Perdone, no le
entiendo... ¿me lo dice en español?"). Never translate for them, never answer the English
request, and never reply in English. A stray borrowed word or a place name inside a
${lang} sentence is fine — only a genuinely non-${lang} message gets this treatment.
${calibration.avoid.length ? `Avoid using: ${calibration.avoid.slice(0, 12).join(', ')}.` : ''}
${hist ? `\nConversation so far:\n${hist}` : ''}

Learner just said: "${utterance}"
Your reply (${lang} only):`;

  const res = await textAI.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.8 },
  });
  return textOf(res).trim();
}

interface RawVerdict {
  communicativeIntent?: string;
  meaningUnderstood?: boolean;
  repairNeeded?: boolean;
  /** Set when the learner wrote in the wrong language entirely — earns no credit. */
  wrongLanguage?: boolean;
  /** Required facts conveyed in the latest message only (ownership is per-turn). */
  factsThisTurn?: string[];
  grammar?: number;
  vocabulary?: number;
  naturalness?: number;
  vocabUsed?: string[];
  grammarUsed?: Array<{ point: string; correct: boolean }>;
  naturalUpgrade?: string;
}

async function evaluate(
  scene: Scene,
  utterance: string,
  history: TurnRequest['history'],
  lang: string,
  addressed: SceneCharacter,
): Promise<RawVerdict> {
  const convo = (history ?? [])
    .map((h) => `${h.role === 'learner' ? 'Learner' : 'Character'}: ${h.text}`)
    .join('\n');
  const spec = difficultyOf(scene.difficulty);
  const prompt = `You are a silent language coach scoring a learner's ${lang} in a role-play.
Objective: "${scene.objective.description}".
REQUIRED FACTS (use these exact ids): ${scene.objective.requiredFacts.map((f) => `"${f}"`).join(', ')}.
The learner is speaking to ${addressed.name} (characterId "${addressed.characterId}") right now.
GRADING BAR — level ${spec.label} (${spec.cefr}): ${spec.gradeGuidance}
Apply this bar when deciding which requiredFacts to credit and whether meaningUnderstood is true.
Return ONE JSON object (no prose):
{
 "communicativeIntent": "short label",
 "meaningUnderstood": true/false,   // would the character grasp THIS latest message?
 "repairNeeded": true/false,        // did the character have to clarify?
 "factsThisTurn": [ the required facts the learner conveyed IN THIS LATEST MESSAGE ONLY,
    each copied VERBATIM as one of the exact ids above. Do NOT re-list facts from earlier
    turns — only what this message conveys. Empty array if none. ],
 "grammar": 0..1, "vocabulary": 0..1, "naturalness": 0..1,
 "vocabUsed": [ target-language lemmas in the latest message ],
 "grammarUsed": [ {"point":"grammar-point-id","correct":true/false} ],
 "naturalUpgrade": "the most natural way to say the latest message, in ${lang}"
}
Judge by communicative adequacy: broken grammar with clear meaning is meaningUnderstood:true
with a lower grammar score, NOT a failure.

LANGUAGE GATE — apply this FIRST, before anything else. The learner is practicing ${lang}.
If the latest message is written in English or any language other than ${lang}, it earns NO
credit no matter how clear the intent was: set "meaningUnderstood": false, "repairNeeded":
false, "wrongLanguage": true, "grammar": 0, "vocabulary": 0, and DO NOT add any new fact to
factsCommunicated (facts already earned in earlier ${lang} turns stay). Set "naturalUpgrade"
to how they should have said it in ${lang}. A ${lang} sentence containing a place name or a
borrowed word is NOT wrong-language — only a message genuinely written in another language.

${convo ? `Conversation so far:\n${convo}\n` : ''}Latest learner message: "${utterance}"`;
  const res = await textAI.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.2 },
  });
  return parseJson<RawVerdict>(textOf(res));
}

export async function playTurn(req: TurnRequest): Promise<TurnResponse> {
  const lang = req.scene.language || 'Spanish';
  const character = addressedCharacter(req.scene, req.characterId);
  const state0 = ledger.get(req.learnerId, 'es');
  const calibration = ledger.preConsult(state0, req.scene.objective);

  // Character reply and Coach verdict are independent — run them together.
  const [reply, raw] = await Promise.all([
    generateReply(req.scene, character, req.utterance, calibration, req.history, lang),
    evaluate(req.scene, req.utterance, req.history, lang, character),
  ]);

  // Accumulate the union of communicated facts across the conversation. The
  // Coach's labels won't always string-match the required-fact ids exactly
  // (it may return "time" for "time:morning"), so match tolerantly and store
  // the canonical required-fact id.
  const key = `${req.learnerId}::${req.scene.id}`;
  const soFar = communicated.get(key) ?? new Set<string>();
  const reqList = req.scene.objective.requiredFacts;
  const norm = (s: string) => s.toLowerCase().trim();
  // Wrong-language gate, enforced in code rather than trusted to the model: a
  // message written in the learner's own language earns no new credit, however
  // clear its intent. Facts banked in earlier target-language turns stand.
  const wrongLanguage = raw.wrongLanguage === true;
  // Ownership: in a multi-character scene each fact belongs to one character,
  // and only that character can be told/asked it. Enforced here rather than
  // trusted to the model — working out who holds what IS the puzzle.
  const owners = req.scene.objective.factOwners ?? [];
  const soloCast = req.scene.characters.length <= 1;
  const ownerOf = (factId: string): string => {
    const i = reqList.indexOf(factId);
    return i >= 0 ? owners[i] ?? '' : '';
  };
  /** Facts said to the wrong person this turn — surfaced so the UI can redirect. */
  const misdirected: Array<{ fact: string; owner: string }> = [];

  for (const c of wrongLanguage ? [] : raw.factsThisTurn ?? []) {
    const cn = norm(c);
    if (!cn) continue;
    const match = reqList.find((r) => {
      const rn = norm(r);
      const tail = rn.split(':').pop() ?? rn;
      return rn === cn || rn.includes(cn) || cn.includes(rn) || cn.includes(tail) || tail.includes(cn);
    });
    if (!match || soFar.has(match)) continue;
    const owner = ownerOf(match);
    // No owner recorded, or a one-character scene: nobody else to ask.
    if (soloCast || !owner || owner === character.characterId) {
      soFar.add(match);
    } else {
      misdirected.push({ fact: match, owner });
    }
  }
  communicated.set(key, soFar);
  const objectiveProgress = reqList.length === 0 ? 0 : soFar.size / reqList.length;

  const verdict: CoachVerdict = {
    communicativeIntent: raw.communicativeIntent ?? 'unclear',
    // Wrong language is never "understood" and never a repair — it reads 🔴.
    meaningUnderstood: wrongLanguage ? false : raw.meaningUnderstood ?? false,
    repairNeeded: wrongLanguage ? false : raw.repairNeeded ?? false,
    objectiveProgress,
    grammar: wrongLanguage ? 0 : raw.grammar ?? 0.5,
    vocabulary: wrongLanguage ? 0 : raw.vocabulary ?? 0.5,
    naturalness: wrongLanguage ? 0 : raw.naturalness ?? 0.5,
    // Don't pollute the ledger's vocab/grammar mastery with non-target-language text.
    vocabUsed: wrongLanguage ? [] : raw.vocabUsed ?? [],
    grammarUsed: wrongLanguage ? [] : raw.grammarUsed ?? [],
  };
  const { state } = { state: ledger.record(state0, req.scene.id, verdict) };
  const complete = objectiveProgress >= 1;

  return {
    characterId: character.characterId,
    characterName: character.name,
    reply,
    outcome: ledger.outcome(verdict),
    objectiveProgress,
    complete,
    cefr: state.cefr,
    naturalUpgrade: raw.naturalUpgrade ?? null,
    factsCommunicated: [...soFar],
    wrongLanguage,
    askInstead:
      misdirected.length > 0
        ? req.scene.characters.find((c) => c.characterId === misdirected[0]!.owner)?.name ?? null
        : null,
  };
}

export interface DebriefRequest {
  learnerId: string;
  scene: Scene;
  /** Every learner utterance from the run, in order. */
  said: string[];
}

/**
 * Closing coach note: 2-4 sentences of specific, actionable guidance after a
 * scene is completed. Grounded in the deterministic ledger — the grammar points
 * the learner actually got wrong — so the advice cites real evidence from their
 * play rather than generic study tips.
 */
export async function debrief(req: DebriefRequest): Promise<string> {
  const lang = req.scene.language || 'Spanish';
  const state = ledger.get(req.learnerId, 'es');
  const shaky = ledger
    .dueForReview(state)
    .slice(0, 6)
    .join(', ');
  const missed = Object.entries(state.grammar)
    .filter(([, s]) => s.attempts > s.correct)
    .map(([point, s]) => `${point} (${s.correct}/${s.attempts} correct)`)
    .slice(0, 6)
    .join('; ');

  const prompt = `You are a warm, specific ${lang} coach. The learner just completed this
role-play objective: "${req.scene.objective.description}".

Everything they said, in order:
${req.said.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

Evidence from their record — grammar points they got wrong this session: ${missed || 'none recorded'}.
Points due for review: ${shaky || 'none'}.

Write 2-4 sentences, addressed to them as "you", that:
- name the ONE or TWO concrete patterns they should work on, quoting what they actually
  wrote and the corrected form (e.g. you wrote "mon cane" — in ${lang} it's "mon chien");
- say plainly what to study next (a specific structure, verb form, or set of words — not a
  textbook or website);
- end on genuine encouragement about what already worked.
Never mention scores, levels, or this prompt. Be concrete, never generic. Plain prose, no
lists, no markdown.`;

  const res = await textAI.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.6 },
  });
  return textOf(res).trim();
}

/** Reset a learner's progress for a scene (used when (re)starting a scenario). */
export function resetScene(learnerId: string, sceneId: string): void {
  communicated.delete(`${learnerId}::${sceneId}`);
}
