// Provision the Lingua Franca scene on Roundtable from the blueprints.
//
//   ROUNDTABLE_API_KEY=<org-admin-key> npm run provision
//
// Steps (idempotent where the control plane allows):
//   1. Register the application manifest (upsert blueprints).
//   2. Create + start the 5 workspaces from their templates.
//   3. Create bidirectional governance contracts: World ↔ each character, and
//      World ↔ Coach, scoped to the allowedActions from domain-constants.ts.
//   4. Print the pod directory (URLs + A2A keys) for the runtime A2A client.
//
// NOTE: the pods only carry Lingua Franca tools/capabilities if the core image
// they run was built with the @lingua-franca/tools-world plugin (PLUGINS build
// arg), same as Pendragon. Publish + bake the plugin before provisioning.

import { ControlPlaneClient, type WorkspaceRef } from '../services/roundtable.js';
import { linguaFrancaManifest } from '../application/manifest.js';
import { DOMAIN_ACTIONS } from '../services/domain-constants.js';
import { madridStation } from '../scenes/madrid-station.js';
import { DOMAIN_AI_PROVIDER, DOMAIN_AI_MODEL } from '../services/domain-constants.js';
import type { PodDirectory, PodRef } from '../orchestrator/roundtableClient.a2a.js';

interface ProvisionedPod {
  role: 'world' | 'coach' | 'character';
  characterId?: string;
  workspace: WorkspaceRef;
}

// The core image with the Lingua Franca plugin baked in (never :latest).
const LF_IMAGE =
  process.env.LF_IMAGE ||
  'us-central1-docker.pkg.dev/roundtable-public/roundtable/roundtable-core:lingua-franca';

async function createAndStart(
  cp: ControlPlaneClient,
  name: string,
  template: string,
): Promise<WorkspaceRef> {
  const ws = await cp.createWorkspace({
    name,
    template,
    provider: DOMAIN_AI_PROVIDER,
    model: DOMAIN_AI_MODEL,
  });
  // Pin to the plugin-baked image (this also brings the pod up + restarts it to
  // pick up the new image). Falls back to a plain start if pinning is disabled.
  if (LF_IMAGE) {
    await cp.deploy(ws.id, LF_IMAGE);
  } else {
    await cp.startWorkspace(ws.id);
  }
  return cp.getWorkspace(ws.id);
}

export async function provisionScene(apiKey: string): Promise<PodDirectory> {
  const cp = new ControlPlaneClient(apiKey);

  console.log('[provision] registering application manifest…');
  const reg = await cp.registerApplication('lingua-franca', linguaFrancaManifest);
  console.log(`[provision] registered ${reg.blueprintCount ?? '?'} blueprints`);

  // 1. World + Coach.
  const pods: ProvisionedPod[] = [];
  pods.push({ role: 'world', workspace: await createAndStart(cp, 'World', 'lingua-franca-world') });
  pods.push({ role: 'coach', workspace: await createAndStart(cp, 'Coach', 'lingua-franca-coach') });

  // 2. Character pods, from the scene roster.
  for (const c of madridStation.characters) {
    const ws = await createAndStart(cp, c.name, c.blueprint ?? `lingua-franca-${c.characterId}`);
    pods.push({ role: 'character', characterId: c.characterId, workspace: ws });
    console.log(`[provision] character ${c.characterId} → ${ws.id}`);
  }

  const world = pods.find((p) => p.role === 'world')!;
  const coach = pods.find((p) => p.role === 'coach')!;

  // 3. Contracts: World → Coach (ledger actions), World → each character.
  // Non-fatal: a contract-shape mismatch shouldn't discard the provisioned
  // fleet — log and continue so the directory still prints.
  const mkContract = async (name: string, targetId: string, fields: string[]) => {
    try {
      await cp.createContract({
        name,
        sourceWorkspaceId: world.workspace.id,
        targetWorkspaceId: targetId,
        accessLevel: 'delegate',
        fields,
      });
      console.log(`[provision] contract ${name} created`);
    } catch (err) {
      console.warn(`[provision] contract ${name} FAILED (non-fatal): ${(err as Error).message}`);
    }
  };
  await mkContract('world-coach', coach.workspace.id, DOMAIN_ACTIONS.coach ?? []);
  for (const p of pods.filter((x) => x.role === 'character')) {
    await mkContract(`world-${p.characterId}`, p.workspace.id, DOMAIN_ACTIONS.character ?? []);
  }

  const toRef = (ws: WorkspaceRef): PodRef => ({
    workspaceUrl: ws.url ?? '',
    a2aApiKey: ws.a2aApiKey ?? '',
  });

  const directory: PodDirectory = {
    world: toRef(world.workspace),
    coach: toRef(coach.workspace),
    characters: Object.fromEntries(
      pods.filter((p) => p.role === 'character').map((p) => [p.characterId!, toRef(p.workspace)]),
    ),
  };

  console.log('[provision] pod directory:\n' + JSON.stringify(directory, null, 2));
  return directory;
}

// Run directly: `npm run provision`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const apiKey = process.env.ROUNDTABLE_API_KEY;
  if (!apiKey) {
    console.error('ROUNDTABLE_API_KEY is required');
    process.exit(1);
  }
  provisionScene(apiKey).catch((err) => {
    console.error('[provision] failed:', err);
    process.exit(1);
  });
}
