import { linguaFrancaManifest } from './manifest.js';

const ROUNDTABLE_API_URL =
  process.env.ROUNDTABLE_API_URL || 'https://roundtable.foxtrotcommunications.net';

/**
 * Register the Lingua Franca application manifest with Roundtable.
 *
 * Upserts all blueprints so the control plane can resolve templates
 * (e.g. `lingua-franca-lucia`) at workspace-creation time. Idempotent —
 * calling it again just refreshes the manifest.
 *
 * @param bearerToken - Authorization header value (e.g. "Bearer <token>")
 * @param orgId - Roundtable org ID (for logging only; auth derives it from the token)
 */
export async function registerLinguaFranca(bearerToken: string, orgId: string): Promise<void> {
  try {
    const response = await fetch(`${ROUNDTABLE_API_URL}/api/applications/lingua-franca`, {
      method: 'PUT',
      headers: {
        Authorization: bearerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(linguaFrancaManifest),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[lingua-franca] Failed to register application', {
        status: response.status,
        body,
        orgId,
      });
      return;
    }

    const result = (await response.json()) as { blueprintCount?: number };
    console.info('[lingua-franca] Application registered', {
      orgId,
      blueprintCount: result.blueprintCount,
    });
  } catch (err) {
    // Non-fatal — workspace creation falls back gracefully.
    console.error('[lingua-franca] Failed to register application', { err, orgId });
  }
}

/**
 * Register the manifest using a service-level API key (server startup / demo org).
 * The key must have admin access to the target org in Roundtable.
 */
export async function registerLinguaFrancaForDemoOrg(apiKey: string): Promise<void> {
  try {
    const response = await fetch(`${ROUNDTABLE_API_URL}/api/applications/lingua-franca`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(linguaFrancaManifest),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn('[lingua-franca] Demo blueprint registration failed', {
        status: response.status,
        body,
      });
      return;
    }

    const result = (await response.json()) as { blueprintCount?: number };
    console.info('[lingua-franca] Demo org blueprints registered', {
      blueprintCount: result.blueprintCount,
    });
  } catch (err) {
    console.warn('[lingua-franca] Demo blueprint registration failed', { err });
  }
}
