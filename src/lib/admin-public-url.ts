/**
 * useAdminPublicOrigin — pick the right origin for "share this LP"
 * style URLs in the admin UI.
 *
 * The Worker answers on at least two hosts at any time:
 *
 *   - {worker-name}.{account}.workers.dev   (always, free, the URL
 *     the operator gets the moment they click "Deploy to Cloudflare")
 *   - lp.{self-hoster-domain}                  (once they wire a custom
 *     domain via /admin/site-settings and bind it in the CF dashboard)
 *
 * Pretty much every "what URL should I copy / QR-encode / preview"
 * decision in the admin UI reduces to:
 *
 *   "Did the operator set a custom domain? If yes, advertise
 *    lp.{domain}; if no, advertise the host they're currently on."
 *
 * Each island used to derive that from `window.location.origin`,
 * which is wrong as soon as a custom domain is wired but the
 * operator is still browsing /admin from workers.dev. This hook
 * answers the question once per page (shared module-level cache),
 * and components just drop in `const origin = useAdminPublicOrigin()`.
 *
 * The server-side counterpart lives in src/lib/canonical.ts and
 * makes the same decision for canonical / og:url / kill-switch
 * targets — keep them in step.
 */

import { useEffect, useState } from 'react';

let cached: string | null = null;
let inFlight: Promise<string> | null = null;

async function fetchPublicOrigin(): Promise<string> {
  const fallback = window.location.origin;
  try {
    const res = await fetch('/api/site-domain');
    if (!res.ok) return fallback;
    const json = (await res.json()) as {
      data?: { domain: string | null };
    };
    const domain = json?.data?.domain ?? null;
    return domain ? `https://lp.${domain}` : fallback;
  } catch {
    // Network blip or auth hiccup. The fallback (request origin)
    // is the same value every island used before this hook existed,
    // so degrading to it is safe — the operator just sees their
    // current host until the next reload.
    return fallback;
  }
}

/**
 * React hook returning the origin (`https://host`) the admin UI
 * should use for share-able LP URLs (public `/{slug}`, preview
 * `/preview/{token}`, short `/go/{shortPath}`).
 *
 * Initial render returns '' (or the cached value if another island
 * on the same page already resolved it); the actual answer arrives
 * after the GET /api/site-domain round-trip and is memoised at the
 * module level so subsequent islands on the same page share it.
 */
export function useAdminPublicOrigin(): string {
  const [origin, setOrigin] = useState<string>(cached ?? '');

  useEffect(() => {
    if (cached !== null) {
      setOrigin(cached);
      return;
    }
    if (typeof window === 'undefined') return;

    if (!inFlight) {
      inFlight = fetchPublicOrigin().then((value) => {
        cached = value;
        return value;
      });
    }

    let cancelled = false;
    void inFlight.then((value) => {
      if (!cancelled) setOrigin(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return origin;
}
