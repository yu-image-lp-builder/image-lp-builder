/**
 * POST /api/admin/update/release
 *
 * Clear the update lock. Called by the polling loop in two places:
 *   - When /api/version reports the new version (success path).
 *   - When the operator dismisses a 'failed' error.
 *
 * The lock would otherwise expire on its own after ~10 minutes via
 * KV TTL — this endpoint just shortens that window so the admin can
 * resume work the moment the deploy lands.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { errors, success } from '../../../../lib/api';
import { releaseLock } from '../../../../lib/update-lock';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  if (!env?.RATE_LIMIT) return errors.internalError('KV not configured');
  await releaseLock(env.RATE_LIMIT, locals.workspace_id);
  return success({ released: true });
};
