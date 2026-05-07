/**
 * GET /api/admin/update/status
 *
 * Returns the current update lock state. The /admin/update polling
 * loop calls this every few seconds while waiting for the new
 * Worker version to roll out.
 *
 * Response shapes:
 *   { status: 'idle' }
 *   { status: 'in_progress', stage, started_at, from_version }
 *   { status: 'failed', error_message, started_at, from_version }
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { errors, success } from '../../../../lib/api';
import { readLock } from '../../../../lib/update-lock';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.RATE_LIMIT) return errors.internalError('KV not configured');
  const lock = await readLock(env.RATE_LIMIT, locals.workspace_id);

  if (!lock) {
    return success({ status: 'idle' });
  }

  if (lock.stage === 'failed') {
    return success({
      status: 'failed',
      error_message: lock.errorMessage ?? '不明なエラーが発生しました。',
      started_at: lock.startedAt,
      from_version: lock.fromVersion,
    });
  }

  return success({
    status: 'in_progress',
    stage: lock.stage,
    started_at: lock.startedAt,
    from_version: lock.fromVersion,
  });
};
