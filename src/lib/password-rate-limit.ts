/**
 * Brute-force protection for password-protected LPs.
 *
 * Tracks failed password attempts per (LP, visitor IP) in Workers KV.
 * After MAX_ATTEMPTS consecutive failures the bucket is locked for
 * LOCK_WINDOW_MS, during which every attempt — even the right one —
 * is rejected without comparing the hash.
 *
 * Scope is per-LP so a wrong password on LP A does not lock the same
 * visitor out of LP B. The visitor IP is hashed before being used as a
 * key so the raw address is never persisted.
 *
 * KV is eventually consistent. Under heavy parallel attack a few
 * extra attempts may slip through the counter, which is acceptable —
 * the lock still triggers within seconds and the cost of one extra
 * round-trip per attacker is negligible.
 */

const MAX_ATTEMPTS = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const KEY_TTL_SECONDS = 60 * 60;

export const RATE_LIMIT_MESSAGE =
  'しばらく時間をおいてから再度お試しください。';

interface Bucket {
  count: number;
  lockedUntil: number | null;
}

export interface RateLimitState {
  locked: boolean;
  message?: string;
}

function key(lpId: string, ipHash: string): string {
  return `pwgate:${lpId}:${ipHash}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashIp(ip: string): Promise<string> {
  return (await sha256Hex(ip)).slice(0, 32);
}

export function getVisitorIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

async function readBucket(
  kv: KVNamespace,
  k: string
): Promise<Bucket | null> {
  const raw = await kv.get(k);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Bucket;
    if (typeof parsed.count !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeBucket(
  kv: KVNamespace,
  k: string,
  bucket: Bucket
): Promise<void> {
  await kv.put(k, JSON.stringify(bucket), {
    expirationTtl: KEY_TTL_SECONDS,
  });
}

export async function checkLocked(
  kv: KVNamespace,
  lpId: string,
  ipHash: string
): Promise<RateLimitState> {
  const bucket = await readBucket(kv, key(lpId, ipHash));
  if (!bucket || bucket.lockedUntil === null) return { locked: false };
  if (Date.now() < bucket.lockedUntil) {
    return { locked: true, message: RATE_LIMIT_MESSAGE };
  }
  return { locked: false };
}

export async function recordFailure(
  kv: KVNamespace,
  lpId: string,
  ipHash: string
): Promise<RateLimitState> {
  const k = key(lpId, ipHash);
  const existing = await readBucket(kv, k);
  const now = Date.now();

  if (existing?.lockedUntil && now < existing.lockedUntil) {
    return { locked: true, message: RATE_LIMIT_MESSAGE };
  }

  const count = (existing?.count ?? 0) + 1;
  const reachedLimit = count >= MAX_ATTEMPTS;
  const next: Bucket = {
    count,
    lockedUntil: reachedLimit ? now + LOCK_WINDOW_MS : null,
  };
  await writeBucket(kv, k, next);

  return reachedLimit
    ? { locked: true, message: RATE_LIMIT_MESSAGE }
    : { locked: false };
}

export async function clearAttempts(
  kv: KVNamespace,
  lpId: string,
  ipHash: string
): Promise<void> {
  await kv.delete(key(lpId, ipHash));
}
