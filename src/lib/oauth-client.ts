const DEFAULT_RELAY_URL = 'https://auth.yulab.me';

export function getRelayUrl(rawUrl: string | undefined | null): string {
  const trimmed = rawUrl?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed.replace(/\/+$/, '')
    : DEFAULT_RELAY_URL;
}

/**
 * Build the URL to redirect the browser to in order to kick off
 * the OAuth round-trip. The relay handles the rest.
 */
export function buildRelayStartUrl(params: {
  relayUrl: string;
  state: string;
  returnUrl: string;
}): string {
  const u = new URL(`${params.relayUrl}/oauth/start`);
  u.searchParams.set('state', params.state);
  u.searchParams.set('return_url', params.returnUrl);
  return u.toString();
}

export interface RelayIdentity {
  email: string;
  sub: string;
  name: string;
}

/**
 * Hand a verify_token to the relay and get back the resolved Google
 * identity. Throws on any non-OK response so callers can treat the
 * call as "succeed or fail loudly" — they'll surface the error to
 * the visitor as a 401 on /admin/auth/callback.
 */
export async function exchangeVerifyToken(
  relayUrl: string,
  verifyToken: string
): Promise<RelayIdentity> {
  const res = await fetch(`${relayUrl}/oauth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: verifyToken }),
  });
  if (!res.ok) {
    throw new Error(
      `auth-relay /oauth/verify failed: ${res.status} ${await safeText(res)}`
    );
  }
  const json = (await res.json()) as Partial<RelayIdentity>;
  if (
    typeof json.email !== 'string' ||
    typeof json.sub !== 'string' ||
    typeof json.name !== 'string'
  ) {
    throw new Error('auth-relay returned an unexpected shape');
  }
  return { email: json.email, sub: json.sub, name: json.name };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '<no body>';
  }
}

/**
 * Random URL-safe state used for CSRF on the OAuth round-trip.
 * 16 bytes -> 22 chars after base64url, plenty of entropy for a
 * single-use 5-minute token.
 */
export function generateOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64url without padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
