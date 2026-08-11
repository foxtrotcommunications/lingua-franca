// Selects the RoundtableClient implementation.
//
// Default: the FakeRoundtableClient (deterministic ledger, canned replies) so
// the demo and tests run without live pods. Set LF_USE_PODS=true and provide a
// pod directory (from provisioning) to drive the real Roundtable pods over A2A.

import type { RoundtableClient } from './roundtableClient.js';
import { FakeRoundtableClient } from './roundtableClient.js';
import { A2ARoundtableClient, type PodDirectory } from './roundtableClient.a2a.js';

export function makeRoundtableClient(directory?: PodDirectory): RoundtableClient {
  if (process.env.LF_USE_PODS === 'true') {
    if (!directory) throw new Error('LF_USE_PODS=true but no pod directory was provided');
    return new A2ARoundtableClient(directory);
  }
  return new FakeRoundtableClient(process.env.LF_TARGET_LANGUAGE ?? 'es');
}
