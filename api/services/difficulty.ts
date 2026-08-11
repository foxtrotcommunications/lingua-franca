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
  /**
   * Correction bar: how sophisticated the naturalUpgrade and its explanation
   * may be. Feedback is i+1 like everything else — the grading bar and the
   * character's speech are tier-gated, and so is what we teach back.
   */
  feedbackGuidance: string;
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
    feedbackGuidance:
      'Corrections must be the SIMPLEST natural phrase a beginner could retain — short, ' +
      'everyday spoken register (prefer "C\'est combien ?" over "Quel est le prix ?", ' +
      '"Comment on dit...?" over formal inversion). Give ONE confident correction, never ' +
      'alternatives. The explanation is ONE short sentence about the single most useful ' +
      'pattern — no grammar terminology beyond what a beginner needs.',
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
    feedbackGuidance:
      'Corrections must be the simplest natural phrase for the situation, in everyday spoken ' +
      'register. ONE confident correction, never alternatives. Explanation: 1 short sentence ' +
      'on the one pattern that matters most.',
  },
  3: {
    level: 3,
    label: 'Proficient',
    cefr: 'B1',
    genGuidance:
      '2 characters with asymmetric knowledge. speaksAt "B1". A moderate goal with a couple ' +
      'of steps. 3-4 requiredFacts.',
    gradeGuidance:
      'Understanding requires a reasonably well-formed sentence — broken word-salad reads ' +
      'as a repair (🟡) or a failure, not clean comprehension. Once the meaning lands, even ' +
      'via repair, the facts credit; the correction flags the quality gap.',
    feedbackGuidance:
      'Corrections should be natural phrasing within reach of an intermediate learner — no ' +
      'advanced constructions. One pattern per correction, explanation 1-2 sentences.',
  },
  4: {
    level: 4,
    label: 'Fluent',
    cefr: 'B2',
    genGuidance:
      '2-3 characters. speaksAt "B2". A complex, multi-step interaction (a mild complication ' +
      'to navigate). 4-5 requiredFacts. Characters speak at a natural pace.',
    gradeGuidance:
      'Be strict about what counts as understood: at this level broken or awkward grammar ' +
      'reads as needing repair (🟡) or as not understood (🔴) — a native in this setting ' +
      'would ask them to say it again. Once genuinely understood, even via repair, the ' +
      'facts credit; withhold credit only when the meaning did not land.',
    feedbackGuidance:
      'Corrections at fully natural native phrasing; explanations may name register and ' +
      'nuance in 1-2 sentences.',
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
      'Hold a high bar for understanding: anything short of near-native accuracy and ' +
      'appropriate register reads as needing repair (🟡), and bare minimal phrases or ' +
      'broken language as not understood (🔴) — this is a demanding setting. Once ' +
      'genuinely understood, even via repair, the facts credit.',
    feedbackGuidance:
      'Corrections at native polish, including register and idiom; detailed explanations ' +
      'are appropriate at this level.',
  },
};

export function difficultyOf(level?: number): DifficultySpec {
  return DIFFICULTY[level ?? 2] ?? DIFFICULTY[2]!;
}
