import packageJson from '../../package.json';

export const CURRENT_VERSION: string = packageJson.version;
export const REPO_SLUG = 'yu-labs/image-lp-builder';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * `fetchStatus` separates two outcomes that look identical to the
 * caller but mean very different things to the operator:
 *   - 'no_release' = GitHub answered cleanly, the repo just has no
 *     published release yet (HTTP 404 on /releases/latest). Normal for
 *     a brand-new installation; not an error to surface.
 *   - 'network_error' = the request actually failed (timeout, 5xx,
 *     thrown exception). The operator should retry / check status.
 */
export type VersionFetchStatus = 'ok' | 'no_release' | 'network_error';

interface CacheEntry {
  checkedAt: number;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  fetchStatus: VersionFetchStatus;
}

let cache: CacheEntry | null = null;

export interface VersionCheck {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  isCritical: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  fetchStatus: VersionFetchStatus;
}

/**
 * Compare the current build's version against the latest GitHub
 * release. Caches the answer per isolate for 24 h.
 *
 * `isCritical` is set when the release title or tag contains the
 * `[critical]` prefix. Operators flag urgent security or data-loss
 * fixes this way so the admin banner can switch to a louder style.
 */
export async function checkForUpdate(): Promise<VersionCheck> {
  const fresh =
    cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS ? cache : null;
  const data = fresh ?? (await fetchLatest());

  const hasUpdate =
    !!data.latestVersion &&
    compareSemver(CURRENT_VERSION, data.latestVersion) < 0;

  return {
    current: CURRENT_VERSION,
    latest: data.latestVersion,
    releaseUrl: data.releaseUrl,
    releaseName: data.releaseName,
    hasUpdate,
    isCritical: hasUpdate && isCriticalRelease(data.releaseName),
    fetchStatus: data.fetchStatus,
  };
}

/**
 * `[critical]` (case-insensitive) anywhere in the release name or tag
 * marks the release as urgent. Matches `[Critical]`, `[CRITICAL]`, etc.
 */
export function isCriticalRelease(name: string | null): boolean {
  if (!name) return false;
  return /\[critical\]/i.test(name);
}

async function fetchLatest(): Promise<CacheEntry> {
  const empty = (status: VersionFetchStatus): CacheEntry => ({
    checkedAt: Date.now(),
    latestVersion: null,
    releaseUrl: null,
    releaseName: null,
    fetchStatus: status,
  });

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_SLUG}/releases/latest`,
      {
        headers: {
          'User-Agent': `image-lp-builder/${CURRENT_VERSION}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) {
      // 404 specifically means "the repo has no published release",
      // which is the normal state for a brand-new install. Anything
      // else (5xx, rate limit, etc.) is a real failure.
      const fallback = empty(res.status === 404 ? 'no_release' : 'network_error');
      cache = fallback;
      return fallback;
    }
    const json = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      name?: string;
    };
    const tag = json.tag_name?.replace(/^v/, '') ?? null;
    const url = json.html_url ?? null;
    const name = json.name ?? json.tag_name ?? null;
    const next: CacheEntry = {
      checkedAt: Date.now(),
      latestVersion: tag,
      releaseUrl: url,
      releaseName: name,
      fetchStatus: 'ok',
    };
    cache = next;
    return next;
  } catch {
    const fallback = empty('network_error');
    cache = fallback;
    return fallback;
  }
}

/**
 * Lightweight semver comparator: returns -1 / 0 / 1 the way you'd
 * expect. Tolerates partial versions like "1.2" by treating missing
 * components as 0. Pre-release / build metadata is ignored.
 */
export function compareSemver(a: string, b: string): number {
  const parts = (s: string) =>
    s
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const aParts = parts(a);
  const bParts = parts(b);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}
