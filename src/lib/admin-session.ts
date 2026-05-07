/**
 * Admin session cookie issue / read / verify.
 *
 * Backed by the `admin_sessions` D1 table from migration 0012. We
 * intentionally use a server-side store rather than a stateless JWT
 * so the operator can yank a stolen token out of an attacker's hands
 * with one DELETE — JWT revocation always grows into a denylist
 * eventually, and we have D1 anyway.
 *
 * Cookie:
 *   image_lp_admin_session=<token>; HttpOnly; Secure; SameSite=Lax;
 *     Path=/; Max-Age=2592000
 *
 *   - HttpOnly: not readable from JS (XSS in any island can't lift it).
 *   - SameSite=Lax: survives the OAuth round-trip (Google -> auth-relay
 *     -> /admin/auth/callback is a top-level GET) but blocks
 *     CSRF on POSTs originated from third-party sites.
 *   - 30 days, sliding — every successful verify pushes expires_at
 *     forward by 30d so an active operator never sees a re-login.
 */

import {
  adminSessionQueries,
  type AdminUser,
  type AdminSession,
} from './db';

const COOKIE_NAME = 'image_lp_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function generateSessionToken(): string {
  // 32 bytes of entropy, hex-encoded so it survives Set-Cookie
  // verbatim (no escaping, no base64 padding to fight with).
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isoFromNowSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
}

export async function createAdminSession(
  db: D1Database,
  adminUserId: string,
  workspaceId: string
): Promise<string> {
  const token = generateSessionToken();
  await adminSessionQueries.create(db, {
    token,
    adminUserId,
    workspaceId,
    expiresAtIso: isoFromNowSeconds(SESSION_TTL_SECONDS),
  });
  return token;
}

export async function verifyAdminSession(
  db: D1Database,
  token: string
): Promise<{ session: AdminSession; user: AdminUser } | null> {
  const found = await adminSessionQueries.findValidWithUser(db, token);
  if (!found) return null;
  // Slide the window forward — best effort, do not block the request
  // path on this write.
  try {
    await adminSessionQueries.slide(
      db,
      token,
      isoFromNowSeconds(SESSION_TTL_SECONDS)
    );
  } catch {
    // Ignore: the session is still valid, just won't extend this hit.
  }
  return found;
}

export async function deleteAdminSession(
  db: D1Database,
  token: string
): Promise<void> {
  await adminSessionQueries.deleteByToken(db, token);
}

export function buildAdminSessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function buildAdminSessionClearCookie(secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function readAdminSessionCookie(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const raw of parts) {
    const [name, ...rest] = raw.split('=');
    if (name?.trim() === COOKIE_NAME) {
      return rest.join('=').trim() || null;
    }
  }
  return null;
}

export const ADMIN_SESSION_COOKIE_NAME = COOKIE_NAME;
