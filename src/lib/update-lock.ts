/**
 * Cross-isolate lock for the /admin/update flow.
 *
 * The "Update now" button kicks off a multi-step process (GitHub
 * merge-upstream → Cloudflare auto-rebuild → version polling) that
 * takes 1-3 minutes. While it runs, every other admin route must
 * redirect to /admin/update so the operator can't change LP content
 * or settings mid-deploy.
 *
 * State lives in KV keyed by workspace_id. The TTL is the hard
 * timeout — the platform auto-removes the entry after 10 minutes so
 * a Worker that crashes mid-update doesn't leave the UI permanently
 * locked.
 *
 * Stage transitions are advisory: the customer-side polling loop
 * advances them, and the success path is detected by /api/version
 * flipping over (no server-side hook fires when the new Worker
 * boots). On success the UI calls release() to clear the lock; on
 * timeout the TTL expires it for us.
 */

export type UpdateStage = 'syncing' | 'building' | 'verifying' | 'failed';

export interface UpdateLockState {
  stage: UpdateStage;
  startedAt: number;
  fromVersion: string;
  errorMessage?: string;
}

export const LOCK_TTL_SECONDS = 600;

function key(workspaceId: string): string {
  return `update-lock:${workspaceId}`;
}

export async function readLock(
  kv: KVNamespace,
  workspaceId: string
): Promise<UpdateLockState | null> {
  const raw = await kv.get(key(workspaceId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UpdateLockState;
    if (
      typeof parsed.stage !== 'string' ||
      typeof parsed.startedAt !== 'number' ||
      typeof parsed.fromVersion !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Try to acquire the lock. A prior 'failed' lock is treated as
 * "previous attempt is over" and gets overwritten so the operator
 * can retry without manually clearing.
 */
export async function acquireLock(
  kv: KVNamespace,
  workspaceId: string,
  fromVersion: string
): Promise<
  | { acquired: true }
  | { acquired: false; existing: UpdateLockState }
> {
  const existing = await readLock(kv, workspaceId);
  if (existing && existing.stage !== 'failed') {
    return { acquired: false, existing };
  }
  const state: UpdateLockState = {
    stage: 'syncing',
    startedAt: Date.now(),
    fromVersion,
  };
  await kv.put(key(workspaceId), JSON.stringify(state), {
    expirationTtl: LOCK_TTL_SECONDS,
  });
  return { acquired: true };
}

export async function setStage(
  kv: KVNamespace,
  workspaceId: string,
  stage: UpdateStage
): Promise<void> {
  const existing = await readLock(kv, workspaceId);
  if (!existing) return;
  const next: UpdateLockState = { ...existing, stage };
  await kv.put(key(workspaceId), JSON.stringify(next), {
    expirationTtl: LOCK_TTL_SECONDS,
  });
}

export async function markFailed(
  kv: KVNamespace,
  workspaceId: string,
  message: string
): Promise<void> {
  const existing = await readLock(kv, workspaceId);
  const base: UpdateLockState = existing ?? {
    stage: 'failed',
    startedAt: Date.now(),
    fromVersion: 'unknown',
  };
  const next: UpdateLockState = {
    ...base,
    stage: 'failed',
    errorMessage: message,
  };
  await kv.put(key(workspaceId), JSON.stringify(next), {
    expirationTtl: LOCK_TTL_SECONDS,
  });
}

export async function releaseLock(
  kv: KVNamespace,
  workspaceId: string
): Promise<void> {
  await kv.delete(key(workspaceId));
}

/**
 * Returns true when the middleware should redirect /admin/* to
 * /admin/update — i.e. when an in-progress lock exists. A 'failed'
 * lock does not redirect because the operator needs to be able to
 * navigate away after acknowledging the error.
 */
export function isInProgress(state: UpdateLockState | null): boolean {
  if (!state) return false;
  return state.stage !== 'failed';
}
