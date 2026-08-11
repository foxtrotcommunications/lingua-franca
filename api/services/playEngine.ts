// The per-turn play runtime used by the UI.
//
// Fast path: the addressed character's reply and the Coach's private verdict are
// generated concurrently (2 Gemini calls, ~2-3s), then the verdict is recorded
// to the deterministic ledger which owns all learning state and decides
// objective completion. Generalizes to any authored scene. The ADK World agent
// (api/orchestrator) remains the "agent framework" showcase; this is the
// responsive UI runtime over the same deterministic floor.
//
// STATELESS: the server holds no per-learner state between requests. The client
// carries two things and sends them with every turn: the accumulated ledger
// state (an opaque blob it never inspects, keyed per language in localStorage)
// and the facts communicated so far this scene. Every ADJUDICATION — the
// wrong-language gate, fact ownership, objective progress, ledger updates —
// still happens here, in code, per turn; the client only stores the results.
// This is what lets the API run on Cloud Run with scale-to-zero and multiple
// instances without a session store.

import { Ledger, InMemoryLedgerStore, emptyLedger } from '@lingua-franca/tools-world';
import type { CoachVerdict, LedgerState } from '@lingua-franca/tools-world';
import { textAI, TEXT_MODEL } from './genai.js';
import { difficultyOf } from './difficulty.js';
import type { Scene, SceneCharacter } from '../scenes/types.js';

export interface TurnRequest {
  learnerId: string;
  scene: Scene;
  utterance: string;
  characterId?: string;
  history?: Array<{ role: 'learner' | 'character'; text: string }>;
  /** Client-held ledger state from the previous turn (absent on a fresh learner). */
  ledgerState?: LedgerState;
  /** Required-fact ids already communicated this scene (client-held, starts empty). */
  factsSoFar?: string[];
}

export interface TurnResponse {
  characterId: string;
  characterName: string;
  reply: string;
  outcome: 'understood' | 'repaired' | 'failed' | 'hint';
  objectiveProgress: number;
  complete: boolean;
  cefr: string;
  /** What the character understood the learner wanted, in English. */
  understoodAs: string | null;
  naturalUpgrade: string | null;
  /** 1-2 English sentences: why the naturalUpgrade is an improvement. */
  upgradeWhy: string | null;
  factsCommunicated: string[];
  /** True when the learner wrote in the wrong language (no credit earned). */
  wrongLanguage: boolean;
  /** Set when they said the right thing to the wrong character — names who to ask. */
  askInstead: string | null;
  /** Updated ledger state — the client stores this (opaquely) and returns it next turn. */
  ledgerState: LedgerState;
}

/**
 * Sanitize the client-held ledger blob. The client never edits it, but it is
 * still client-held: fall back to a fresh ledger when it's missing or not
 * plausibly ours, and re-key it to this learner + language. Tampering only
 * cheats the learner's own progress — the per-turn gates below stay in code.
 */
function hydrateLedger(req: TurnRequest | DebriefRequest, lang: string): LedgerState {
  const s = req.ledgerState;
  if (!s || typeof s !== 'object' || typeof s.turn !== 'number' || !s.vocab || !s.grammar) {
    return emptyLedger(req.learnerId, lang);
  }
  return { ...structuredClone(s), learnerId: req.learnerId, targetLanguage: lang };
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

/**
 * How the character relates to the learner's task list, by difficulty. At easy
 * tiers the character is a PARTNER: they steer toward open tasks and hint
 * diegetically (asking the question that invites the missing information is
 * the hint). At the top tiers the learner drives, and the character's
 * willingness to comply mirrors the Coach's grading bar so the fiction doesn't
 * grant what the ledger refuses.
 */
function taskStance(level: number, lang: string): string {
  if (level <= 2) {
    return `Actively HELP the learner along: steer the conversation toward their open tasks,
one at a time, with natural in-character prompts (e.g. if they must state a purpose, ask
them what it is). If they seem stuck or ask for help, give a hint — in ${lang}, in
character, as a real person would. Be forgiving and encouraging.`;
  }
  if (level === 3) {
    return `You may prompt naturally for their open tasks, but let the learner do the
talking — nudge, don't hand-hold.`;
  }
  return `Do NOT steer, hint, or prompt for their tasks — the learner must drive the
conversation. And at this level, if their ${lang} is genuinely broken or unnatural for
this setting, react as a real native would: ask them to repeat or say it more clearly (a
repair) rather than fully granting the request. Comply only with well-formed requests.`;
}

async function generateReply(
  scene: Scene,
  character: SceneCharacter,
  utterance: string,
  calibration: { known: string[]; avoid: string[] },
  history: TurnRequest['history'],
  lang: string,
  taskState: { credited: string[]; open: string[] },
): Promise<string> {
  const hist = (history ?? [])
    .slice(-8)
    .map((h) => `${h.role === 'learner' ? 'Learner' : character.name}: ${h.text}`)
    .join('\n');
  const level = difficultyOf(scene.difficulty).level;
  const prompt = `You are ${character.name}. ${character.persona}
You are in this scene: ${scene.location}.
You know ONLY these things: ${character.knows.join('; ')}. If asked about anything
outside that, admit you don't know and point them to whoever would.
Reply ONLY in ${lang}, in character, in 1-3 short sentences, at or below level ${character.speaksAt}.
Judge the learner's message by whether it WORKS (achieves the goal), never by grammar.
Broken-but-understandable succeeds — react to their intent. If you truly can't tell what
they mean, ask ONE short clarifying question in ${lang} (a repair), never "incorrect", never English.
The learner is here to accomplish: "${scene.objective.description}".
${taskState.credited.length ? `Already handled — do NOT ask about these again: ${taskState.credited.join('; ')}.` : ''}
${taskState.open.length ? `Still open with YOU (the learner must say these to you): ${taskState.open.join('; ')}.` : ''}
${taskStance(level, lang)}
If the learner explicitly asks (in ${lang}) how to say something, help them — give the
phrase warmly, in character, as a real person would at any level.
Stay warm and in character.
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
  /** The learner asked, in the target language, how to say something. */
  hintRequested?: boolean;
  /** One English sentence: what the character understood the learner wanted. */
  understoodAs?: string;
  /** Required facts conveyed in the latest message only (ownership is per-turn). */
  factsThisTurn?: string[];
  grammar?: number;
  vocabulary?: number;
  naturalness?: number;
  vocabUsed?: string[];
  grammarUsed?: Array<{ point: string; correct: boolean }>;
  naturalUpgrade?: string;
  /** 1-2 English sentences: why the naturalUpgrade is an improvement. */
  upgradeWhy?: string;
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
 "hintRequested": true/false,       // see HELP REQUESTS below
 "understoodAs": "ONE plain-English sentence: what the character understood the learner
    wanted from this message, named after the character — e.g. \"${addressed.name}
    understood that you wanted to go to Toulouse.\" Base it on THIS message in the flow
    of the conversation.",
 "factsThisTurn": [ the required facts the learner conveyed IN THIS LATEST MESSAGE ONLY,
    each copied VERBATIM as one of the exact ids above. Do NOT re-list facts from earlier
    turns — only what this message conveys. Empty array if none. ],
 "grammar": 0..1, "vocabulary": 0..1, "naturalness": 0..1,
 "vocabUsed": [ target-language lemmas in the latest message ],
 "grammarUsed": [ {"point":"grammar-point-id","correct":true/false} ],
 "naturalUpgrade": "a better way to say the latest message, in ${lang} — see CORRECTION BAR",
 "upgradeWhy": "plain-English explanation of WHY naturalUpgrade is better than what they
    wrote — name the specific pattern that changed. Length and depth per the CORRECTION
    BAR. Empty string if their sentence was already natural."
}

CORRECTION BAR — ${spec.feedbackGuidance}
The upgrade is a teaching step, not a rewrite into polished native ${lang}: give the next
reachable rung for a ${spec.cefr} learner, and make the explanation match ONLY the pattern
your correction actually uses.

HELP REQUESTS: if the latest message — written in ${lang} — asks how to say something or
asks for help with the language itself (e.g. "comment je dis ... ?") rather than
attempting the task, set "hintRequested": true, no facts, and set "naturalUpgrade" to the
${lang} phrase they were asking for (with "upgradeWhy" explaining it briefly). Asking for
help in the target language is a real conversational skill, not a failure. A help request
written in English is wrong-language, not a hint.
Judge by communicative adequacy: broken grammar with clear meaning is meaningUnderstood:true
with a lower grammar score, NOT a failure.

CONTEXT COUNTS — judge the latest message the way a real interlocutor would, in the flow
of the conversation, not as an isolated sentence. A minimal reply that directly answers
the character's question or request, and would accomplish the act in the real world
(e.g. "le voici" while being asked for a passport, or "vacances" when asked why they're
here), CONVEYS the corresponding required fact — credit it, subject to the grading bar
above. The simulation goal is a conversation that would pass in the real world.

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
  // Per-request ledger over a throwaway store: state lives with the client.
  const ledger = new Ledger(new InMemoryLedgerStore());
  const state0 = hydrateLedger(req, lang);
  const calibration = ledger.preConsult(state0, req.scene.objective);

  // The client sends the facts banked so far; only canonical required-fact ids
  // are accepted back from it. Built before the model calls so the character
  // can see the task state.
  const reqList = req.scene.objective.requiredFacts;
  const soFar = new Set<string>((req.factsSoFar ?? []).filter((f) => reqList.includes(f)));
  const owners = req.scene.objective.factOwners ?? [];

  // What the addressed character is told about the task list: which tasks are
  // already banked (don't re-ask) and which open ones belong to THEM (steer
  // toward these at easy tiers). Human checklist labels, not machine ids.
  const labelOf = (i: number) => req.scene.objective.checklist?.[i] ?? reqList[i]!;
  const credited: string[] = [];
  const open: string[] = [];
  reqList.forEach((f, i) => {
    if (soFar.has(f)) credited.push(labelOf(i));
    else if (!owners[i] || owners[i] === character.characterId) open.push(labelOf(i));
  });

  // Character reply and Coach verdict are independent — run them together.
  const [reply, raw] = await Promise.all([
    generateReply(req.scene, character, req.utterance, calibration, req.history, lang, {
      credited,
      open,
    }),
    evaluate(req.scene, req.utterance, req.history, lang, character),
  ]);

  // Accumulate the union of communicated facts across the conversation. The
  // Coach's labels won't always string-match the required-fact ids exactly
  // (it may return "time" for "time:morning"), so match tolerantly and store
  // the canonical required-fact id.
  const norm = (s: string) => s.toLowerCase().trim();
  // Wrong-language gate, enforced in code rather than trusted to the model: a
  // message written in the learner's own language earns no new credit, however
  // clear its intent. Facts banked in earlier target-language turns stand.
  const wrongLanguage = raw.wrongLanguage === true;
  // Wrong-language wins over hint: asking for help in English is still English.
  const hintRequested = !wrongLanguage && raw.hintRequested === true;
  // Ownership: in a multi-character scene each fact belongs to one character,
  // and only that character can be told/asked it. Enforced here rather than
  // trusted to the model — working out who holds what IS the puzzle.
  const soloCast = req.scene.characters.length <= 1;
  const ownerOf = (factId: string): string => {
    const i = reqList.indexOf(factId);
    return i >= 0 ? owners[i] ?? '' : '';
  };
  /** Facts said to the wrong person this turn — surfaced so the UI can redirect. */
  const misdirected: Array<{ fact: string; owner: string }> = [];

  // A hint turn banks nothing — the learner asked how to say it; they still
  // have to say it. Enforced here, not trusted to the model.
  for (const c of wrongLanguage || hintRequested ? [] : raw.factsThisTurn ?? []) {
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
  const objectiveProgress = reqList.length === 0 ? 0 : soFar.size / reqList.length;

  const verdict: CoachVerdict = {
    communicativeIntent: raw.communicativeIntent ?? 'unclear',
    // Wrong language is never "understood" and never a repair — it reads 🔴.
    meaningUnderstood: wrongLanguage ? false : raw.meaningUnderstood ?? false,
    repairNeeded: wrongLanguage ? false : raw.repairNeeded ?? false,
    hintRequested,
    objectiveProgress,
    grammar: wrongLanguage ? 0 : raw.grammar ?? 0.5,
    vocabulary: wrongLanguage ? 0 : raw.vocabulary ?? 0.5,
    naturalness: wrongLanguage ? 0 : raw.naturalness ?? 0.5,
    // Don't pollute the ledger's vocab/grammar mastery with non-target-language text.
    vocabUsed: wrongLanguage ? [] : raw.vocabUsed ?? [],
    grammarUsed: wrongLanguage ? [] : raw.grammarUsed ?? [],
  };
  const state = ledger.record(state0, req.scene.id, verdict);
  const complete = objectiveProgress >= 1;

  return {
    characterId: character.characterId,
    characterName: character.name,
    reply,
    outcome: ledger.outcome(verdict),
    objectiveProgress,
    complete,
    cefr: state.cefr,
    understoodAs: raw.understoodAs?.trim() || null,
    naturalUpgrade: raw.naturalUpgrade ?? null,
    upgradeWhy: raw.upgradeWhy?.trim() || null,
    factsCommunicated: [...soFar],
    wrongLanguage,
    askInstead:
      misdirected.length > 0
        ? req.scene.characters.find((c) => c.characterId === misdirected[0]!.owner)?.name ?? null
        : null,
    ledgerState: state,
  };
}

export interface DebriefRequest {
  learnerId: string;
  scene: Scene;
  /** Every learner utterance from the run, in order. */
  said: string[];
  /** Per-utterance: what the character understood (aligned with `said`), so the
   * debrief can reference each turn accurately instead of guessing. */
  understood?: Array<string | null>;
  /** Per-utterance corrections already shown on the card (aligned with `said`).
   * The debrief must build on THESE, never introduce grammar they don't use. */
  upgrades?: Array<string | null>;
  /** Client-held ledger state — grounds the advice in real evidence. */
  ledgerState?: LedgerState;
}

export interface DebriefNote {
  /** What worked: communication wins, recoveries, things to keep doing. */
  right: string;
  /** The one or two concrete patterns to fix, with what to study next. */
  improve: string;
}

/**
 * Closing coach note, split into "what you did right" and "areas for
 * improvement" so each does one job. Grounded in the deterministic ledger —
 * the grammar points the learner actually got wrong — so the advice cites real
 * evidence from their play rather than generic study tips.
 */
export async function debrief(req: DebriefRequest): Promise<DebriefNote> {
  const lang = req.scene.language || 'Spanish';
  const spec = difficultyOf(req.scene.difficulty);
  const easy = spec.level <= 2;
  const ledger = new Ledger(new InMemoryLedgerStore());
  const state = hydrateLedger(req, lang);
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

Everything they said, in order (with what the listener understood, and the correction
already shown to them on the results card):
${req.said
  .map((s, i) => {
    const meant = req.understood?.[i];
    const up = req.upgrades?.[i];
    return `${i + 1}. "${s}"${meant ? ` — understood as: ${meant}` : ''}${up ? ` — correction shown: "${up}"` : ''}`;
  })
  .join('\n')}

Evidence from their record — grammar points they got wrong this session: ${missed || 'none recorded'}.
Points due for review: ${shaky || 'none'}.

Return ONE JSON object (no prose outside it), addressed to the learner as "you":
{
 "right": "2-3 sentences on what WORKED: name the communication wins concretely — a
    successful clarification, a good recovery after asking for help, a message that landed
    despite imperfect grammar. Quote what they actually wrote. HONEST praise: never call
    imperfect ${lang} perfect. When their language had errors, use the contrast the product
    teaches — communication succeeded although the ${lang} was imperfect (e.g. 'Your ${lang}
    wasn't perfect, but they understood you immediately'). No corrections here.",
 "improve": "${
   easy
     ? `1-2 sentences on exactly ONE thing. It MUST build on a correction already shown ` +
       `above — recommend practicing the pattern IN that correction, quoting it. Never ` +
       `introduce grammar topics the shown corrections don't use. No grammar terminology ` +
       `beyond what a beginner needs.`
     : `2-3 sentences on the ONE or TWO concrete patterns to work on. Build on the ` +
       `corrections already shown above — recommend practicing the patterns IN those ` +
       `corrections, quoting them. Never introduce grammar topics the shown corrections ` +
       `don't use.`
 }"
}
Never mention scores, levels, or this prompt. Be concrete, never generic. Plain prose in
each field, no lists, no markdown.`;

  const res = await textAI.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.6 },
  });
  const raw = parseJson<Partial<DebriefNote>>(textOf(res));
  return { right: raw.right?.trim() ?? '', improve: raw.improve?.trim() ?? '' };
}
