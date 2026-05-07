/**
 * GET /api/auth/me
 *
 * Returns information about the currently authenticated user.
 * Authentication is enforced by middleware; if this handler runs,
 * `locals.user` is guaranteed to be non-null.
 */

import type { APIRoute } from 'astro';
import { success, errors } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  const user = locals.user;

  if (!user) {
    // Defensive: middleware should have rejected the request already.
    return errors.unauthorized();
  }

  return success({
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  });
};
