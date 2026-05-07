/**
 * GET /admin/auth/callback
 *
 * Lands here after the auth-relay finishes the Google round-trip.
 * Query: ?token=<verify_token>&state=<state>
 *
 * Steps:
 *   1. Pull `state` from the request and from the `image_lp_oauth_state`
 *      cookie. They must match — that's the CSRF check.
 *   2. POST the verify_token to the relay's /oauth/verify endpoint.
 *      The relay checks its HMAC and returns { email, sub, name }.
 *   3. Look up (or bootstrap) the admin_users row.
 *   4. Mint an admin session, set the session cookie, redirect to
 *      whatever path the visitor was originally aiming for.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { exchangeVerifyToken, getRelayUrl } from '../../../lib/oauth-client';
import { resolveAdminFromGoogle } from '../../../lib/admin-auth';
import {
  buildAdminSessionCookie,
  createAdminSession,
} from '../../../lib/admin-session';
import { resolveWorkspace } from '../../../lib/workspace';

export const prerender = false;

const STATE_COOKIE = 'image_lp_oauth_state';
const REDIRECT_COOKIE = 'image_lp_oauth_redirect';

export const GET: APIRoute = async ({ request, url }) => {
  if (!env?.DB) {
    return errorPage(500, 'Database not configured.');
  }

  const cookieHeader = request.headers.get('cookie');
  const stateFromCookie = readCookie(cookieHeader, STATE_COOKIE);
  const redirectCookie = readCookie(cookieHeader, REDIRECT_COOKIE);
  const redirectTo = decodeRedirect(redirectCookie);

  const stateFromQuery = url.searchParams.get('state') ?? '';
  const verifyToken = url.searchParams.get('token') ?? '';

  if (!stateFromCookie || !stateFromQuery || stateFromCookie !== stateFromQuery) {
    return clearCookiesAndRespond(
      errorPage(
        400,
        'ログインの検証に失敗しました(state 不一致)。もう一度お試しください。'
      )
    );
  }

  if (!verifyToken) {
    return clearCookiesAndRespond(
      errorPage(400, 'ログイン情報が見つかりませんでした。もう一度お試しください。')
    );
  }

  const relayUrl = getRelayUrl(env?.OAUTH_RELAY_URL);
  let identity: { email: string; sub: string; name: string };
  try {
    identity = await exchangeVerifyToken(relayUrl, verifyToken);
  } catch (err) {
    console.error('OAuth verify failed:', err);
    return clearCookiesAndRespond(
      errorPage(
        502,
        '認証サーバーへの問い合わせに失敗しました。少し時間をおいてもう一度お試しください。'
      )
    );
  }

  const workspaceId = resolveWorkspace();

  let resolved;
  try {
    resolved = await resolveAdminFromGoogle(
      env.DB,
      workspaceId,
      identity.email,
      identity.sub
    );
  } catch (err) {
    console.error('admin resolve failed:', err);
    return clearCookiesAndRespond(errorPage(500, '管理者情報の取得に失敗しました。'));
  }

  if (!resolved) {
    return clearCookiesAndRespond(
      errorPage(
        403,
        `${identity.email} は管理者として登録されていません。既存の管理者から「メンバー管理」で追加してもらってください。`
      )
    );
  }

  const sessionToken = await createAdminSession(
    env.DB,
    resolved.user.id,
    workspaceId
  );

  const secure = !isDevHost(url.hostname);
  const headers = new Headers({ Location: redirectTo });
  headers.append('Set-Cookie', buildAdminSessionCookie(sessionToken, secure));
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE));
  headers.append('Set-Cookie', clearCookie(REDIRECT_COOKIE));

  return new Response(null, { status: 302, headers });
};

function isDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  );
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const raw of cookieHeader.split(';')) {
    const [n, ...rest] = raw.split('=');
    if (n?.trim() === name) {
      return rest.join('=').trim() || null;
    }
  }
  return null;
}

function decodeRedirect(raw: string | null): string {
  if (!raw) return '/admin';
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
  } catch {
    // fall through
  }
  return '/admin';
}

function clearCookie(name: string): string {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Secure',
  ].join('; ');
}

function clearCookiesAndRespond(response: Response): Response {
  response.headers.append('Set-Cookie', clearCookie(STATE_COOKIE));
  response.headers.append('Set-Cookie', clearCookie(REDIRECT_COOKIE));
  return response;
}

function errorPage(status: number, message: string): Response {
  const body = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex,nofollow" />
  <title>ログインに失敗しました | Image LP Builder</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif; background: #f5f7fa; color: #1a1a1a; margin: 0; }
    .shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); width: 100%; max-width: 420px; padding: 2rem; }
    h1 { font-size: 1.125rem; margin: 0 0 0.75rem 0; color: #b91c1c; }
    p { margin: 0 0 1.25rem 0; color: #374151; line-height: 1.6; font-size: 0.9375rem; }
    a { color: #1d4ed8; text-decoration: underline; }
  </style>
</head>
<body>
  <main class="shell">
    <div class="card">
      <h1>ログインに失敗しました</h1>
      <p>${escapeHtml(message)}</p>
      <p><a href="/admin/login">ログイン画面に戻る</a></p>
    </div>
  </main>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
