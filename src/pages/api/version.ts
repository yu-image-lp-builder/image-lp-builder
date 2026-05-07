/**
 * GET /api/version
 *
 * Returns the version baked into this Worker bundle. The /admin/update
 * polling loop uses this to detect when a new build has rolled out:
 * the value changes the moment Cloudflare swaps in the new isolate
 * after merge-upstream + auto-rebuild.
 *
 * Auth is enforced by the global middleware — the endpoint is only
 * called from the locked /admin/update page so the admin session is
 * always present.
 */

import type { APIRoute } from 'astro';
import { CURRENT_VERSION } from '../../lib/version';
import { success } from '../../lib/api';

export const prerender = false;

export const GET: APIRoute = () => {
  const response = success({ version: CURRENT_VERSION });
  // Polling expects a fresh value on every hit — Cloudflare's edge
  // cache shouldn't pin the old version after a deploy.
  response.headers.set('Cache-Control', 'no-store');
  return response;
};
