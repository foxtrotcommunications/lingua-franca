// One live turn through the ADK World agent against Gemini via Vertex.
//
//   npm run demo -- "Hola, quiero ir a Toledo mañana a las nueve, pago con tarjeta"
//
// Uses the FakeRoundtableClient (real deterministic ledger; canned character
// replies) since the character/coach pods aren't provisioned yet — this proves
// the ADK agent + FunctionTools + Gemini loop end to end.

import { makeRoundtableClient } from './clientFactory.js';
import { runTurn } from './worldAgent.js';
import { madridStation } from '../scenes/madrid-station.js';

const learnerId = 'demo-learner-1';
const utterance =
  process.argv[2] ?? 'Hola, quiero ir a Toledo mañana a las nueve, y pago con tarjeta';

// Defaults to the fake client (deterministic ledger, canned replies); set
// LF_USE_PODS=true with a provisioned directory to drive the real pods.
const client = makeRoundtableClient();
const ctx = { learnerId, sceneId: madridStation.id, objective: madridStation.objective };

console.log(`\n🎬 Scene: ${madridStation.banner}`);
console.log(`🎯 Objective: ${madridStation.objective.description}`);
console.log(`\n🧑 LEARNER: ${utterance}\n`);

const reply = await runTurn({ client, ctx, utterance });

console.log(`🌍 WORLD REPLY:\n${reply}\n`);

const state = await client.getState(learnerId);
console.log('📒 LEDGER after turn:');
console.log(
  JSON.stringify(
    {
      turn: state.turn,
      cefr: state.cefr,
      objectiveProgress: state.objectives[madridStation.id] ?? 0,
      vocabSeen: Object.keys(state.vocab),
    },
    null,
    2,
  ),
);
