/**
 * GET /admin/auth/start
 *
 * Kicks off the OAuth round-trip:
 *   1. Mints a CSRF `state` value, stashes it (and the post-login
 *      redirect destination) in two short-lived HttpOnly cookies.
 *   2. 302's the browser to the auth-relay's /oauth/start.
 *
 * The cookies expire in 5 minutes — long enough to walk through the
 * Google consent screen, short enough that abandoned attempts don't
 * pile up. Validated again on /admin/auth/callback.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  buildRelayStartUrl,
  generateOAuthState,
  getRelayUrl,
} from '../../../lib/oauth-client';

export const prerender = false;

const STATE_TTL_SECONDS = 60 * 5;

export const GET: APIRoute = ({ request, url }) => {
  const isDev = isDevHost(url.hostname);
  // In dev mode there is no relay reachable, and the middleware
  // already populates a dev admin. Send the visitor to /admin so
  // they don't sit on a stuck redirect.
  if (isDev) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin' },
    });
  }

  const rawRedirect = url.searchParams.get('redirect_to') ?? '/admin';
  const redirectTo = isSafeRedirect(rawRedirect) ? rawRedirect : '/admin';

  const state = generateOAuthState();
  const relayUrl = getRelayUrl(env?.OAUTH_RELAY_URL);

  // Where the relay should drop the visitor after Google completes.
  // Reconstructed against the request URL so it works on
  // workers.dev, lp.{self-hoster-domain}, and behind any reverse proxy.
  const returnUrl = new URL('/admin/auth/callback', request.url).toString();

  const target = buildRelayStartUrl({ relayUrl, state, returnUrl });

  const headers = new Headers({ Location: target });
  headers.append('Set-Cookie', buildCookie('image_lp_oauth_state', state));
  headers.append(
    'Set-Cookie',
    buildCookie('image_lp_oauth_redirect', encodeURIComponent(redirectTo))
  );

  return new Response(null, { status: 302, headers });
};

function isDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  );
}

function isSafeRedirect(target: string): boolean {
  return target.startsWith('/') && !target.startsWith('//');
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
