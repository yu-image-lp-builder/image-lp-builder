/**
 * GET /admin/update/oauth/start
 *
 * Kicks off the GitHub App install round-trip:
 *   1. Mints a CSRF state, stashes it in a short-lived HttpOnly cookie.
 *   2. 302's to the auth-relay's /oauth/github/install/start, which
 *      in turn 302's to github.com/apps/<APP_NAME>/installations/new.
 *
 * The customer picks "Install on this fork" on GitHub, GitHub calls
 * the App's Setup URL on the relay with installation_id, and the
 * relay 302's the browser back to /admin/update/oauth/callback with
 * a verify_token + state for us to validate.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { generateOAuthState, getRelayUrl } from '../../../../lib/oauth-client';

export const prerender = false;

const STATE_TTL_SECONDS = 60 * 5;
const STATE_COOKIE = 'image_lp_github_install_state';

export const GET: APIRoute = ({ request, url }) => {
  if (isDevHost(url.hostname)) {
    // Dev mode: the relay isn't reachable and the App's Setup URL
    // would never resolve back to localhost. Bounce with an error
    // flag so the page can explain why instead of leaving the
    // operator on a stuck redirect.
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin/update?install_error=dev_unsupported' },
    });
  }

  const state = generateOAuthState();
  const relayUrl = getRelayUrl(env?.OAUTH_RELAY_URL);
  const returnUrl = new URL(
    '/admin/update/oauth/callback',
    request.url
  ).toString();

  const target = new URL(`${relayUrl}/oauth/github/install/start`);
  target.searchParams.set('state', state);
  target.searchParams.set('return_url', returnUrl);

  const headers = new Headers({ Location: target.toString() });
  headers.append('Set-Cookie', buildCookie(STATE_COOKIE, state));

  return new Response(null, { status: 302, headers });
};

function isDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  );
}

function buildCookie(name: string, value: string): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${STATE_TTL_SECONDS}`,
    'Secure',
  ].join('; ');
}
