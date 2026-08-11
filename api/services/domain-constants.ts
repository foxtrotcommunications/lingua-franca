// api/services/domain-constants.ts
//
// Canonical definitions for domain-scoped tools, capability actions, and the
// bridge-contract allowed-actions per domain type. Imported by provisioning to
// keep blueprints and governance contracts in sync. Mirrors Pendragon's
// domain-constants.ts. Kept in lockstep with @lingua-franca/tools-world's
// DOMAIN_CAPS — if you add a capability there, add its action here.

// ─── Domain pod AI ───
// Character/coach/world pods run Gemini via Vertex (hackathon requirement:
// Gemini 3.5+). Keep in sync with the live pods.
export const DOMAIN_AI_PROVIDER = 'gemini-enterprise';
export const DOMAIN_AI_MODEL = 'gemini-3.5-flash';

// ─── Capability action groups (mirror tools-world capabilities) ───

export const LEDGER_ACTIONS = [
  'capability:ledger.get',
  'capability:ledger.preConsult',
  'capability:ledger.record',
  'capability:ledger.dueForReview',
] as const;

export const CHARACTER_ACTIONS = [
  'capability:character.recall',
  'capability:character.remember',
  'capability:character.forget',
] as const;

export const SCENE_ACTIONS = [
  'capability:scene.getState',
  'capability:scene.advance',
  'capability:scene.reset',
] as const;

// ─── Tools enabled per domain workspace ───

const WORLD_TOOLS = ['scene_state'] as const;
const CHARACTER_TOOLS = ['recall_learner', 'remember_about_learner'] as const;
const COACH_TOOLS = ['record_verdict'] as const;

export const DOMAIN_TOOLS: Record<string, readonly string[]> = {
  world: WORLD_TOOLS,
  character: CHARACTER_TOOLS,
  coach: COACH_TOOLS,
};

// ─── Bridge contract allowed-actions per domain ───
// What the World orchestrator may invoke on each pod. Transport actions
// (delegate, discover) are auto-allowed by core, listed here for clarity.

export const DOMAIN_ACTIONS: Record<string, string[]> = {
  // The character pods: World delegates the in-character reply and may touch
  // each character's own memory (recall/remember). No ledger access — only the
  // Coach writes learning state.
  character: [
    'delegate',
    'discover',
    'tool:verify_workspace',
    ...CHARACTER_ACTIONS,
    ...CHARACTER_TOOLS.map((t) => `tool:${t}`),
  ],
  // The Coach: World pre-consults and records verdicts here. Single writer of
  // the deterministic ledger.
  coach: [
    'delegate',
    'discover',
    'tool:verify_workspace',
    ...LEDGER_ACTIONS,
    ...COACH_TOOLS.map((t) => `tool:${t}`),
  ],
  // The World orchestrator: reachable from the app; owns scene runtime state.
  world: [
    'delegate',
    'discover',
    'tool:verify_workspace',
    ...SCENE_ACTIONS,
    ...WORLD_TOOLS.map((t) => `tool:${t}`),
  ],
};
