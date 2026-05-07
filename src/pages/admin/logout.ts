/**
 * POST /admin/logout
 *
 * Drops the current session row from D1 and clears the cookie. We
 * accept POST only so a CSRF GET can't sign somebody out — the
 * AdminLayout header sends a form POST with same-origin SameSite=Lax
 * protection.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  buildAdminSessionClearCookie,
  deleteAdminSession,
  readAdminSessionCookie,
} from '../../lib/admin-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const token = readAdminSessionCookie(request.headers.get('cookie'));
  if (token && env?.DB) {
    try {
      await deleteAdminSession(env.DB, token);
    } catch (err) {
      // Session may already be gone — clear the cookie regardless.
      console.error('logout: failed to drop session row:', err);
    }
  }
  const secure = !(
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname.endsWith('.localhost')
  );
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': buildAdminSessionClearCookie(secure),
    },
  });
};
