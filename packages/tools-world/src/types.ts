// Plugin infrastructure types for @lingua-franca/tools-world.
// Mirrors the shape roundtable-core expects from @pendragon/tools-plaid:
// a tool registry, a capability registry, a per-workspace config resolved from
// the environment, and optional application hooks.

export type DomainType = 'world' | 'character' | 'coach';

/** A tool the workspace's own model can see and call. */
export interface ToolDefinition {
  description: string;
  parameters?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ToolRegistry {
  register(name: string, tool: ToolDefinition): void;
}

/** A capability other workspaces invoke over A2A (op: "capability"). */
export type CapabilityHandler = (
  input: Record<string, unknown>,
  ctx: CapabilityContext,
) => Promise<unknown> | unknown;

export interface CapabilityContext {
  workspaceId: string;
  domainType: DomainType;
}

export interface CapabilityRegistry {
  register(name: string, handler: CapabilityHandler): void;
}

/** Resolved per-workspace configuration (from RT_* env + workspace identity). */
export interface WorldPluginConfig {
  domainType: DomainType;
  workspaceId: string;
  /** The character/scene identity this pod embodies (from the blueprint metadata). */
  characterId?: string;
  sceneId?: string;
  targetLanguage: string;
  databaseUrl?: string;
}

// ─── Application hooks (parallel to core's appHooks boundary) ────────────────

export type ProvenanceExtractor = (toolResults: unknown[]) => unknown;
export type ActivityDescriptor = (step: string, target?: string) => string | undefined;
export type PreConsultStep = { label: string; args: Record<string, unknown> };

export interface AppHooks {
  registerProvenanceExtractor?: (fn: ProvenanceExtractor) => void;
  registerActivityDescriptor?: (fn: ActivityDescriptor) => void;
  registerSystemPromptSections?: (fn: () => string) => void;
  registerDomainRoutingDescriber?: (fn: (target: string) => string) => void;
  registerPreConsultDescriber?: (fn: (ctx: { workspaceName: string }) => PreConsultStep[]) => void;
  overrideToolDescription?: (toolName: string, description: string) => void;
}

export type { Cefr, CoachVerdict, LedgerState, I1Calibration, Objective, Outcome } from './ledger/ledger.types.js';
