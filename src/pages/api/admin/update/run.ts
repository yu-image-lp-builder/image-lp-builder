/**
 * POST /api/admin/update/run
 *
 * Self-update flow:
 *   1. Look up the persisted installation_id; reject with
 *      install_required if missing (UI bounces to install flow).
 *   2. Acquire the KV lock (rejects with in_progress if held).
 *   3. Mint a fresh installation access token via the relay's
 *      /oauth/github/access-token.
 *   4. Discover the customer repo via /installation/repositories.
 *   5. Sync upstream → customer:
 *        a. read upstream HEAD commit + tree SHA
 *        b. read customer HEAD commit + tree SHA (for the noop check)
 *        c. download the upstream zipball in a single fetch and unpack
 *           it in memory with JSZip. Each text file is sent inline with
 *           the new tree; binaries (ico/png/etc.) get a separate POST
 *           blob and we reference the returned SHA.
 *        d. POST a new tree (flat, full paths)
 *        e. POST a new commit (parented on the customer's current HEAD)
 *        f. PATCH heads/main to the new commit — this is the bank-
 *           transaction commit point. Up to this PATCH, no customer-
 *           visible state has changed; if any earlier step throws, the
 *           customer repo is byte-identical to before.
 *   6. Flip the lock stage to 'building'. Cloudflare Workers Builds
 *      auto-detects the new commit and starts a deploy; the customer
 *      polls /api/version to detect when the new isolate takes over.
 *
 * The Cloudflare Deploy button creates a standalone repo (fork: false),
 * so /merge-upstream returns 422. Replicating the file tree by hand
 * is the only path that works without asking the customer to convert
 * their repo into a fork.
 *
 * The first cut of this code did the replication file-by-file
 * (GET upstream blob → POST customer blob, ~2 subrequests per file).
 * That blew through the Workers Free 50-external-subrequest cap on
 * the customer's Worker for any non-trivial repo. The zipball path
 * brings the whole upstream tree across in a single fetch, so the
 * total subrequest count is ~10 regardless of repo size.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { error, errors, ErrorCodes, success } from '../../../../lib/api';
import { installationQueries } from '../../../../lib/github-install';
import {
  acquireLock,
  markFailed,
  releaseLock,
  setStage,
} from '../../../../lib/update-lock';
import { getRelayUrl } from '../../../../lib/oauth-client';
import { CURRENT_VERSION, REPO_SLUG } from '../../../../lib/version';

export const prerender = false;

const GH_API = 'https://api.github.com';
const UPSTREAM_BRANCH = 'main';
const CUSTOMER_BRANCH = 'main';
// Conservative parallelism for blob uploads (binaries only — text
// files ride inline on the tree POST). GitHub's secondary rate limit
// kicks in around 100 concurrent requests; staying well below that
// keeps the sync robust against transient back-pressure.
const BLOB_UPLOAD_CONCURRENCY = 5;

/**
 * In-memory representation of one extracted file from the upstream
 * zipball. `text` is set when the file decoded cleanly as UTF-8 (and
 * will be sent inline in the tree POST as `content`). `binaryBase64`
 * is set when decoding fails; we'll POST a blob first and reference
 * the returned SHA in the tree.
 */
interface ExtractedFile {
  path: string;
  mode: string;
  text?: string;
  binaryBase64?: string;
}

interface TreeApiEntry {
  path: string;
  mode: string;
  type: 'blob';
  content?: string;
  sha?: string;
}

export const POST: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  if (!env?.RATE_LIMIT) return errors.internalError('KV not configured');

  const workspaceId = locals.workspace_id;

  const installation = await installationQueries.get(env.DB, workspaceId);
  if (!installation) {
    return error(
      ErrorCodes.VALIDATION_ERROR,
      'GitHub App not installed for this workspace',
      400,
      {
        code: 'install_required',
        install_url: '/admin/update/oauth/start',
      }
    );
  }

  const lockResult = await acquireLock(
    env.RATE_LIMIT,
    workspaceId,
    CURRENT_VERSION
  );
  if (!lockResult.acquired) {
    return error(
      ErrorCodes.CONFLICT,
      'Update already in progress',
      409,
      {
        code: 'in_progress',
        stage: lockResult.existing.stage,
        started_at: lockResult.existing.startedAt,
      }
    );
  }

  const relayUrl = getRelayUrl(env?.OAUTH_RELAY_URL);
  let accessToken: string;
  try {
    const res = await fetch(`${relayUrl}/oauth/github/access-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installation_id: installation.installation_id }),
    });
    if (!res.ok) {
      const detail = (await safeText(res)).slice(0, 200);
      console.error(
        'auth-relay /oauth/github/access-token failed:',
        res.status,
        detail
      );
      await markFailed(
        env.RATE_LIMIT,
        workspaceId,
        `アクセストークンの発行に失敗しました(${res.status})。再 install が必要かもしれません。`
      );
      return error(
        ErrorCodes.INTERNAL_ERROR,
        'access_token_failed',
        502,
        { code: 'access_token_failed', detail }
      );
    }
    const json = (await res.json()) as { access_token?: string };
    if (typeof json.access_token !== 'string') {
      await markFailed(
        env.RATE_LIMIT,
        workspaceId,
        'auth-relay からの応答が不正です。'
      );
      return errors.internalError('relay returned unexpected shape');
    }
    accessToken = json.access_token;
  } catch (err) {
    console.error('access-token fetch threw:', err);
    await markFailed(
      env.RATE_LIMIT,
      workspaceId,
      'auth-relay への接続に失敗しました。'
    );
    return errors.internalError('access_token_unreachable');
  }

  let customerRepo: string;
  try {
    customerRepo = await discoverInstalledRepo(accessToken);
  } catch (err) {
    console.error('discover repo failed:', err);
    await markFailed(
      env.RATE_LIMIT,
      workspaceId,
      'インストール先リポジトリの特定に失敗しました。'
    );
    return errors.internalError('discover_repo_failed');
  }

  let syncStatus: 'noop' | 'updated';
  try {
    syncStatus = await syncFromUpstream(accessToken, customerRepo);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('git-database sync failed:', detail);
    await markFailed(
      env.RATE_LIMIT,
      workspaceId,
      `GitHub への同期に失敗しました(${truncate(detail, 120)})。もう一度お試しください。`
    );
    return error(
      ErrorCodes.INTERNAL_ERROR,
      'github_sync_failed',
      502,
      { code: 'github_sync_failed', detail: truncate(detail, 200) }
    );
  }

  if (syncStatus === 'noop') {
    // Customer repo is already on the latest upstream tree. No
    // commit was created → Cloudflare won't trigger a build →
    // releasing the lock immediately so the operator isn't stranded
    // on a spinner that will never resolve.
    await releaseLock(env.RATE_LIMIT, workspaceId);
    return success({ stage: 'noop', message: 'すでに最新です。' });
  }

  // The PATCH ref landed; Cloudflare Workers Builds will pick up the
  // new commit and roll out a new isolate. Advance the stage so the UI
  // can swap the label from "GitHub 同期中" to "CF ビルド中".
  await setStage(env.RATE_LIMIT, workspaceId, 'building');

  return success({ stage: 'building' }, 202);
};

async function discoverInstalledRepo(accessToken: string): Promise<string> {
  const json = await ghJson<{
    repositories?: Array<{ full_name?: string; name?: string }>;
  }>('/installation/repositories', accessToken);
  const repos = json.repositories ?? [];
  // Prefer the repo whose name matches our slug — guards against the
  // (unusual) case where the customer installs the App on multiple
  // repos. Falls back to the first listed repo otherwise.
  const upstreamName = REPO_SLUG.split('/')[1];
  const match = repos.find((r) => r.name === upstreamName);
  const picked = match ?? repos[0];
  if (!picked?.full_name) {
    throw new Error('no repositories visible to this installation');
  }
  return picked.full_name;
}

/**
 * Replicate the upstream HEAD into the customer repo. Returns 'noop'
 * when the customer tree already matches upstream, 'updated' when a
 * new commit was published.
 *
 * Throws on any GitHub API failure. Until the final PATCH ref returns
 * 200, the customer repo is byte-for-byte unchanged from outside.
 *
 * Subrequest budget (rough):
 *   2 × upstream ref/commit + 2 × customer ref/commit + 1 × zipball
 *   + N × binary blob POSTs + 3 × tree/commit/ref → ~8 + N. The
 *   image-lp-builder repo currently has 1 binary file (favicon.ico),
 *   so the typical sync runs in ~9 subrequests, well under the 50
 *   external-fetch cap on the Workers Free plan.
 */
async function syncFromUpstream(
  accessToken: string,
  customerRepo: string
): Promise<'noop' | 'updated'> {
  // Step a: upstream HEAD commit + tree SHA.
  const upstreamRef = await ghJson<{ object: { sha: string } }>(
    `/repos/${REPO_SLUG}/git/ref/heads/${UPSTREAM_BRANCH}`,
    accessToken
  );
  const upstreamCommitSha = upstreamRef.object.sha;
  const upstreamCommit = await ghJson<{ tree: { sha: string } }>(
    `/repos/${REPO_SLUG}/git/commits/${upstreamCommitSha}`,
    accessToken
  );
  const upstreamTreeSha = upstreamCommit.tree.sha;

  // Step b: customer HEAD commit + tree SHA. Short-circuit the noop
  // case before downloading the zipball.
  const customerRef = await ghJson<{ object: { sha: string } }>(
    `/repos/${customerRepo}/git/ref/heads/${CUSTOMER_BRANCH}`,
    accessToken
  );
  const customerCommitSha = customerRef.object.sha;
  const customerCommit = await ghJson<{ tree: { sha: string } }>(
    `/repos/${customerRepo}/git/commits/${customerCommitSha}`,
    accessToken
  );
  if (customerCommit.tree.sha === upstreamTreeSha) {
    return 'noop';
  }

  // Step c: download upstream as a zipball — one fetch covers the
  // whole tree, regardless of file count. The zipball endpoint
  // returns a 302 to a presigned codeload.github.com URL; Workers
  // fetch follows redirects by default.
  const files = await downloadAndExtract(accessToken, upstreamCommitSha);

  // Step c.5: preserve the customer's wrangler.jsonc bindings.
  //
  // The Deploy-to-Cloudflare button writes auto-provisioned IDs
  // (database_id, kv namespace id, R2 bucket_name) into the customer
  // fork's wrangler.jsonc. yu-labs/image-lp-builder ships a template
  // version of the file with those ID fields blank. If we naively
  // overwrote the customer's file, the next Workers Build would fail
  // with "missing a database_id" because wrangler reads the new
  // (template) file and finds no IDs to bind to.
  //
  // Fetch the customer's current wrangler.jsonc, lift its binding
  // IDs, and merge them onto the upstream template. The merged file
  // replaces the upstream entry in the in-memory file list before
  // we POST the tree.
  const wranglerEntry = files.find((f) => f.path === 'wrangler.jsonc');
  if (wranglerEntry?.text !== undefined) {
    const customerWrangler = await fetchCustomerWrangler(
      accessToken,
      customerRepo,
      customerCommitSha
    );
    if (customerWrangler !== null) {
      wranglerEntry.text = mergeWranglerBindings(
        wranglerEntry.text,
        customerWrangler
      );
    }
  }

  // Upload binary files as blobs (text rides inline on the tree POST
  // a few lines down, so no per-file subrequest needed for those).
  const binaries = files.filter((f) => f.binaryBase64 !== undefined);
  const binaryShas = await pool(
    binaries,
    BLOB_UPLOAD_CONCURRENCY,
    async (entry) => {
      const created = await ghJson<{ sha: string }>(
        `/repos/${customerRepo}/git/blobs`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            content: entry.binaryBase64,
            encoding: 'base64',
          }),
        }
      );
      return created.sha;
    }
  );
  const binaryShaByPath = new Map<string, string>();
  binaries.forEach((entry, i) => binaryShaByPath.set(entry.path, binaryShas[i]));

  // Step d: assemble a flat tree using full paths. Text files go in
  // with `content`; GitHub creates the blob server-side. Binary files
  // reference the SHA we just uploaded.
  const treeEntries: TreeApiEntry[] = files.map((file) => {
    if (file.binaryBase64 !== undefined) {
      return {
        path: file.path,
        mode: file.mode,
        type: 'blob',
        sha: binaryShaByPath.get(file.path)!,
      };
    }
    return {
      path: file.path,
      mode: file.mode,
      type: 'blob',
      content: file.text!,
    };
  });
  const newTree = await ghJson<{ sha: string }>(
    `/repos/${customerRepo}/git/trees`,
    accessToken,
    { method: 'POST', body: JSON.stringify({ tree: treeEntries }) }
  );

  // Step e: commit, parented on the customer's current HEAD so the
  // history stays linear.
  const shortSha = upstreamCommitSha.slice(0, 7);
  const newCommit = await ghJson<{ sha: string }>(
    `/repos/${customerRepo}/git/commits`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        message: `Self-update from ${REPO_SLUG}@${shortSha}`,
        tree: newTree.sha,
        parents: [customerCommitSha],
      }),
    }
  );

  // Step f: bank-transaction commit point. Until this PATCH returns
  // 200, the customer repo is byte-identical to before.
  await ghJson(
    `/repos/${customerRepo}/git/refs/heads/${CUSTOMER_BRANCH}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    }
  );

  return 'updated';
}

/**
 * Download the upstream repo as a zipball and unpack every file into
 * an in-memory list, classifying each as text (UTF-8 decodable) or
 * binary. Dynamic-import keeps JSZip out of the SSR cold-start path
 * for routes that never sync.
 */
async function downloadAndExtract(
  accessToken: string,
  commitSha: string
): Promise<ExtractedFile[]> {
  const res = await fetch(
    `${GH_API}/repos/${REPO_SLUG}/zipball/${commitSha}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `image-lp-builder/${CURRENT_VERSION}`,
      },
    }
  );
  if (!res.ok) {
    throw new Error(
      `zipball ${res.status}: ${(await safeText(res)).slice(0, 200)}`
    );
  }
  const buf = await res.arrayBuffer();

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buf);

  const extracted: ExtractedFile[] = [];
  const tasks: Array<Promise<void>> = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;
    // GitHub wraps the archive in `<owner>-<repo>-<short-sha>/...`.
    // Strip that single top-level directory; everything after it is
    // the path we want to commit into the customer repo.
    const stripped = relativePath.replace(/^[^/]+\//, '');
    if (!stripped) return;

    tasks.push(
      (async () => {
        const bytes = await zipEntry.async('uint8array');
        const text = tryDecodeUtf8(bytes);
        if (text !== null) {
          extracted.push({ path: stripped, mode: '100644', text });
        } else {
          extracted.push({
            path: stripped,
            mode: '100644',
            binaryBase64: bytesToBase64(bytes),
          });
        }
      })()
    );
  });

  await Promise.all(tasks);
  return extracted;
}

/**
 * Pull the customer repo's current wrangler.jsonc as plain text.
 * Returns null if the file isn't present at that ref or the request
 * fails — in either case the caller falls back to using the
 * upstream template as-is, which is still wrong for the IDs but at
 * least doesn't blow up the whole sync.
 *
 * The Contents API returns base64-encoded content; we decode to a
 * UTF-8 string before handing it back.
 */
async function fetchCustomerWrangler(
  accessToken: string,
  customerRepo: string,
  ref: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${GH_API}/repos/${customerRepo}/contents/wrangler.jsonc?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `image-lp-builder/${CURRENT_VERSION}`,
        },
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: string; encoding?: string };
    if (!json.content || json.encoding !== 'base64') return null;
    // GitHub line-wraps the base64 — strip newlines before decoding.
    const bytes = base64ToBytes(json.content.replace(/\n/g, ''));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Merge customer-side binding IDs into the upstream wrangler.jsonc.
 * Upstream is the base (so any new compatibility_flags / vars / etc.
 * land); for each entry in d1_databases / kv_namespaces / r2_buckets,
 * we copy the customer's `database_id` / `id` / `bucket_name` /
 * `database_name` onto the matching upstream entry (matched by
 * `binding`). Bindings present only on the customer side (legacy
 * setups) are dropped, which is intentional — upstream is the source
 * of truth for which bindings exist.
 *
 * Comments are not preserved in the output: we re-serialize as plain
 * JSON. wrangler accepts plain JSON files too, so the customer's
 * wrangler.jsonc still validates.
 */
function mergeWranglerBindings(
  upstreamRaw: string,
  customerRaw: string
): string {
  let upstream: Record<string, unknown>;
  let customer: Record<string, unknown>;
  try {
    upstream = parseJsonc(upstreamRaw);
    customer = parseJsonc(customerRaw);
  } catch {
    // If either file is unparseable (corruption or surprise syntax),
    // fall back to the upstream string as-is. The next deploy may
    // fail with "missing database_id" but at least we don't ship a
    // half-merged JSON.
    return upstreamRaw;
  }

  const bindingKeys = ['d1_databases', 'kv_namespaces', 'r2_buckets'] as const;
  const idFields = [
    'database_id',
    'database_name',
    'id',
    'bucket_name',
  ] as const;

  for (const key of bindingKeys) {
    const upArr = upstream[key];
    const customerArr = customer[key];
    if (!Array.isArray(upArr) || !Array.isArray(customerArr)) continue;
    for (const upEntry of upArr) {
      if (!upEntry || typeof upEntry !== 'object') continue;
      const bindingName = (upEntry as Record<string, unknown>).binding;
      if (typeof bindingName !== 'string') continue;
      const match = customerArr.find(
        (c) =>
          c &&
          typeof c === 'object' &&
          (c as Record<string, unknown>).binding === bindingName
      );
      if (!match || typeof match !== 'object') continue;
      for (const field of idFields) {
        const val = (match as Record<string, unknown>)[field];
        if (val !== undefined) {
          (upEntry as Record<string, unknown>)[field] = val;
        }
      }
    }
  }

  return JSON.stringify(upstream, null, 2);
}

/**
 * Minimal JSONC parser: strip block comments, line comments, and
 * trailing commas, then JSON.parse. Enough for wrangler.jsonc files,
 * which only use these JSONC features.
 */
function parseJsonc(raw: string): Record<string, unknown> {
  const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLineComments = noBlockComments.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const noTrailingCommas = noLineComments.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailingCommas) as Record<string, unknown>;
}

/**
 * Decode a base64 string to a byte buffer. Inverse of bytesToBase64.
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Try to decode bytes as strict UTF-8. Returns the string on success,
 * null when the bytes contain any sequence that is not valid UTF-8 —
 * which we treat as "this is a binary file, send it as a blob with
 * base64 encoding instead of inline content".
 */
function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Encode a byte buffer as base64. Done in chunks so we don't blow the
 * call stack on large inputs (String.fromCharCode.apply with a huge
 * array crashes).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize))
    );
  }
  return btoa(binary);
}

async function ghJson<T>(
  path: string,
  accessToken: string,
  init?: { method?: string; body?: string }
): Promise<T> {
  const url = path.startsWith('http') ? path : `${GH_API}${path}`;
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `image-lp-builder/${CURRENT_VERSION}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body,
  });
  if (!res.ok) {
    const detail = (await safeText(res)).slice(0, 200);
    throw new Error(`${init?.method ?? 'GET'} ${path} ${res.status}: ${detail}`);
  }
  // PATCH refs returns 200 with a body; we ignore it for that call,
  // but every other endpoint we use here returns JSON, so default to
  // parsing.
  return (await res.json()) as T;
}

/**
 * Run `fn` over `items` with at most `concurrency` in flight at once.
 * Preserves input order in the result array.
 */
async function pool<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
