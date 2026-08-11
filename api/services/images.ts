// Scene + character image generation via gemini-2.5-flash-image ("nano banana").
// Conversational, so we can pass a style reference image to keep characters and
// backdrops visually consistent across a scenario.

import { imageAI, IMAGE_MODEL } from './genai.js';

interface Part {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

/**
 * Generate one image, returning a data: URL. If `referenceDataUrl` is given, it
 * is passed as visual context so the result matches that style (e.g. character
 * portraits that share the scene's look).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Image generation is the rate-limited path — 429s are common under a burst. */
function isRateLimited(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
}

export async function generateImage(prompt: string, referenceDataUrl?: string): Promise<string> {
  const parts: Part[] = [];
  if (referenceDataUrl) {
    const m = /^data:(.+?);base64,(.*)$/.exec(referenceDataUrl);
    if (m && m[1] && m[2]) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  parts.push({ text: prompt });

  // Retry rate limits with backoff. A scene fires its backdrop + every portrait
  // in a burst, which trips Vertex's per-minute image quota; the window can
  // outlast a short backoff, so ride it out to ~40s. Jitter keeps concurrent
  // portrait retries from re-colliding on the same tick.
  const delays = [2000, 5000, 12000, 20000];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await imageAI.models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: 'user', parts }],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });
      const out = (res.candidates?.[0]?.content?.parts ?? []) as Part[];
      const img = out.find((p) => p.inlineData?.data);
      if (!img?.inlineData?.data) throw new Error('No image returned by the model');
      return `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`;
    } catch (err) {
      const delay = delays[attempt];
      if (delay === undefined || !isRateLimited(err)) {
        throw new Error(
          isRateLimited(err)
            ? 'Image service is busy right now (rate limit).'
            : (err as Error)?.message ?? 'Image generation failed',
        );
      }
      await sleep(delay + Math.floor(Math.random() * 750));
    }
  }
}

const STYLE =
  'Warm, painterly digital illustration, soft natural light, storybook game art, ' +
  'cohesive muted palette, no text, no watermarks, no UI.';

/** A wide establishing backdrop for a scene location. */
export function scenePrompt(location: string, detail: string): string {
  return `A wide establishing shot of ${location}. ${detail}. Empty of any speech or labels. ${STYLE} 16:9 composition.`;
}

/** A friendly character portrait, framed for a dialogue avatar. */
export function characterPrompt(name: string, persona: string): string {
  return `Character portrait of ${name}: ${persona}. Head-and-shoulders, facing the viewer, warm expression, neutral background. ${STYLE}`;
}
