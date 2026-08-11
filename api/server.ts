// Lingua Franca API server: image generation, scenario generation, and the
// per-turn play runtime. Stateless — all learner state is client-held (see
// playEngine.ts), so this runs on Cloud Run with scale-to-zero.
//
// Dev: Vite proxies /api → this server. Production (single container): the
// built client in dist/ is served from here as well.

import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateImage, scenePrompt, characterPrompt } from './services/images.js';
import { generateScenario } from './services/scenarioGen.js';
import { playTurn, debrief, type TurnRequest, type DebriefRequest } from './services/playEngine.js';

const app = express();
app.use(express.json({ limit: '12mb' }));

/**
 * Structured usage event → stdout → Cloud Logging. Dimensions only — never
 * learner text and never learner ids: the product's privacy stance is that the
 * server retains nothing per learner, and analytics follow the same rule.
 */
function track(evt: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ evt, ...fields }));
}

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err: unknown) => {
      console.error('[api]', (err as Error)?.message ?? err);
      res.status(500).json({ error: (err as Error)?.message ?? 'internal error' });
    });
  };

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post(
  '/api/images/generate',
  wrap(async (req, res) => {
    const { prompt, reference } = req.body as { prompt: string; reference?: string };
    res.json({ dataUrl: await generateImage(prompt, reference) });
  }),
);

app.post(
  '/api/images/scene',
  wrap(async (req, res) => {
    const { location, detail, reference } = req.body as {
      location: string;
      detail?: string;
      reference?: string;
    };
    const dataUrl = await generateImage(scenePrompt(location, detail ?? ''), reference);
    track('image_generated', { kind: 'scene' });
    res.json({ dataUrl });
  }),
);

app.post(
  '/api/images/character',
  wrap(async (req, res) => {
    const { name, persona, reference } = req.body as {
      name: string;
      persona: string;
      reference?: string;
    };
    const dataUrl = await generateImage(characterPrompt(name, persona), reference);
    track('image_generated', { kind: 'character' });
    res.json({ dataUrl });
  }),
);

app.post(
  '/api/scenario/generate',
  wrap(async (req, res) => {
    const { description, difficulty } = req.body as {
      description: string;
      difficulty?: number;
    };
    const scene = await generateScenario(description, difficulty);
    track('scenario_generated', {
      language: scene.language,
      difficulty: scene.difficulty,
      cast: scene.characters.length,
      facts: scene.objective.requiredFacts.length,
    });
    res.json({ scene });
  }),
);

app.post(
  '/api/play/turn',
  wrap(async (req, res) => {
    const body = req.body as TurnRequest;
    const r = await playTurn(body);
    track('turn', {
      language: body.scene.language,
      difficulty: body.scene.difficulty,
      outcome: r.outcome,
      wrongLanguage: r.wrongLanguage,
      progress: Math.round(r.objectiveProgress * 100) / 100,
      complete: r.complete,
    });
    res.json(r);
  }),
);

app.post(
  '/api/play/debrief',
  wrap(async (req, res) => {
    const body = req.body as DebriefRequest;
    const note = await debrief(body);
    track('debrief', {
      language: body.scene.language,
      difficulty: body.scene.difficulty,
      turns: body.said.length,
    });
    // `note` is the legacy single-paragraph field: clients cached from before
    // the right/improve split read it, so a deploy can't strand them on a
    // spinner. Remove once index.html no-cache has been live a while.
    res.json({ ...note, note: [note.right, note.improve].filter(Boolean).join(' ') });
  }),
);

// Production: serve the built client (dist/) and SPA-fallback everything that
// isn't /api. In dev there is no dist/ and Vite serves the client instead.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (existsSync(dist)) {
  // Vite content-hashes everything under /assets, so those are immutable;
  // index.html must always revalidate or a deploy strands browsers on a stale
  // client talking to a newer API (learned the hard way).
  app.use(
    express.static(dist, {
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    } else {
      next();
    }
  });
}

// Cloud Run injects PORT; API_PORT is the dev override (Vite proxies to it).
const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);
app.listen(PORT, () => console.log(`[lingua-franca] API on :${PORT}`));
