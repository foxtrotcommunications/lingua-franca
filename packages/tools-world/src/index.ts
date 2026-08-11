// src/index.ts — Plugin entry point for @lingua-franca/tools-world.
// This is what roundtable-core imports to register world/character/coach tools
// and capabilities into a workspace based on its domain type. Mirrors the shape
// of @pendragon/tools-plaid.

import type {
  DomainType,
  ToolRegistry,
  CapabilityRegistry,
  WorldPluginConfig,
  AppHooks,
} from './types.js';
import { registerWorldTools, registerWorldCapabilities, SCENE_CAPS } from './domains/world.js';
import {
  registerCharacterTools,
  registerCharacterCapabilities,
  CHARACTER_CAPS,
} from './domains/character.js';
import { registerCoachTools, registerCoachCapabilities, LEDGER_CAPS } from './domains/coach.js';
import { extractLearningProvenance, describeSceneActivity } from './provenance/extract.js';
import {
  LANGUAGE_SYSTEM_PROMPT_SECTIONS,
  describeSceneRouting,
  RECORD_VERDICT_DESCRIPTION,
} from './prompt/sections.js';

export { Ledger, InMemoryLedgerStore, emptyLedger } from './ledger/ledger.js';
export { extractLearningProvenance, describeSceneActivity } from './provenance/extract.js';
export { LANGUAGE_SYSTEM_PROMPT_SECTIONS, describeSceneRouting } from './prompt/sections.js';
export * from './types.js';

// ─── Domain → Registrars Mapping ────────────────────────────────────────────

const DOMAIN_REGISTRARS: Record<
  DomainType,
  {
    tools: (registry: ToolRegistry, config: WorldPluginConfig) => void;
    capabilities: (registry: CapabilityRegistry, config: WorldPluginConfig) => void;
  }
> = {
  world: { tools: registerWorldTools, capabilities: registerWorldCapabilities },
  character: { tools: registerCharacterTools, capabilities: registerCharacterCapabilities },
  coach: { tools: registerCoachTools, capabilities: registerCoachCapabilities },
};

// ─── Allowed Operations (no external service — kept for parity with core) ────

const DOMAIN_ALLOWED_OPS: Record<DomainType, string[]> = {
  world: [],
  character: [],
  coach: [],
};

// ─── Domain → Capabilities Mapping ──────────────────────────────────────────

const DOMAIN_CAPS: Record<DomainType, string[]> = {
  world: [...SCENE_CAPS],
  character: [...CHARACTER_CAPS],
  coach: [...LEDGER_CAPS],
};

// ─── Plugin Object ──────────────────────────────────────────────────────────

export const linguaFrancaWorld = {
  name: 'lingua-franca-world' as const,
  version: '0.1.0',

  register(
    toolRegistry: ToolRegistry,
    capabilityRegistry: CapabilityRegistry,
    config: WorldPluginConfig,
  ): void {
    const registrar = DOMAIN_REGISTRARS[config.domainType];
    if (!registrar) {
      console.warn(`[lingua-franca-world] No registrar for domain type: ${config.domainType}`);
      return;
    }
    registrar.tools(toolRegistry, config);
    registrar.capabilities(capabilityRegistry, config);
    console.log(
      `[lingua-franca-world] Registered tools + capabilities for domain: ${config.domainType}` +
        (config.characterId ? ` (character: ${config.characterId})` : ''),
    );
  },

  getAllowedOps(domainType: DomainType): string[] {
    return DOMAIN_ALLOWED_OPS[domainType] ?? [];
  },

  getCapabilities(domainType: DomainType): string[] {
    return DOMAIN_CAPS[domainType] ?? [];
  },
};

// ─── Auto-detect Config from Environment ────────────────────────────────────

export function registerFromEnv(
  toolRegistry: ToolRegistry,
  capabilityRegistry: CapabilityRegistry,
  hooks?: AppHooks,
): void {
  // App hooks FIRST, before any early return: the provenance extractor runs on
  // the World orchestrator (where character/coach results are aggregated) and
  // the activity descriptor runs on every pod serving chat. Older cores pass no
  // hooks; core then falls back to generic labels.
  if (hooks) {
    try {
      hooks.registerProvenanceExtractor?.(extractLearningProvenance);
      hooks.registerActivityDescriptor?.(describeSceneActivity);
      hooks.registerSystemPromptSections?.(() => LANGUAGE_SYSTEM_PROMPT_SECTIONS);
      hooks.registerDomainRoutingDescriber?.(describeSceneRouting);
      // The World orchestrator MUST pre-consult the Coach's ledger before every
      // turn, so generated character speech stays at i+1. Gated to the World
      // workspace; character/coach pods never pre-consult.
      hooks.registerPreConsultDescriber?.(({ workspaceName }) =>
        workspaceName === 'World'
          ? [
              {
                label: 'learner ledger (i+1)',
                args: { target: 'Coach', op: 'capability', name: 'ledger.preConsult', input: {} },
              },
            ]
          : [],
      );
      hooks.overrideToolDescription?.('record_verdict', RECORD_VERDICT_DESCRIPTION);
      console.log('[lingua-franca-world] Registered provenance extractor + activity descriptor + prompt sections');
    } catch (err) {
      console.warn(`[lingua-franca-world] App hook registration failed: ${(err as Error)?.message}`);
    }
  }

  const config: WorldPluginConfig = {
    domainType: resolveDomainType(),
    workspaceId: process.env.WS_ID || process.env.WORKSPACE_ID || 'default',
    targetLanguage: process.env.LF_TARGET_LANGUAGE || 'es',
    ...(process.env.LF_CHARACTER_ID ? { characterId: process.env.LF_CHARACTER_ID } : {}),
    ...(process.env.LF_SCENE_ID ? { sceneId: process.env.LF_SCENE_ID } : {}),
    ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
  };

  linguaFrancaWorld.register(toolRegistry, capabilityRegistry, config);
}

function resolveDomainType(): DomainType {
  const explicit = (process.env.DOMAIN_TYPE || process.env.LF_DOMAIN_TYPE || '').toLowerCase();
  if (explicit === 'world' || explicit === 'orchestrator') return 'world';
  if (explicit === 'coach') return 'coach';
  if (explicit === 'character') return 'character';

  // Fall back to a workspace-name heuristic, like tools-plaid does.
  const wsName = (process.env.WS_NAME || '').toLowerCase();
  if (wsName.includes('world')) return 'world';
  if (wsName.includes('coach')) return 'coach';
  return 'character';
}
