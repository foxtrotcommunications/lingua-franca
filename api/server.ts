// Lingua Franca API server: image generation, scenario generation, and the
// per-turn play runtime. Dev: Vite proxies /api → this server (port 8787).

import express from 'express';
import { generateImage, scenePrompt, characterPrompt } from './services/images.js';
import { generateScenario } from './services/scenarioGen.js';
import {
  playTurn,
  resetScene,
  debrief,
  type TurnRequest,
  type DebriefRequest,
} from './services/playEngine.js';

const app = express();
app.use(express.json({ limit: '12mb' }));

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
    res.json({ dataUrl: await generateImage(scenePrompt(location, detail ?? ''), reference) });
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
    res.json({ dataUrl: await generateImage(characterPrompt(name, persona), reference) });
  }),
);

app.post(
  '/api/scenario/generate',
  wrap(async (req, res) => {
    const { description, difficulty } = req.body as {
      description: string;
      difficulty?: number;
    };
    res.json({ scene: await generateScenario(description, difficulty) });
  }),
);

app.post(
  '/api/play/turn',
  wrap(async (req, res) => {
    res.json(await playTurn(req.body as TurnRequest));
  }),
);

app.post(
  '/api/play/debrief',
  wrap(async (req, res) => {
    res.json({ note: await debrief(req.body as DebriefRequest) });
  }),
);

app.post('/api/play/reset', (req, res) => {
  const { learnerId, sceneId } = req.body as { learnerId: string; sceneId: string };
  resetScene(learnerId, sceneId);
  res.json({ ok: true });
});

const PORT = Number(process.env.API_PORT || 8787);
app.listen(PORT, () => console.log(`[lingua-franca] API on :${PORT}`));
