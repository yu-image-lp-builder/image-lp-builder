/**
 * /api/admin-members
 *
 * GET    -> list admins for the current workspace
 * POST   -> add a new admin by email (Google sub gets bound on first login)
 * DELETE -> remove an admin (request body { id })
 *
 * Authentication is enforced by middleware. Self-deletion is blocked
 * here so an operator can't lock themselves out by accident — the
 * UI never offers the button anyway, but the server check is the
 * actual safety net.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { adminUserQueries, adminSessionQueries, generateId } from '../../lib/db';
import { success, errors } from '../../lib/api';

export const prerender = false;

const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  try {
    const admins = await adminUserQueries.list(env.DB, workspaceId);
    return success({
      admins: admins.map((a) => ({
        id: a.id,
        email: a.email,
        role: a.role,
        created_at: a.created_at,
        last_login_at: a.last_login_at,
        // True once the operator has actually logged in. The UI
        // shows "未ログイン" for the false case.
        signed_in: a.google_sub !== null,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin-members failed:', err);
    return errors.internalError('Failed to list admins');
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Request body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Request body must be a JSON object');
  }

  const { email } = body as { email?: unknown };
  const emailError = validateEmail(email);
  if (emailError) return errors.validationError(emailError, { field: 'email' });

  const normalised = (email as string).trim().toLowerCase();
  const existing = await adminUserQueries.findByEmail(
    env.DB,
    workspaceId,
    normalised
  );
  if (existing) {
    return errors.conflict('そのメールアドレスは既に管理者に登録されています');
  }

  try {
    const created = await adminUserQueries.create(env.DB, {
      id: generateId(),
      workspaceId,
      email: normalised,
      googleSub: null,
      role: 'owner',
    });
    return success(
      {
        id: created.id,
        email: created.email,
        role: created.role,
        created_at: created.created_at,
        last_login_at: created.last_login_at,
        signed_in: false,
      },
      201
    );
  } catch (err) {
    console.error('POST /api/admin-members failed:', err);
    return errors.internalError('Failed to add admin');
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Request body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Request body must be a JSON object');
  }
  const { id } = body as { id?: unknown };
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('`id` is required', { field: 'id' });
  }

  const me = locals.user;
  if (!me) return errors.unauthorized();
  if (me.id === id) {
    return errors.forbidden('自分自身を削除することはできません');
  }

  const target = await adminUserQueries.findById(env.DB, workspaceId, id);
  if (!target) return errors.notFound('管理者が見つかりません');

  // Block removing the very last admin even if the UI somehow lets
  // you (shouldn't happen — you can't be deleting yourself, so by
  // definition there are at least two of you — but defence in depth).
  const total = await adminUserQueries.count(env.DB, workspaceId);
  if (total <= 1) {
    return errors.forbidden('最後の管理者は削除できません');
  }

  try {
    // Drop sessions first so any browser still holding their cookie
    // is logged out immediately, then the admin row.
    await adminSessionQueries.deleteByAdminUserId(env.DB, workspaceId, id);
    await adminUserQueries.deleteById(env.DB, workspaceId, id);
    return success({ removed: id });
  } catch (err) {
    console.error('DELETE /api/admin-members failed:', err);
    return errors.internalError('Failed to remove admin');
  }
};

function validateEmail(value: unknown): string | null {
  if (typeof value !== 'string') return '`email` is required';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '`email` cannot be empty';
  if (trimmed.length > EMAIL_MAX_LENGTH)
    return `\`email\` must be ${EMAIL_MAX_LENGTH} characters or fewer`;
  if (!EMAIL_PATTERN.test(trimmed)) return '正しいメールアドレスを入力してください';
  return null;
}
