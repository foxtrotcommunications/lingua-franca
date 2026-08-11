import type { ApplicationManifest } from './types.js';
import { world } from './blueprints/world.js';
import { lucia } from './blueprints/lucia.js';
import { mateo } from './blueprints/mateo.js';
import { inspector } from './blueprints/inspector.js';
import { coach } from './blueprints/coach.js';

/**
 * The Lingua Franca application manifest.
 * Contains all workspace blueprints that define how the game's workspaces
 * (World orchestrator, character pods, private Coach) should be configured
 * when provisioned by Roundtable.
 */
export const linguaFrancaManifest: ApplicationManifest = {
  id: 'lingua-franca',
  name: 'Lingua Franca',
  version: '0.1.0',
  plugin: { package: '@lingua-franca/tools-world' },
  blueprints: {
    'lingua-franca-world': world,
    'lingua-franca-lucia': lucia,
    'lingua-franca-mateo': mateo,
    'lingua-franca-inspector': inspector,
    'lingua-franca-coach': coach,
  },
};
