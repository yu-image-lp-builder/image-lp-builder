/**
 * Admin authorisation helpers.
 *
 * The login path resolves a Google identity (email + sub) via the
 * auth-relay and needs to translate that into an `admin_users` row.
 * Three cases:
 *
 *   1. No admin_users rows exist for this workspace yet
 *      → bootstrap: the very first person to log in becomes the
 *        owner. This is what makes the "Deploy to Cloudflare" flow
 *        work without asking the self-hoster to type their email at
 *        deploy time. The trade-off: the self-hoster should open
 *        /admin promptly after deploy completes so they claim the
 *        owner slot before anyone else can. See README "Security
 *        considerations".
 *
 *   2. A row matches by email
 *      → existing admin. Bind google_sub if it was empty (the row
 *        was pre-created via "Add admin"), and stamp last_login_at.
 *
 *   3. Neither of the above
 *      → reject. Don't auto-create — that would let any Google
 *        account log in once the bootstrap window closes.
 *
 * The dev-mode bypass (used by middleware on localhost) goes
 * through `getOrCreateDevAdmin` so local development doesn't depend
 * on the relay at all.
 */

import {
  adminUserQueries,
  generateId,
  type AdminUser,
} from './db';

const DEV_ADMIN_EMAIL = 'dev@example.com';

export interface ResolveResult {
  user: AdminUser;
  /** True when this login created the bootstrap admin row. */
  bootstrapped: boolean;
}

export async function resolveAdminFromGoogle(
  db: D1Database,
  workspaceId: string,
  email: string,
  googleSub: string
): Promise<ResolveResult | null> {
  const existingByEmail = await adminUserQueries.findByEmail(
    db,
    workspaceId,
    email
  );

  if (existingByEmail) {
    if (!existingByEmail.google_sub) {
      await adminUserQueries.updateGoogleSub(
        db,
        workspaceId,
        existingByEmail.id,
        googleSub
      );
    }
    await adminUserQueries.updateLastLogin(
      db,
      workspaceId,
      existingByEmail.id
    );
    return {
      user: { ...existingByEmail, google_sub: googleSub },
      bootstrapped: false,
    };
  }

  const total = await adminUserQueries.count(db, workspaceId);
  if (total === 0) {
    const created = await adminUserQueries.create(db, {
      id: generateId(),
      workspaceId,
      email,
      googleSub,
      role: 'owner',
    });
    await adminUserQueries.updateLastLogin(db, workspaceId, created.id);
    return { user: created, bootstrapped: true };
  }

  return null;
}

/**
 * Local-dev convenience. Returns (and lazily creates) the dev admin
 * row so localhost requests get a valid Astro.locals.user without
 * needing a real Google login.
 */
export async function getOrCreateDevAdmin(
  db: D1Database,
  workspaceId: string
): Promise<AdminUser> {
  const existing = await adminUserQueries.findByEmail(
    db,
    workspaceId,
    DEV_ADMIN_EMAIL
  );
  if (existing) return existing;
  return await adminUserQueries.create(db, {
    id: generateId(),
    workspaceId,
    email: DEV_ADMIN_EMAIL,
    googleSub: null,
    role: 'owner',
  });
}

export const ADMIN_DEV_EMAIL = DEV_ADMIN_EMAIL;
