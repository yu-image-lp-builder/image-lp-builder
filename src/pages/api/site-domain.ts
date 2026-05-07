/**
 * /api/site-domain
 *
 * Site-wide custom-domain settings, separated from /api/site-meta
 * because the domain field drives different concerns (canonical
 * URL, robots.txt, kill switch, parent-share cookies) and we want
 * the panel to reason about it on its own.
 *
 * GET    -> read the current bare apex + workers_dev_disabled flag
 *           plus a sanitisation/validation report when the caller
 *           passed `?probe={input}` so the panel can show inline
 *           error / warning state without saving.
 * PUT    -> persist the bare apex (e.g. "example.com") after
 *           sanitising + validating + (optionally) probing
 *           lp.{domain} for X-Image-LP-Builder-Version. The caller can pass
 *           `force: true` to skip the probe failure block.
 * DELETE -> clear the domain (return to workers.dev only) and
 *           force workers_dev_disabled back to 0 so the kill
 *           switch can't be left armed without a target.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { siteMetaQueries } from '../../lib/db';
import { success, errors } from '../../lib/api';

export const prerender = false;

const DOMAIN_MAX = 253; // RFC 1035 cap on a fully-qualified name.
const PROBE_TIMEOUT_MS = 3000;

interface SanitiseReport {
  cleaned: string;
  notes: string[];
}

interface ProbeResult {
  // 'ok' = lp.{domain} answered with X-Image-LP-Builder-Version, this is our Worker.
  // 'no_dns' = network call threw, almost certainly DNS / TLS / not
  //            wired up at Cloudflare yet.
  // 'apex_only' = lp.{domain} fails but {domain} succeeds with our
  //               header, self-hoster registered the apex without lp.
  //               (the "wrong place in CF" case).
  // 'other_worker' = lp.{domain} answered without X-Image-LP-Builder-Version,
  //                  somebody else is hosting that hostname.
  status: 'ok' | 'no_dns' | 'apex_only' | 'other_worker';
  // Surfaced to the operator UI when we want to show a hint.
  detail?: string;
}

/**
 * Strip whitespace, surrounding scheme/path/lp prefix and report
 * each rewrite so the UI can flash a "we trimmed X for you" notice.
 * Returns the bare apex (no protocol, no path, no lp. prefix).
 */
function sanitiseDomain(raw: string): SanitiseReport {
  const notes: string[] = [];
  let value = raw.trim();
  if (value !== raw) notes.push('スペースは不要です(自動で取り除きました)');

  const lowered = value.toLowerCase();
  if (lowered.startsWith('https://')) {
    value = value.slice(8);
    notes.push('「https://」は不要です(ドメイン名だけで OK)');
  } else if (lowered.startsWith('http://')) {
    value = value.slice(7);
    notes.push('「http://」は不要です(ドメイン名だけで OK)');
  }

  // Trim a single trailing slash plus any path the self-hoster pasted.
  const slashAt = value.indexOf('/');
  if (slashAt !== -1) {
    const trailing = value.slice(slashAt);
    value = value.slice(0, slashAt);
    if (trailing === '/') {
      notes.push('末尾の「/」は不要です');
    } else {
      notes.push('「/」より後ろは不要です(ドメイン名だけで OK)');
    }
  }

  // Drop a leading lp. label — the Worker derives lp.{apex}, so the
  // self-hoster entering "lp.example.com" is the same as "example.com".
  if (/^lp\./i.test(value)) {
    value = value.slice(3);
    notes.push('「lp.」は付けなくて OK です(自動で付きます)');
  }

  // Lowercase the host: DNS is case-insensitive but our equality
  // checks (kill switch, canonical) are not.
  value = value.toLowerCase();

  return { cleaned: value, notes };
}

/**
 * Surface format-level problems separately from sanitisation so the
 * UI can render them as hard errors instead of "we cleaned this for
 * you" notices.
 */
function validateDomain(domain: string): string | null {
  if (domain.length === 0) return 'ドメインを入力してください';
  if (domain.length > DOMAIN_MAX) {
    return 'ドメイン名が長すぎます(例:example.com)';
  }
  // Reject anything that wouldn't survive a DNS lookup. The regex is
  // permissive on TLD (2+ ASCII letters) so .co.jp etc. work, but
  // strict on labels (LDH only, no leading/trailing hyphen).
  const labelRe = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  const labels = domain.split('.');
  if (labels.length < 2) {
    return 'ドメイン名の形式が違います(例:example.com のように「.com」などが必要)';
  }
  for (const label of labels) {
    if (!labelRe.test(label)) {
      return `使えない文字が含まれています:「${label}」(半角英字・数字・ハイフンのみ)`;
    }
  }
  const tld = labels[labels.length - 1] ?? '';
  if (!/^[a-z]{2,}$/.test(tld)) {
    return 'ドメイン名の形式が違います(例:example.com)';
  }
  // Block hostnames that aren't user-controllable. Self-hosters occasion-
  // ally paste their workers.dev URL by mistake, which would create a
  // self-referential redirect loop the second the kill switch is on.
  if (domain.endsWith('.workers.dev') || domain === 'workers.dev') {
    return 'workers.dev は独自ドメインに使えません';
  }
  if (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    /^[0-9.]+$/.test(domain)
  ) {
    return 'localhost / IP アドレスは独自ドメインに使えません';
  }
  return null;
}

/**
 * HEAD-fetch lp.{domain} with a hard timeout and report whether the
 * response came from this Worker. Falls back to probing the apex so
 * we can detect "the self-hoster registered example.com instead of
 * lp.example.com in Cloudflare," which is a recurring footgun.
 */
async function probeDomain(domain: string): Promise<ProbeResult> {
  const lpUrl = `https://lp.${domain}/`;
  const apexUrl = `https://${domain}/`;

  const lp = await timedFetch(lpUrl);
  if (lp.ok) {
    if (lp.response.headers.get('X-Image-LP-Builder-Version')) {
      return { status: 'ok' };
    }
    // Reachable but not us.
    return {
      status: 'other_worker',
      detail: '別のサービスが lp サブドメインに割り当てられているようです',
    };
  }

  // lp.{domain} didn't answer. See if the apex does — a common
  // mistake is registering example.com in Cloudflare instead of
  // lp.example.com.
  const apex = await timedFetch(apexUrl);
  if (apex.ok && apex.response.headers.get('X-Image-LP-Builder-Version')) {
    return {
      status: 'apex_only',
      detail:
        'ルートドメインで Custom Domain を登録しているようです(lp. が必要)',
    };
  }

  return {
    status: 'no_dns',
    detail: 'lp サブドメインに到達できません(CF Custom Domain 未登録 / DNS 反映待ち / SSL 証明書発行待ち / タイポの可能性)',
  };
}

async function timedFetch(
  url: string
): Promise<{ ok: true; response: Response } | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
    });
    return { ok: true, response };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

interface SiteDomainPayload {
  domain: string | null;
  workersDevDisabled: boolean;
}

function payload(meta: {
  domain: string | null;
  workers_dev_disabled: number;
}): SiteDomainPayload {
  return {
    domain: meta.domain,
    workersDevDisabled: meta.workers_dev_disabled === 1,
  };
}

export const GET: APIRoute = async ({ url, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  try {
    const row = await siteMetaQueries.get(env.DB, locals.workspace_id);
    const current: SiteDomainPayload = row
      ? payload(row)
      : { domain: null, workersDevDisabled: false };

    const probeInput = url.searchParams.get('probe');
    if (probeInput !== null) {
      const { cleaned, notes } = sanitiseDomain(probeInput);
      const validationError = validateDomain(cleaned);
      return success({
        ...current,
        probe: {
          cleaned,
          notes,
          validationError,
        },
      });
    }
    return success(current);
  } catch (err) {
    console.error('GET /api/site-domain failed:', err);
    return errors.internalError('Failed to read site domain');
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Request body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;

  // domain is required on PUT — DELETE handles the clear case.
  const rawDomain = input.domain;
  if (typeof rawDomain !== 'string') {
    return errors.validationError('`domain` must be a string');
  }
  const force = input.force === true;
  const workersDevDisabled = input.workersDevDisabled === true;

  const { cleaned, notes } = sanitiseDomain(rawDomain);
  const validationError = validateDomain(cleaned);
  if (validationError) {
    return errors.validationError(validationError, {
      cleaned,
      notes,
    });
  }

  const probe = await probeDomain(cleaned);
  if (probe.status !== 'ok' && !force) {
    // Surface enough context for the panel to render a "we couldn't
    // reach lp.{domain}, here's why and a 'save anyway' button" UI
    // without forcing a second round-trip.
    return errors.conflict(
      probe.detail ?? 'lp サブドメインに到達できませんでした',
      {
        cleaned,
        notes,
        probe,
      }
    );
  }

  // Kill switch is paired with the domain — refuse to enable it
  // without a target so we never end up with an armed redirect that
  // points at NULL.
  if (workersDevDisabled && cleaned.length === 0) {
    return errors.validationError(
      'workers.dev URL を停止する場合は独自ドメインの設定が必要です'
    );
  }

  try {
    const updated = await siteMetaQueries.upsert(env.DB, locals.workspace_id, {
      domain: cleaned,
      workers_dev_disabled: workersDevDisabled ? 1 : 0,
    });
    return success({
      ...payload(updated),
      notes,
      probe,
    });
  } catch (err) {
    console.error('PUT /api/site-domain failed:', err);
    return errors.internalError('Failed to update site domain');
  }
};

export const DELETE: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  try {
    // Clearing the domain disarms the kill switch in the same
    // statement — leaving it set to 1 with a NULL domain would be a
    // bug bomb the next time someone reads the row.
    const updated = await siteMetaQueries.upsert(env.DB, locals.workspace_id, {
      domain: null,
      workers_dev_disabled: 0,
    });
    return success(payload(updated));
  } catch (err) {
    console.error('DELETE /api/site-domain failed:', err);
    return errors.internalError('Failed to clear site domain');
  }
};
