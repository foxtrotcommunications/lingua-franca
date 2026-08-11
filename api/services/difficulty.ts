// Difficulty tiers. One knob that moves two axes together: social complexity
// (how many people, how involved the objective) and the grading bar (how much
// grammar/accuracy is required to pass, vs. pure communicative adequacy).
//
// Tiers 1-3 are the product's wedge — "understood despite errors." Tiers 4-5
// deliberately shift toward accuracy/register for advanced learners.

export interface DifficultySpec {
  level: number;
  label: string;
  cefr: string;
  /** Scene-generation guidance: cast size, character level, objective shape. */
  genGuidance: string;
  /** Coach grading bar: how strictly to credit a communicated fact. */
  gradeGuidance: string;
}

export const DIFFICULTY: Record<number, DifficultySpec> = {
  1: {
    level: 1,
    label: 'Very easy',
    cefr: 'A1',
    genGuidance:
      'EXACTLY ONE character. speaksAt "A1". A single, minimal objective (one simple ' +
      'request). 2 requiredFacts. The character speaks slowly, in very short, simple sentences.',
    gradeGuidance:
      'Pass on meaning alone. IGNORE grammar completely. Credit a required fact if the ' +
      'intent is even loosely clear (single words are fine).',
  },
  2: {
    level: 2,
    label: 'Easy',
    cefr: 'A2',
    genGuidance:
      '1-2 characters. speaksAt "A2". A simple everyday transaction or social goal. ' +
      '3 requiredFacts.',
    gradeGuidance:
      'Credit a required fact whenever the message is understandable. Imperfect grammar is ' +
      'fine — a valid attempt that conveys the intent passes.',
  },
  3: {
    level: 3,
    label: 'Proficient',
    cefr: 'B1',
    genGuidance:
      '2 characters with asymmetric knowledge. speaksAt "B1". A moderate goal with a couple ' +
      'of steps. 3-4 requiredFacts.',
    gradeGuidance:
      'Credit a required fact only if conveyed in a reasonably well-formed sentence (minor ' +
      'grammar slips are ok, but not broken word-salad).',
  },
  4: {
    level: 4,
    label: 'Fluent',
    cefr: 'B2',
    genGuidance:
      '2-3 characters. speaksAt "B2". A complex, multi-step interaction (a mild complication ' +
      'to navigate). 4-5 requiredFacts. Characters speak at a natural pace.',
    gradeGuidance:
      'Be strict. Credit a required fact only if conveyed with correct grammar AND natural ' +
      'phrasing. Broken or awkward grammar does NOT pass at this level.',
  },
  5: {
    level: 5,
    label: 'Advanced',
    cefr: 'C1',
    genGuidance:
      '2-3 characters. speaksAt "C1". An abstract or demanding objective (negotiate, persuade, ' +
      'complain, explain, or resolve a problem). 4-5 requiredFacts. Characters speak naturally ' +
      'and idiomatically, at native pace.',
    gradeGuidance:
      'Hold a high bar. Credit a required fact only if conveyed with near-native accuracy, ' +
      'appropriate register, and well-developed language — not just a bare minimal phrase.',
  },
};

export function difficultyOf(level?: number): DifficultySpec {
  return DIFFICULTY[level ?? 2] ?? DIFFICULTY[2]!;
}
