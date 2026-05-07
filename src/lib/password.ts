/**
 * Password-protected LP helpers.
 *
 * When `pages.password_hash` is set on an LP, visitors hitting the
 * public route get a small password form before the LP renders.
 * Submitting the right password sets a per-LP cookie so the visitor
 * doesn't have to re-enter on every reload.
 *
 * Stored hash:    SHA-256(password)                — in pages.password_hash
 * Verify cookie:  SHA-256(lpId + ":" + storedHash) — value of _lppwd_<lpId>
 *
 * The cookie value is LP-scoped, so a stolen cookie can only access
 * that one LP. The cookie is HttpOnly so the operator-pasted
 * tracking scripts in the LP head can't read it from JS, and Secure
 * on production hostnames so it never crosses an HTTP hop.
 */

const COOKIE_PREFIX = '_lppwd_';
const COOKIE_MAX_AGE_DAYS = 30;

/**
 * SHA-256 the given string and return lowercase hex.
 */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash a raw password for storage in `pages.password_hash`.
 */
export function hashPassword(password: string): Promise<string> {
  return sha256Hex(password);
}

/**
 * Compute the value the verify cookie should hold for a given LP /
 * stored hash combination. Deterministic — checking is just an
 * equality test against the cookie the visitor sends back.
 */
export function expectedCookieValue(
  lpId: string,
  passwordHash: string
): Promise<string> {
  return sha256Hex(`${lpId}:${passwordHash}`);
}

export function passwordCookieName(lpId: string): string {
  return `${COOKIE_PREFIX}${lpId}`;
}

export function passwordCookieAttributes(secure: boolean): string {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  const attrs = [
    `Path=/`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/**
 * Pull the verify cookie out of a Cookie header. Returns null when
 * not set.
 */
export function readPasswordCookie(
  cookieHeader: string | null,
  lpId: string
): string | null {
  if (!cookieHeader) return null;
  const name = passwordCookieName(lpId);
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}
