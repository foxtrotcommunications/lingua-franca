/**
 * Scene 1 — Madrid, Estación de tren.
 *
 * Objective: buy a ticket to Toledo for tomorrow morning. The learner must make
 * four facts understood (destination, date, time, payment). Character knowledge
 * is deliberately ASYMMETRIC — Lucía has the schedule, Mateo does not — which is
 * why each character is its own pod with its own blueprint, not one omniscient
 * model wearing three hats.
 */

import type { Scene } from './types.js';

export const madridStation: Scene = {
  id: 'madrid-station',
  location: 'Madrid — Estación de tren',
  banner: '🇪🇸 Madrid — Train Station',
  language: 'Spanish',
  difficulty: 2,
  objective: {
    id: 'buy-ticket-toledo',
    description: 'Get a ticket to Toledo for tomorrow morning.',
    requiredFacts: ['destination:toledo', 'date:tomorrow', 'time:morning', 'payment'],
  },
  characters: [
    {
      characterId: 'lucia',
      name: 'Lucía',
      persona: 'Ticket clerk; impatient but helpful.',
      knows: ['train schedule to Toledo', 'prices', 'platforms', 'ticket rules'],
      speaksAt: 'A2',
      entersWhen: 'start',
      blueprint: 'lingua-franca-lucia',
    },
    {
      characterId: 'mateo',
      name: 'Mateo',
      persona: 'A friendly fellow traveler; knows the station but not the schedule.',
      knows: ['station layout', 'where the ticket counter is'],
      speaksAt: 'A2',
      entersWhen: 'start',
      blueprint: 'lingua-franca-mateo',
    },
    {
      characterId: 'inspector',
      name: 'Inspector',
      persona: 'Ticket inspector; official but fair.',
      knows: ['ticket validation', 'penalty rules'],
      speaksAt: 'A2',
      entersWhen: 'after_objective',
      blueprint: 'lingua-franca-inspector',
    },
  ],
};
