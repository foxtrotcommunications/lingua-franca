// Shared Gemini (Vertex) clients. Text uses gemini-3.5-flash on the GLOBAL
// endpoint (3.5+ is global-only — verified); images use gemini-2.5-flash-image
// regionally (us-central1). Auth is ADC.

import { GoogleGenAI } from '@google/genai';

const PROJECT = process.env.GCP_PROJECT || 'roundtable-public';

/** Text/reasoning client — global endpoint for Gemini 3.5+. */
export const textAI = new GoogleGenAI({
  vertexai: true,
  project: PROJECT,
  location: process.env.GCP_TEXT_LOCATION || 'global',
});
export const TEXT_MODEL = process.env.LF_MODEL || 'gemini-3.5-flash';

/** Image client — regional (gemini-2.5-flash-image lives in us-central1). */
export const imageAI = new GoogleGenAI({
  vertexai: true,
  project: PROJECT,
  location: process.env.GCP_IMAGE_LOCATION || 'us-central1',
});
export const IMAGE_MODEL = 'gemini-2.5-flash-image';
