// Gemini-via-Vertex configuration for the ADK agents.
//
// @google/adk reads these environment variables through @google/genai at model
// call time. We default to the existing Roundtable GCP setup so the orchestrator
// is runnable without a new project; override via GCP_PROJECT / GCP_LOCATION /
// LF_MODEL. Hackathon requirement: Gemini 3.5+ via Vertex AI.

export function configureVertex(): void {
  process.env.GOOGLE_GENAI_USE_VERTEXAI ??= 'true';
  process.env.GOOGLE_CLOUD_PROJECT ??= process.env.GCP_PROJECT ?? 'roundtable-public';
  // Gemini 3.5+ is served from the GLOBAL Vertex endpoint, not a region
  // (regional us-central1 404s for gemini-3.5-flash — verified against
  // roundtable-public). GA models can override to a region via GCP_LOCATION.
  process.env.GOOGLE_CLOUD_LOCATION ??= process.env.GCP_LOCATION ?? 'global';
}

/** The Gemini model id used by every agent. Must be 3.5+ for the hackathon. */
export const WORLD_MODEL = process.env.LF_MODEL ?? 'gemini-3.5-flash';
