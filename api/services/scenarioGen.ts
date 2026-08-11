// Turn a freeform scene description into a structured, playable Scene via Gemini.
// The author types "a bakery in Paris where I need to buy bread and ask if it's
// fresh"; this expands it into a location, an objective with concrete required
// facts, and a small asymmetric-knowledge cast.

import { textAI, TEXT_MODEL } from './genai.js';
import { difficultyOf } from './difficulty.js';
import type { Scene } from '../scenes/types.js';

const SCHEMA_INSTRUCTIONS = `
You design short language-learning role-play scenes. Given a description and a
target language, output ONE JSON object (no markdown, no prose) with this shape:

{
  "id": "kebab-case-id",
  "location": "human-readable place",
  "banner": "flag emoji + short setting label",
  "language": "the language the characters speak, inferred from the setting",
  "briefing": "2-3 sentences in ENGLISH, second person, setting the player up as they walk in",
  "completeLabel": "a short celebratory 'Mission complete!' written IN THE TARGET LANGUAGE",
  "objective": {
    "id": "kebab-case",
    "description": "the player's goal, in ENGLISH (their native language)",
    "requiredFacts": [
      {
        "id": "kebab-token",
        "label": "short natural imperative the player reads",
        "owner": "characterId of the ONE character this must be said to / asked of"
      }
    ]
  },
  "characters": [
    {
      "characterId": "kebab-case",
      "name": "first name",
      "persona": "one vivid sentence: role, temperament, how they speak",
      "knows": ["3-5 things THIS character knows"],
      "speaksAt": "A1|A2|B1",
      "entersWhen": "start" | "after_objective"
    }
  ]
}

Rules:
- Make knowledge ASYMMETRIC — one character owns the key facts, others do not and
  should defer. Never make everyone omniscient.
- Exactly one character should own the objective and enter at "start".
- requiredFacts must be things the LEARNER conveys, not the character. Each has a short
  machine "id" (kebab-case token), a "label" — a concrete, natural imperative the player
  reads, e.g. "Order a soy cappuccino", "Ask for a table outside" — and an "owner": the
  characterId of the one character it must be said to or asked of. Labels are specific and
  human, never database-like. 2-5 facts.
- OWNERSHIP IS THE PUZZLE. When the scene has more than one character, DISTRIBUTE the facts
  across them so the learner must work out who to approach for what. A fact's owner must be
  the character whose "knows" list actually covers it, or who has the authority to act on
  it — asking the wrong person should be a natural dead end, not a technicality. Give every
  character with entersWhen "start" at least one fact they own. With a single character,
  that character owns them all.
- Give each character a DISTINCT, culturally-appropriate first name, and VARY names
  from scene to scene. Do NOT default to the same few — avoid always reaching for
  Matteo/Mateo, Lucía, Sofía, Marco, or Elena. Pick fresh, real names each time.
- Infer the target language from the place/setting (Rome → Italian, Madrid → Spanish,
  Berlin → German, Tokyo → Japanese, etc.) and set "language" accordingly. If the
  description explicitly names a language to practice, use that instead. The banner's flag
  emoji, the names, and the cultural details must all match that language and place.
- Keep every detail geographically coherent with the setting. If the description carries a
  detail that does not fit (a Naples ticket office selling tickets to Toledo, Spain), quietly
  correct it to a plausible local equivalent rather than passing it through.
- The "briefing" is the player's orientation the moment they arrive: where they are, what
  is happening around them, who is in front of them, and what they came here to do. Write it
  in second person, concrete and specific to THIS scene ("You push through the doors of
  Napoli Centrale. Donatella is behind the ticket window and the queue behind you is
  growing."). Never generic filler, never mention grammar, scores, or the game itself.
- Cast size, character level (speaksAt), and objective complexity MUST follow the
  difficulty guidance provided below.
`.trim();

/** Best-effort JSON extraction from a model response. */
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(raw.slice(start, end + 1));
}

export async function generateScenario(description: string, difficulty = 2): Promise<Scene> {
  const spec = difficultyOf(difficulty);
  // A per-call seed nudges the model off its default names/personas so casts
  // vary run to run instead of always returning Matteo/Lucía.
  const varietySeed = Math.floor(Math.random() * 100000);
  const res = await textAI.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `${SCHEMA_INSTRUCTIONS}\n\n` +
              `Difficulty: ${spec.label} (${spec.cefr}). ${spec.genGuidance}\n\n` +
              `Variety seed: ${varietySeed} — use it to pick fresh names and personas you ` +
              `would not usually default to.\n\n` +
              `Scene description: ${description}\n\nReturn only the JSON.`,
          },
        ],
      },
    ],
    config: { temperature: 0.9 },
  });

  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const parsed = parseJson(text) as Scene & {
    objective?: { requiredFacts?: unknown; checklist?: string[]; factOwners?: string[] };
  };

  // requiredFacts come back as {id,label,owner} objects: split into machine ids
  // (for coach matching / the plugin), a human-readable checklist, and the
  // owning characterId per fact. Tolerate the older string[] shape too.
  const rf = parsed.objective?.requiredFacts;
  if (Array.isArray(rf) && rf.length > 0 && typeof rf[0] === 'object') {
    const rows = rf as Array<{ id?: string; label?: string; owner?: string }>;
    parsed.objective!.checklist = rows.map((p) => String(p.label ?? p.id ?? '').trim());
    parsed.objective!.requiredFacts = rows.map((p) => String(p.id ?? p.label ?? '').trim());
    parsed.objective!.factOwners = rows.map((p) => String(p.owner ?? '').trim());
  }

  // Repair ownership the model may have fumbled: an owner must name a real
  // character, and a single-character scene trivially owns everything.
  const cast = new Set((parsed.characters ?? []).map((c) => c.characterId));
  const fallbackOwner =
    (parsed.characters ?? []).find((c) => c.entersWhen === 'start')?.characterId ??
    parsed.characters?.[0]?.characterId ??
    '';
  if (parsed.objective?.factOwners) {
    parsed.objective.factOwners = parsed.objective.factOwners.map((o) =>
      cast.has(o) ? o : fallbackOwner,
    );
  }

  const scene = parsed as Scene;
  // Minimal shape guard so a malformed generation fails loudly, not silently.
  if (!scene?.objective?.requiredFacts?.length || !scene?.characters?.length) {
    throw new Error('Generated scene is missing objective facts or characters');
  }
  // Language is inferred by the model from the setting; fall back if it omitted it.
  if (!scene.language || !scene.language.trim()) scene.language = 'Spanish';
  // Difficulty is authoritative from the request, not the model.
  scene.difficulty = spec.level;
  return scene;
}
