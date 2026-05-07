/**
 * Database helpers for Cloudflare D1
 * Provides typed access to the database from API routes and pages.
 *
 * Workspace scoping (since migration 0008): every editor-facing query
 * takes a `workspaceId` argument so writes go into the right workspace
 * and reads only return rows the caller is allowed to see. Helpers
 * tied to public URL identifiers — slug, preview_token, short_path —
 * intentionally skip the workspace filter because those identifiers
 * are unique across the whole table (so the public router can resolve
 * them without knowing the workspace).
 */

/**
 * Get the D1 database from Astro context.
 * Usage in pages: `const db = getDB(Astro.locals.runtime.env)`
 * Usage in API: `const db = getDB(locals.runtime.env)`
 */
export function getDB(env: Env): D1Database {
  return env.DB;
}

/**
 * User-related queries
 */
export const userQueries = {
  /**
   * Find user by email. Returns null if not found.
   */
  async findByEmail(db: D1Database, email: string): Promise<User | null> {
    const result = await db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<User>();
    return result ?? null;
  },

  /**
   * Create a new user. Returns the created user.
   */
  async create(
    db: D1Database,
    params: { id: string; email: string; role: 'owner' | 'editor' }
  ): Promise<User> {
    await db
      .prepare(
        `INSERT INTO users (id, email, role) VALUES (?, ?, ?)`
      )
      .bind(params.id, params.email, params.role)
      .run();

    const created = await this.findByEmail(db, params.email);
    if (!created) {
      throw new Error('Failed to create user');
    }
    return created;
  },

  /**
   * Update user's last_login_at timestamp.
   */
  async updateLastLogin(db: D1Database, userId: string): Promise<void> {
    await db
      .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
      .bind(userId)
      .run();
  },

  /**
   * Count total users (used to detect first-time setup).
   */
  async count(db: D1Database): Promise<number> {
    const result = await db
      .prepare('SELECT COUNT(*) as count FROM users')
      .first<{ count: number }>();
    return result?.count ?? 0;
  },
};

/**
 * Page (LP) record from D1.
 */
export interface Page {
  id: string;
  slug: string;
  workspace_id: string;
  status: 'draft' | 'published' | 'preview' | 'archived' | 'trash';
  page_type: 'lp' | 'revision' | 'template' | 'autosave' | 'ab_variant';
  parent_id: string | null;
  version: number;
  /** Working copy. Saved on every edit / preview. */
  content: string;
  /**
   * Snapshot the public URL renders. Copied from `content` on first
   * publish and again whenever the operator hits "公開を更新". NULL
   * on rows that were never published.
   */
  live_content: string | null;
  max_width: number;
  /** Hex color (e.g. "#f5f7fa") painted around the centred LP body.
   *  NULL = render the default white. */
  background_color: string | null;
  /** Decoration around the centred LP body: 'line' draws thin vertical
   *  lines on the left/right edges, 'shadow' applies a subtle drop
   *  shadow. NULL or 'none' = no decoration. */
  frame_style: 'line' | 'shadow' | 'none' | null;
  meta: string | null;
  custom_domain: string | null;
  password_hash: string | null;
  publish_at: string | null;
  unpublish_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  trashed_at: string | null;
  preview_token: string | null;
}

/**
 * Page-related queries
 */
export const pageQueries = {
  /**
   * Find a published LP by slug.
   * Returns null if not found or not published.
   */
  async findBySlug(db: D1Database, slug: string): Promise<Page | null> {
    const result = await db
      .prepare(
        `SELECT * FROM pages WHERE slug = ? AND status = 'published' AND page_type = 'lp' LIMIT 1`
      )
      .bind(slug)
      .first<Page>();
    return result ?? null;
  },

  /**
   * List all LPs in the workspace (excluding revisions/autosaves/templates).
   * Includes drafts and archived but excludes trash.
   * Ordered by updated_at DESC.
   */
  async listAll(
    db: D1Database,
    workspaceId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Page[]> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const result = await db
      .prepare(
        `SELECT * FROM pages
         WHERE workspace_id = ? AND page_type = 'lp' AND status != 'trash'
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(workspaceId, limit, offset)
      .all<Page>();

    return result.results ?? [];
  },

  /**
   * Count total LPs in the workspace (excluding trash) for pagination.
   */
  async countAll(db: D1Database, workspaceId: string): Promise<number> {
    const result = await db
      .prepare(
        `SELECT COUNT(*) as count FROM pages
         WHERE workspace_id = ? AND page_type = 'lp' AND status != 'trash'`
      )
      .bind(workspaceId)
      .first<{ count: number }>();
    return result?.count ?? 0;
  },

  /**
   * Check whether an LP with the given slug already exists.
   * Considers all statuses (including drafts and archived) to prevent
   * collisions when a draft is later published.
   */
  async existsBySlug(db: D1Database, slug: string): Promise<boolean> {
    const result = await db
      .prepare(
        `SELECT 1 FROM pages WHERE slug = ? AND page_type = 'lp' LIMIT 1`
      )
      .bind(slug)
      .first<{ '1': number }>();
    return result !== null;
  },

  /**
   * Create a new LP as a draft in the given workspace. Returns the
   * created page. Caller must validate `slug` (format, reserved
   * words, uniqueness) before calling this.
   */
  async create(
    db: D1Database,
    workspaceId: string,
    params: { id: string; slug: string }
  ): Promise<Page> {
    await db
      .prepare(
        `INSERT INTO pages (id, slug, workspace_id, status, page_type, version, content, max_width)
         VALUES (?, ?, ?, 'draft', 'lp', 1, '{}', 750)`
      )
      .bind(params.id, params.slug, workspaceId)
      .run();

    const created = await db
      .prepare('SELECT * FROM pages WHERE id = ?')
      .bind(params.id)
      .first<Page>();

    if (!created) {
      throw new Error('Failed to create LP');
    }
    return created;
  },

  /**
   * Duplicate an existing LP into a fresh draft.
   *
   * Copies the structural / visual side of the LP — sections, CTAs,
   * promotions, max_width, background_color, frame_style — so the
   * operator can reuse a proven layout for the next campaign without
   * rebuilding from scratch.
   *
   * Resets every operational / per-campaign field so the new LP
   * starts in a known-safe state:
   *   - status = 'draft' (never instantly publishes a half-baked copy)
   *   - meta (title / description / OGP) cleared inside content
   *   - archived_sections cleared (start with a clean slate)
   *   - password / publish schedule / live_content / preview_token / custom_domain → null
   *   - utm_links table is intentionally NOT copied (campaign-level
   *     identifiers should be re-issued per campaign)
   *
   * Caller validates `newSlug` (format, reserved, uniqueness).
   */
  async duplicate(
    db: D1Database,
    workspaceId: string,
    sourceId: string,
    params: { id: string; slug: string }
  ): Promise<Page | null> {
    const source = await this.findById(db, workspaceId, sourceId);
    if (!source) return null;

    // Strip meta + archived_sections from content; keep sections,
    // promotions, version, etc. (parseContent gives us a typed value
    // we can rebuild from).
    let nextContent: string;
    try {
      const parsed = JSON.parse(source.content) as Record<string, unknown>;
      delete parsed.meta;
      delete parsed.archived_sections;
      nextContent = JSON.stringify(parsed);
    } catch {
      // If source content is unparseable, fall back to empty so the
      // new row is still in a valid shape.
      nextContent = '{"version":1,"sections":[]}';
    }

    await db
      .prepare(
        `INSERT INTO pages (
           id, slug, workspace_id, status, page_type, version,
           content, max_width, background_color, frame_style
         ) VALUES (?, ?, ?, 'draft', 'lp', 1, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        params.slug,
        workspaceId,
        nextContent,
        source.max_width,
        source.background_color,
        source.frame_style
      )
      .run();

    return this.findById(db, workspaceId, params.id);
  },

  /**
   * Find an LP by id within the given workspace (any status, any
   * page_type). Used by the admin/API layer; the public renderer
   * should use `findBySlug` which restricts to published LPs.
   */
  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        'SELECT * FROM pages WHERE id = ? AND workspace_id = ? LIMIT 1'
      )
      .bind(id, workspaceId)
      .first<Page>();
    return result ?? null;
  },

  /**
   * Update an LP's content JSON within the workspace. Bumps `updated_at`.
   * `content` must already be a JSON-serialized string.
   * Returns the updated page, or null if no row was found.
   */
  async updateContent(
    db: D1Database,
    workspaceId: string,
    id: string,
    content: string
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        `UPDATE pages SET content = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(content, id, workspaceId)
      .run();

    if (result.meta.changes === 0) {
      return null;
    }

    return this.findById(db, workspaceId, id);
  },

  /**
   * Mark an LP as published. The first time an LP is published,
   * `published_at` is set to now; subsequent re-publishes preserve
   * the original first-publish timestamp.
   * Caller must check current status (only draft/preview/archived
   * are valid prior states).
   */
  async publish(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    // First publish copies content -> live_content so the public URL
    // has something to render. Re-publishing an existing LP (e.g. from
    // archived back to published) keeps live_content untouched so the
    // operator still has to hit "公開を更新" to push pending edits.
    const result = await db
      .prepare(
        `UPDATE pages
         SET status = 'published',
             published_at = COALESCE(published_at, datetime('now')),
             live_content = COALESCE(live_content, content),
             updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(id, workspaceId)
      .run();

    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * Promote the working copy (`content`) to the public snapshot
   * (`live_content`). Caller must check the LP is currently
   * published — re-publishing a draft is a different state
   * transition handled by `publish()`.
   */
  async republish(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        `UPDATE pages
         SET live_content = content,
             updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(id, workspaceId)
      .run();

    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * Move an LP back to draft. Caller must check the LP is currently
   * published.
   */
  async unpublish(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        `UPDATE pages
         SET status = 'draft', updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(id, workspaceId)
      .run();

    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * Update LP-level settings (slug, max_width, custom_domain,
   * scheduling, password). Slug uniqueness must be checked by the
   * caller before this is invoked.
   * Returns the updated page or null if no row was matched.
   */
  async updateSettings(
    db: D1Database,
    workspaceId: string,
    id: string,
    params: {
      slug?: string;
      maxWidth?: number;
      customDomain?: string | null;
      publishAt?: string | null;
      unpublishAt?: string | null;
      passwordHash?: string | null;
      backgroundColor?: string | null;
      frameStyle?: 'line' | 'shadow' | 'none' | null;
    }
  ): Promise<Page | null> {
    const fields: string[] = [];
    const binds: (string | number | null)[] = [];

    if (params.slug !== undefined) {
      fields.push('slug = ?');
      binds.push(params.slug);
    }
    if (params.maxWidth !== undefined) {
      fields.push('max_width = ?');
      binds.push(params.maxWidth);
    }
    if (params.customDomain !== undefined) {
      fields.push('custom_domain = ?');
      binds.push(params.customDomain);
    }
    if (params.publishAt !== undefined) {
      fields.push('publish_at = ?');
      binds.push(params.publishAt);
    }
    if (params.unpublishAt !== undefined) {
      fields.push('unpublish_at = ?');
      binds.push(params.unpublishAt);
    }
    if (params.passwordHash !== undefined) {
      fields.push('password_hash = ?');
      binds.push(params.passwordHash);
    }
    if (params.backgroundColor !== undefined) {
      fields.push('background_color = ?');
      binds.push(params.backgroundColor);
    }
    if (params.frameStyle !== undefined) {
      fields.push('frame_style = ?');
      binds.push(params.frameStyle);
    }

    if (fields.length === 0) return this.findById(db, workspaceId, id);

    fields.push("updated_at = datetime('now')");
    binds.push(id, workspaceId);

    const result = await db
      .prepare(
        `UPDATE pages SET ${fields.join(', ')}
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(...binds)
      .run();

    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * Same slug-existence check as POST /api/lps but excluding the
   * given LP id (so a slug "rename" to its current value doesn't
   * trip the uniqueness check).
   */
  async existsBySlugExcept(
    db: D1Database,
    slug: string,
    excludeId: string
  ): Promise<boolean> {
    const result = await db
      .prepare(
        `SELECT 1 FROM pages WHERE slug = ? AND page_type = 'lp' AND id != ? LIMIT 1`
      )
      .bind(slug, excludeId)
      .first<{ '1': number }>();
    return result !== null;
  },

  /**
   * Find an LP by preview token. Used by the public /preview/:token
   * route to grant access to unpublished LPs via a hard-to-guess URL.
   */
  async findByPreviewToken(
    db: D1Database,
    token: string
  ): Promise<Page | null> {
    const result = await db
      .prepare('SELECT * FROM pages WHERE preview_token = ? LIMIT 1')
      .bind(token)
      .first<Page>();
    return result ?? null;
  },

  /**
   * Issue (or rotate) the preview token for an LP. Pass `null` to
   * revoke. Returns the updated page or null if no row was matched.
   */
  async setPreviewToken(
    db: D1Database,
    workspaceId: string,
    id: string,
    token: string | null
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        `UPDATE pages SET preview_token = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(token, id, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * List A/B variants of a parent LP.
   *
   * Variants are stored as separate rows with `page_type='ab_variant'`
   * and `parent_id` pointing at the original LP. They share the same
   * slug as the parent — distribution at /[slug] picks one based on
   * weights stored in `pages.meta.ab.weight`.
   *
   * Excludes trashed variants. Returns variants sorted by created_at.
   */
  async listVariants(
    db: D1Database,
    workspaceId: string,
    parentId: string
  ): Promise<Page[]> {
    const result = await db
      .prepare(
        `SELECT * FROM pages
         WHERE parent_id = ? AND workspace_id = ?
           AND page_type = 'ab_variant' AND status != 'trash'
         ORDER BY created_at ASC`
      )
      .bind(parentId, workspaceId)
      .all<Page>();
    return result.results ?? [];
  },

  /**
   * Create a new A/B variant of a parent LP. Inherits the parent's
   * slug (variants share the URL — distribution picks which one is
   * served) and starts with the supplied content (defaults to the
   * parent's current content so editors can fork from "as published").
   */
  async createVariant(
    db: D1Database,
    workspaceId: string,
    params: {
      id: string;
      parentId: string;
      slug: string;
      label: string;
      weight: number;
      content: string;
    }
  ): Promise<Page> {
    const meta = JSON.stringify({
      ab: { label: params.label, weight: params.weight },
    });
    await db
      .prepare(
        `INSERT INTO pages
         (id, slug, workspace_id, status, page_type, parent_id, version, content, max_width, meta)
         VALUES (?, ?, ?, 'draft', 'ab_variant', ?, 1, ?, 750, ?)`
      )
      .bind(
        params.id,
        params.slug,
        workspaceId,
        params.parentId,
        params.content,
        meta
      )
      .run();
    const created = await this.findById(db, workspaceId, params.id);
    if (!created) throw new Error('Failed to create variant');
    return created;
  },

  /**
   * Replace the AB metadata (label + weight) on an existing variant.
   * Other fields in `meta` are preserved.
   */
  async updateVariantAb(
    db: D1Database,
    workspaceId: string,
    id: string,
    ab: { label: string; weight: number }
  ): Promise<Page | null> {
    const existing = await this.findById(db, workspaceId, id);
    if (!existing || existing.page_type !== 'ab_variant') return null;

    let meta: Record<string, unknown> = {};
    if (existing.meta) {
      try {
        const parsed: unknown = JSON.parse(existing.meta);
        if (parsed && typeof parsed === 'object') {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        // ignore — overwrite below
      }
    }
    meta.ab = ab;

    const result = await db
      .prepare(
        `UPDATE pages SET meta = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(JSON.stringify(meta), id, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * List LPs currently in trash, newest-first by trashed_at. Used
   * by the admin trash UI.
   */
  async listTrash(db: D1Database, workspaceId: string): Promise<Page[]> {
    const result = await db
      .prepare(
        `SELECT * FROM pages
         WHERE status = 'trash' AND page_type = 'lp' AND workspace_id = ?
         ORDER BY trashed_at DESC`
      )
      .bind(workspaceId)
      .all<Page>();
    return result.results ?? [];
  },

  /**
   * Restore a trashed LP back to draft so it shows up in the
   * regular LP list again. Clears trashed_at. No-op (returns null)
   * if the row isn't currently in trash.
   */
  async restore(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        `UPDATE pages
         SET status = 'draft',
             trashed_at = NULL,
             updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ? AND status = 'trash'`
      )
      .bind(id, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * Permanent-delete a single trashed LP. Caller must have confirmed
   * with the user; this is irreversible. Only deletes from trash —
   * a non-trashed LP is left alone (returns false). Cascades through
   * page_meta / utm_links via foreign-key ON DELETE CASCADE.
   */
  async purge(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<boolean> {
    const result = await db
      .prepare(
        `DELETE FROM pages
         WHERE id = ? AND workspace_id = ? AND status = 'trash'`
      )
      .bind(id, workspaceId)
      .run();
    return result.meta.changes > 0;
  },

  /**
   * Soft-delete: move to trash and record `trashed_at` for the 7-day
   * cleanup cron. Physical deletion happens in a separate cron job.
   */
  async softDelete(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        `UPDATE pages
         SET status = 'trash',
             trashed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(id, workspaceId)
      .run();

    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },
};

/**
 * Site-wide settings (singleton row, id=1).
 */
export interface SiteSettings {
  id: number;
  maintenance_mode: number;
  custom_domain: string | null;
  meta: string | null;
  updated_at: string;
}

export const siteSettingsQueries = {
  /**
   * Get the singleton settings row, seeding it on first read so
   * downstream code never sees null.
   */
  async get(db: D1Database): Promise<SiteSettings> {
    const existing = await db
      .prepare('SELECT * FROM site_settings WHERE id = 1 LIMIT 1')
      .first<SiteSettings>();
    if (existing) return existing;
    await db
      .prepare(`INSERT INTO site_settings (id) VALUES (1)`)
      .run();
    const created = await db
      .prepare('SELECT * FROM site_settings WHERE id = 1 LIMIT 1')
      .first<SiteSettings>();
    if (!created) throw new Error('Failed to seed site_settings');
    return created;
  },

  async setMaintenanceMode(
    db: D1Database,
    enabled: boolean
  ): Promise<SiteSettings> {
    await this.get(db);
    await db
      .prepare(
        `UPDATE site_settings SET maintenance_mode = ?, updated_at = datetime('now') WHERE id = 1`
      )
      .bind(enabled ? 1 : 0)
      .run();
    return this.get(db);
  },
};

/**
 * Whether a page is currently visible to the public, accounting for
 * its status and the publish_at / unpublish_at scheduling window.
 *
 * `status='published'` is required, then:
 *   - publish_at null  → start of time
 *   - publish_at set   → must be in the past
 *   - unpublish_at null → end of time
 *   - unpublish_at set → must be in the future
 */
export function isLiveNow(page: Page, now: Date = new Date()): boolean {
  if (page.status !== 'published') return false;
  const t = now.getTime();
  if (page.publish_at) {
    const start = new Date(page.publish_at).getTime();
    if (Number.isFinite(start) && t < start) return false;
  }
  if (page.unpublish_at) {
    const end = new Date(page.unpublish_at).getTime();
    if (Number.isFinite(end) && t >= end) return false;
  }
  return true;
}

/**
 * MyLink record from D1.
 *
 * MyLinks are self-hoster-managed shortcuts for destinations like LINE
 * URLs, contact email addresses, phone numbers etc. CTAs
 * can reference a MyLink by id, so changing the MyLink updates every
 * CTA on every LP that points at it.
 */
export interface MyLink {
  id: string;
  workspace_id: string;
  label: string;
  url: string;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

export const myLinkQueries = {
  async list(db: D1Database, workspaceId: string): Promise<MyLink[]> {
    const result = await db
      .prepare(
        'SELECT * FROM my_links WHERE workspace_id = ? ORDER BY updated_at DESC'
      )
      .bind(workspaceId)
      .all<MyLink>();
    return result.results ?? [];
  },

  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<MyLink | null> {
    const result = await db
      .prepare(
        'SELECT * FROM my_links WHERE id = ? AND workspace_id = ? LIMIT 1'
      )
      .bind(id, workspaceId)
      .first<MyLink>();
    return result ?? null;
  },

  async create(
    db: D1Database,
    workspaceId: string,
    params: { id: string; label: string; url: string }
  ): Promise<MyLink> {
    await db
      .prepare(
        `INSERT INTO my_links (id, workspace_id, label, url) VALUES (?, ?, ?, ?)`
      )
      .bind(params.id, workspaceId, params.label, params.url)
      .run();

    const created = await this.findById(db, workspaceId, params.id);
    if (!created) throw new Error('Failed to create MyLink');
    return created;
  },

  async update(
    db: D1Database,
    workspaceId: string,
    id: string,
    params: { label: string; url: string }
  ): Promise<MyLink | null> {
    const result = await db
      .prepare(
        `UPDATE my_links
         SET label = ?, url = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(params.label, params.url, id, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  async remove(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<boolean> {
    const result = await db
      .prepare('DELETE FROM my_links WHERE id = ? AND workspace_id = ?')
      .bind(id, workspaceId)
      .run();
    return result.meta.changes > 0;
  },
};

/**
 * Site-wide tracking tag IDs, scoped per workspace (one row per
 * workspace_id; primary key).
 *
 * `meta` JSON holds extras like custom head HTML — keeps the row
 * forward-compatible without further migrations.
 */
export interface TrackingTags {
  workspace_id: string;
  gtm_id: string | null;
  ga4_id: string | null;
  clarity_id: string | null;
  meta_pixel_id: string | null;
  line_tag_id: string | null;
  tiktok_pixel_id: string | null;
  x_pixel_id: string | null;
  hotjar_id: string | null;
  meta: string | null;
  updated_at: string;
}

export const trackingTagsQueries = {
  /**
   * Returns the workspace's row, or null if it hasn't been created yet.
   */
  async get(
    db: D1Database,
    workspaceId: string
  ): Promise<TrackingTags | null> {
    const result = await db
      .prepare('SELECT * FROM tracking_tags WHERE workspace_id = ? LIMIT 1')
      .bind(workspaceId)
      .first<TrackingTags>();
    return result ?? null;
  },

  /**
   * Insert-or-update the workspace's row. Only fields present in
   * `params` are touched; the rest keep their existing values.
   */
  async upsert(
    db: D1Database,
    workspaceId: string,
    params: Partial<Omit<TrackingTags, 'workspace_id' | 'updated_at'>>
  ): Promise<TrackingTags> {
    const existing = await this.get(db, workspaceId);

    if (!existing) {
      const cols = ['workspace_id'] as string[];
      const placeholders = ['?'] as string[];
      const binds: (string | null)[] = [workspaceId];
      for (const [key, value] of Object.entries(params)) {
        cols.push(key);
        placeholders.push('?');
        binds.push((value as string | null | undefined) ?? null);
      }
      await db
        .prepare(
          `INSERT INTO tracking_tags (${cols.join(',')}) VALUES (${placeholders.join(',')})`
        )
        .bind(...binds)
        .run();
    } else {
      const fields: string[] = [];
      const binds: (string | null)[] = [];
      for (const [key, value] of Object.entries(params)) {
        fields.push(`${key} = ?`);
        binds.push((value as string | null | undefined) ?? null);
      }
      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        binds.push(workspaceId);
        await db
          .prepare(
            `UPDATE tracking_tags SET ${fields.join(', ')} WHERE workspace_id = ?`
          )
          .bind(...binds)
          .run();
      }
    }

    const after = await this.get(db, workspaceId);
    if (!after) throw new Error('Failed to upsert tracking_tags');
    return after;
  },
};

/**
 * UtmLink record from D1.
 *
 * Each row is a campaign-tagged short link belonging to a page.
 * Visiting /go/:shortPath bounces the visitor to the page's public
 * URL with the UTM params attached, so the self-hoster can hand out
 * one short URL per channel (X, Instagram, mail, etc.) and read
 * the breakdown in GA4 / GTM.
 */
export interface UtmLink {
  id: string;
  workspace_id: string;
  page_id: string | null;
  label: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  short_path: string | null;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

export const utmLinkQueries = {
  async listByPage(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<UtmLink[]> {
    const result = await db
      .prepare(
        `SELECT * FROM utm_links
         WHERE page_id = ? AND workspace_id = ?
         ORDER BY created_at DESC`
      )
      .bind(pageId, workspaceId)
      .all<UtmLink>();
    return result.results ?? [];
  },

  async findByShortPath(
    db: D1Database,
    shortPath: string
  ): Promise<UtmLink | null> {
    const result = await db
      .prepare('SELECT * FROM utm_links WHERE short_path = ? LIMIT 1')
      .bind(shortPath)
      .first<UtmLink>();
    return result ?? null;
  },

  async existsByShortPath(
    db: D1Database,
    shortPath: string
  ): Promise<boolean> {
    const result = await db
      .prepare('SELECT 1 FROM utm_links WHERE short_path = ? LIMIT 1')
      .bind(shortPath)
      .first<{ '1': number }>();
    return result !== null;
  },

  async create(
    db: D1Database,
    workspaceId: string,
    params: {
      id: string;
      pageId: string;
      label: string;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      utmContent: string | null;
      utmTerm: string | null;
      shortPath: string;
    }
  ): Promise<UtmLink> {
    await db
      .prepare(
        `INSERT INTO utm_links
         (id, workspace_id, page_id, label, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, short_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        workspaceId,
        params.pageId,
        params.label,
        params.utmSource,
        params.utmMedium,
        params.utmCampaign,
        params.utmContent,
        params.utmTerm,
        params.shortPath
      )
      .run();

    const created = await db
      .prepare('SELECT * FROM utm_links WHERE id = ?')
      .bind(params.id)
      .first<UtmLink>();
    if (!created) throw new Error('Failed to create UTM link');
    return created;
  },

  async remove(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<boolean> {
    const result = await db
      .prepare('DELETE FROM utm_links WHERE id = ? AND workspace_id = ?')
      .bind(id, workspaceId)
      .run();
    return result.meta.changes > 0;
  },
};

/**
 * Site-wide metadata defaults, scoped per workspace (one row per
 * workspace_id; primary key).
 * Used for favicon / Apple-touch-icon and as OGP fallback when
 * an individual LP doesn't supply its own.
 */
export interface SiteMeta {
  workspace_id: string;
  site_title: string | null;
  site_description: string | null;
  favicon_url: string | null;
  ogp_default_image_url: string | null;
  ogp_default_title: string | null;
  ogp_default_description: string | null;
  // Bare apex the self-hoster entered on the site-settings page,
  // e.g. "example.com". The Worker derives lp.{domain} as the public
  // host. NULL means the self-hoster hasn't wired a custom domain yet —
  // everything (canonical, QR, share URL) falls back to workers.dev.
  domain: string | null;
  // When 1, every workers.dev request 301s to lp.{domain}/{path}.
  // INTEGER (0/1) because SQLite has no boolean — callers should
  // treat 0 as "workers.dev still works" and 1 as "workers.dev is the
  // legacy URL, please redirect".
  workers_dev_disabled: number;
  meta: string | null;
  updated_at: string;
}

export const siteMetaQueries = {
  async get(
    db: D1Database,
    workspaceId: string
  ): Promise<SiteMeta | null> {
    const result = await db
      .prepare('SELECT * FROM site_meta WHERE workspace_id = ? LIMIT 1')
      .bind(workspaceId)
      .first<SiteMeta>();
    return result ?? null;
  },

  async upsert(
    db: D1Database,
    workspaceId: string,
    params: Partial<Omit<SiteMeta, 'workspace_id' | 'updated_at'>>
  ): Promise<SiteMeta> {
    const existing = await this.get(db, workspaceId);

    if (!existing) {
      const cols = ['workspace_id'] as string[];
      const placeholders = ['?'] as string[];
      const binds: (string | number | null)[] = [workspaceId];
      for (const [key, value] of Object.entries(params)) {
        cols.push(key);
        placeholders.push('?');
        binds.push((value as string | number | null | undefined) ?? null);
      }
      await db
        .prepare(
          `INSERT INTO site_meta (${cols.join(',')}) VALUES (${placeholders.join(',')})`
        )
        .bind(...binds)
        .run();
    } else {
      const fields: string[] = [];
      const binds: (string | number | null)[] = [];
      for (const [key, value] of Object.entries(params)) {
        fields.push(`${key} = ?`);
        binds.push((value as string | number | null | undefined) ?? null);
      }
      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        binds.push(workspaceId);
        await db
          .prepare(
            `UPDATE site_meta SET ${fields.join(', ')} WHERE workspace_id = ?`
          )
          .bind(...binds)
          .run();
      }
    }

    const after = await this.get(db, workspaceId);
    if (!after) throw new Error('Failed to upsert site_meta');
    return after;
  },
};

/**
 * MCP access mode. Controls what destructive operations the /mcp
 * endpoint exposes globally; individual tokens don't carry their
 * own scope.
 *
 * - read_only:      list / get only
 * - edit_no_delete: read + create + update (default, safest non-trivial)
 * - edit_full:      everything including deletes
 */
export type McpMode = 'read_only' | 'edit_no_delete' | 'edit_full';

export interface McpSettings {
  workspace_id: string;
  mode: McpMode;
  enabled: number;
  meta: string | null;
  updated_at: string;
}

export const mcpSettingsQueries = {
  /**
   * Returns the workspace's mcp_settings row, creating it with
   * defaults if it doesn't exist yet (migration 0001 seeded the
   * 'default' workspace, but we tolerate a missing row for any
   * workspace that hasn't been initialized).
   */
  async get(db: D1Database, workspaceId: string): Promise<McpSettings> {
    const existing = await db
      .prepare('SELECT * FROM mcp_settings WHERE workspace_id = ? LIMIT 1')
      .bind(workspaceId)
      .first<McpSettings>();
    if (existing) return existing;

    await db
      .prepare(
        `INSERT INTO mcp_settings (workspace_id, mode, enabled) VALUES (?, 'edit_no_delete', 1)`
      )
      .bind(workspaceId)
      .run();
    const created = await db
      .prepare('SELECT * FROM mcp_settings WHERE workspace_id = ? LIMIT 1')
      .bind(workspaceId)
      .first<McpSettings>();
    if (!created) throw new Error('Failed to seed mcp_settings');
    return created;
  },

  async update(
    db: D1Database,
    workspaceId: string,
    params: { mode?: McpMode; enabled?: boolean }
  ): Promise<McpSettings> {
    await this.get(db, workspaceId);
    const fields: string[] = [];
    const binds: (string | number)[] = [];
    if (params.mode !== undefined) {
      fields.push('mode = ?');
      binds.push(params.mode);
    }
    if (params.enabled !== undefined) {
      fields.push('enabled = ?');
      binds.push(params.enabled ? 1 : 0);
    }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      binds.push(workspaceId);
      await db
        .prepare(
          `UPDATE mcp_settings SET ${fields.join(', ')} WHERE workspace_id = ?`
        )
        .bind(...binds)
        .run();
    }
    return this.get(db, workspaceId);
  },
};

/**
 * MCP token record. The raw token is never stored — only its SHA-256
 * hash and a short identifying prefix.
 */
export interface McpToken {
  id: string;
  workspace_id: string;
  label: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export const mcpTokenQueries = {
  async list(db: D1Database, workspaceId: string): Promise<McpToken[]> {
    const result = await db
      .prepare(
        'SELECT * FROM mcp_tokens WHERE workspace_id = ? ORDER BY created_at DESC'
      )
      .bind(workspaceId)
      .all<McpToken>();
    return result.results ?? [];
  },

  async create(
    db: D1Database,
    workspaceId: string,
    params: {
      id: string;
      label: string;
      tokenHash: string;
      tokenPrefix: string;
    }
  ): Promise<McpToken> {
    await db
      .prepare(
        `INSERT INTO mcp_tokens (id, workspace_id, label, token_hash, token_prefix)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        workspaceId,
        params.label,
        params.tokenHash,
        params.tokenPrefix
      )
      .run();
    const created = await db
      .prepare(
        'SELECT * FROM mcp_tokens WHERE id = ? AND workspace_id = ? LIMIT 1'
      )
      .bind(params.id, workspaceId)
      .first<McpToken>();
    if (!created) throw new Error('Failed to create mcp_token');
    return created;
  },

  /**
   * Look up an active (non-revoked) token by its hash. Returns null
   * if not found or revoked. The hash itself is unique across
   * workspaces (a single bearer-token presented at /mcp resolves to
   * exactly one row), so workspace scoping isn't required here —
   * the caller will read `workspace_id` off the returned record.
   */
  async findActiveByHash(
    db: D1Database,
    tokenHash: string
  ): Promise<McpToken | null> {
    const result = await db
      .prepare(
        `SELECT * FROM mcp_tokens
         WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`
      )
      .bind(tokenHash)
      .first<McpToken>();
    return result ?? null;
  },

  async touchLastUsed(db: D1Database, id: string): Promise<void> {
    await db
      .prepare(
        `UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ?`
      )
      .bind(id)
      .run();
  },

  async revoke(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<boolean> {
    const result = await db
      .prepare(
        `UPDATE mcp_tokens
         SET revoked_at = datetime('now')
         WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`
      )
      .bind(id, workspaceId)
      .run();
    return result.meta.changes > 0;
  },
};

/**
 * Generate a short, URL-friendly token for /go/:shortPath.
 * Uses base36 chars from crypto.randomUUID for collision safety
 * without going full UUID length.
 */
export function generateShortPath(length = 6): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  // Base16 chars are URL-safe — keep first N hex chars
  return uuid.slice(0, length);
}

/**
 * Generate a raw MCP bearer token. Format: `mcp_<32 hex chars>`.
 * The `mcp_` prefix makes leaked tokens trivially greppable in
 * GitHub secret scanning / self-hoster logs.
 */
export function generateMcpToken(): string {
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return `mcp_${a}${b}`.slice(0, 36); // 'mcp_' + 32 chars
}

/**
 * SHA-256 hash a raw token to its hex storage form.
 */
export async function hashMcpToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a unique ID (used for users, pages, etc.)
 * Uses crypto.randomUUID() which is available in Cloudflare Workers.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Visitor session tracking (added in migration 0010).
 *
 * All writes are best-effort: a database hiccup must never break the
 * actual LP rendering. Callers wrap these in try/catch and swallow.
 */

export interface Session {
  session_id: string;
  workspace_id: string;
  first_seen_at: string;
  last_seen_at: string;
  ip_hash: string | null;
  ua_hash: string | null;
}

export const sessionQueries = {
  /**
   * Insert a new session row, or bump last_seen_at on an existing one.
   * The cookie's lifetime is long (one year), so a single session_id
   * may come back days later — the upsert handles both branches.
   */
  async upsert(
    db: D1Database,
    sessionId: string,
    workspaceId: string,
    ipHash: string | null,
    uaHash: string | null
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO sessions (session_id, workspace_id, ip_hash, ua_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           last_seen_at = datetime('now')`
      )
      .bind(sessionId, workspaceId, ipHash, uaHash)
      .run();
  },
};

export interface PageView {
  id: string;
  session_id: string;
  page_id: string;
  workspace_id: string;
  viewed_at: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

export const pageViewQueries = {
  async create(
    db: D1Database,
    params: {
      sessionId: string;
      pageId: string;
      workspaceId: string;
      referrer: string | null;
      utm: {
        source: string | null;
        medium: string | null;
        campaign: string | null;
        content: string | null;
        term: string | null;
      };
    }
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO page_views (
           id, session_id, page_id, workspace_id,
           referrer, utm_source, utm_medium, utm_campaign,
           utm_content, utm_term
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId(),
        params.sessionId,
        params.pageId,
        params.workspaceId,
        params.referrer,
        params.utm.source,
        params.utm.medium,
        params.utm.campaign,
        params.utm.content,
        params.utm.term
      )
      .run();
  },
};

export interface Click {
  id: string;
  session_id: string | null;
  page_id: string;
  cta_id: string;
  workspace_id: string;
  link_type: string | null;
  destination_url: string | null;
  clicked_at: string;
}

export const clickQueries = {
  async create(
    db: D1Database,
    params: {
      sessionId: string | null;
      pageId: string;
      ctaId: string;
      workspaceId: string;
      linkType: string | null;
      destinationUrl: string | null;
    }
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO clicks (
           id, session_id, page_id, cta_id, workspace_id,
           link_type, destination_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId(),
        params.sessionId,
        params.pageId,
        params.ctaId,
        params.workspaceId,
        params.linkType,
        params.destinationUrl
      )
      .run();
  },
};

/**
 * Admin authentication tables (added in migration 0012).
 *
 * `admin_users` is the source of truth for "who is allowed into
 * /admin"; `admin_sessions` holds the live browser sessions issued
 * after a Google OAuth round-trip.
 *
 * The legacy `users` table from 0001 is left in place but is no
 * longer read or written by the auth path.
 */

export interface AdminUser {
  id: string;
  workspace_id: string;
  email: string;
  google_sub: string | null;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

export const adminUserQueries = {
  async findByEmail(
    db: D1Database,
    workspaceId: string,
    email: string
  ): Promise<AdminUser | null> {
    const result = await db
      .prepare(
        `SELECT * FROM admin_users WHERE workspace_id = ? AND email = ?`
      )
      .bind(workspaceId, email)
      .first<AdminUser>();
    return result ?? null;
  },

  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<AdminUser | null> {
    const result = await db
      .prepare(
        `SELECT * FROM admin_users WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, id)
      .first<AdminUser>();
    return result ?? null;
  },

  async list(
    db: D1Database,
    workspaceId: string
  ): Promise<AdminUser[]> {
    const result = await db
      .prepare(
        `SELECT * FROM admin_users WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .bind(workspaceId)
      .all<AdminUser>();
    return result.results ?? [];
  },

  async count(db: D1Database, workspaceId: string): Promise<number> {
    const result = await db
      .prepare(
        `SELECT COUNT(*) as count FROM admin_users WHERE workspace_id = ?`
      )
      .bind(workspaceId)
      .first<{ count: number }>();
    return result?.count ?? 0;
  },

  async create(
    db: D1Database,
    params: {
      id: string;
      workspaceId: string;
      email: string;
      googleSub: string | null;
      role?: string;
    }
  ): Promise<AdminUser> {
    await db
      .prepare(
        `INSERT INTO admin_users (id, workspace_id, email, google_sub, role)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        params.workspaceId,
        params.email,
        params.googleSub,
        params.role ?? 'owner'
      )
      .run();
    const created = await this.findById(db, params.workspaceId, params.id);
    if (!created) throw new Error('Failed to create admin_user');
    return created;
  },

  async updateGoogleSub(
    db: D1Database,
    workspaceId: string,
    id: string,
    googleSub: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE admin_users SET google_sub = ? WHERE workspace_id = ? AND id = ?`
      )
      .bind(googleSub, workspaceId, id)
      .run();
  },

  async updateLastLogin(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE admin_users SET last_login_at = datetime('now')
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, id)
      .run();
  },

  async deleteById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<void> {
    await db
      .prepare(
        `DELETE FROM admin_users WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, id)
      .run();
  },
};

export interface AdminSession {
  token: string;
  admin_user_id: string;
  workspace_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export const adminSessionQueries = {
  async create(
    db: D1Database,
    params: {
      token: string;
      adminUserId: string;
      workspaceId: string;
      expiresAtIso: string;
    }
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO admin_sessions (token, admin_user_id, workspace_id, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(
        params.token,
        params.adminUserId,
        params.workspaceId,
        params.expiresAtIso
      )
      .run();
  },

  /**
   * Look up a session by token AND verify it hasn't expired. Returns
   * the joined admin_user when valid, null otherwise. Side effect: on
   * a hit, both `last_seen_at` and `expires_at` are pushed forward
   * (sliding 30-day expiration). The bump is best-effort — a write
   * failure shouldn't lock the operator out, so it's not awaited
   * inside the same prepare().
   */
  async findValidWithUser(
    db: D1Database,
    token: string
  ): Promise<{ session: AdminSession; user: AdminUser } | null> {
    const row = await db
      .prepare(
        `SELECT
           s.token AS s_token,
           s.admin_user_id AS s_admin_user_id,
           s.workspace_id AS s_workspace_id,
           s.created_at AS s_created_at,
           s.expires_at AS s_expires_at,
           s.last_seen_at AS s_last_seen_at,
           u.id AS u_id,
           u.workspace_id AS u_workspace_id,
           u.email AS u_email,
           u.google_sub AS u_google_sub,
           u.role AS u_role,
           u.created_at AS u_created_at,
           u.last_login_at AS u_last_login_at
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_user_id
         WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
         LIMIT 1`
      )
      .bind(token)
      .first<Record<string, string | null>>();
    if (!row) return null;
    return {
      session: {
        token: row.s_token as string,
        admin_user_id: row.s_admin_user_id as string,
        workspace_id: row.s_workspace_id as string,
        created_at: row.s_created_at as string,
        expires_at: row.s_expires_at as string,
        last_seen_at: row.s_last_seen_at as string,
      },
      user: {
        id: row.u_id as string,
        workspace_id: row.u_workspace_id as string,
        email: row.u_email as string,
        google_sub: row.u_google_sub,
        role: row.u_role as string,
        created_at: row.u_created_at as string,
        last_login_at: row.u_last_login_at,
      },
    };
  },

  async slide(
    db: D1Database,
    token: string,
    expiresAtIso: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE admin_sessions
         SET last_seen_at = datetime('now'), expires_at = ?
         WHERE token = ?`
      )
      .bind(expiresAtIso, token)
      .run();
  },

  async deleteByToken(db: D1Database, token: string): Promise<void> {
    await db
      .prepare(`DELETE FROM admin_sessions WHERE token = ?`)
      .bind(token)
      .run();
  },

  async deleteByAdminUserId(
    db: D1Database,
    workspaceId: string,
    adminUserId: string
  ): Promise<void> {
    await db
      .prepare(
        `DELETE FROM admin_sessions WHERE workspace_id = ? AND admin_user_id = ?`
      )
      .bind(workspaceId, adminUserId)
      .run();
  },
};
