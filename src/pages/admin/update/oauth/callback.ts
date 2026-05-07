/**
 * GET /admin/update/oauth/callback
 *
 * Lands here after the customer finishes installing the GitHub App.
 * Query: ?token=<verify_token>&state=<state>
 *
 * Steps:
 *   1. Pull state from the cookie + query and demand they match.
 *   2. POST verify_token to the relay's /oauth/github/token.
 *      The relay verifies its HMAC and returns the installation_id
 *      (plus a fresh installation access token we discard — every
 *      "Update now" mints a new one).
 *   3. Persist installation_id keyed by workspace_id.
 *   4. Redirect to /admin/update with ?install_ok=1.
 *
 * Auth is enforced by the global middleware — only an authenticated
 * admin can ever land here. The cookie is SameSite=Lax so it survives
 * the cross-site bounce back from auth.yulab.me.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getRelayUrl } from '../../../../lib/oauth-client';
import { installationQueries } from '../../../../lib/github-install';

export const prerender = false;

const STATE_COOKIE = 'image_lp_github_install_state';

export const GET: APIRoute = async ({ request, url, locals }) => {
  if (!env?.DB) {
    return errorRedirect('db_not_configured');
  }

  const cookieHeader = request.headers.get('cookie');
  const stateFromCookie = readCookie(cookieHeader, STATE_COOKIE);
  const stateFromQuery = url.searchParams.get('state') ?? '';
  const verifyToken = url.searchParams.get('token') ?? '';

  if (
    !stateFromCookie ||
    !stateFromQuery ||
    stateFromCookie !== stateFromQuery
  ) {
    return clearStateAndRedirect('state_mismatch');
  }

  if (!verifyToken) {
    return clearStateAndRedirect('missing_token');
  }

  const relayUrl = getRelayUrl(env?.OAUTH_RELAY_URL);
  let installationId: number;
  try {
    const res = await fetch(`${relayUrl}/oauth/github/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    if (!res.ok) {
      console.error(
        'auth-relay /oauth/github/token failed:',
        res.status,
        (await safeText(res)).slice(0, 200)
      );
      return clearStateAndRedirect('relay_exchange_failed');
    }
    const json = (await res.json()) as { installation_id?: number };
    if (typeof json.installation_id !== 'number') {
      return clearStateAndRedirect('relay_bad_response');
    }
    installationId = json.installation_id;
  } catch (err) {
    console.error('auth-relay /oauth/github/token threw:', err);
    return clearStateAndRedirect('relay_exchange_failed');
  }

  try {
    await installationQueries.upsert(
      env.DB,
      locals.workspace_id,
      installationId
    );
  } catch (err) {
    console.error('persist installation_id failed:', err);
    return clearStateAndRedirect('persist_failed');
  }

  const headers = new Headers({ Location: '/admin/update?install_ok=1' });
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE));
  return new Response(null, { status: 302, headers });
};

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

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}

function errorRedirect(code: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/update?install_error=${encodeURIComponent(code)}`,
    },
  });
}

function clearStateAndRedirect(code: string): Response {
  const response = errorRedirect(code);
  response.headers.append('Set-Cookie', clearCookie(STATE_COOKIE));
  return response;
}
