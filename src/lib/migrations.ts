/**
 * Migration runner for D1.
 *
 * Self-hosters deploy this OSS by clicking a "Deploy to Cloudflare"
 * button — they never touch wrangler or open a SQL prompt. So
 * applying schema migrations has to happen *automatically* on the
 * first request after a fresh deploy or upgrade.
 *
 * Strategy:
 * - Each `migrations/*.sql` file is imported at build time as a raw
 *   string via Vite's `?raw` query (zero runtime fetch cost).
 * - On the first request handled by an isolate, runPendingMigrations
 *   bootstraps `schema_migrations` if necessary, reads the set of
 *   versions already applied, and runs every newer SQL file in order.
 * - A module-scoped Promise caches the result so a single isolate
 *   doesn't re-check on every request.
 *
 * Each .sql file is responsible for its own
 *   `INSERT INTO schema_migrations (version) VALUES (...)` line, so
 *   running the file is what marks it applied.
 */

import migration0001 from '../../migrations/0001_initial_schema.sql?raw';
import migration0002 from '../../migrations/0002_preview_token.sql?raw';
import migration0003 from '../../migrations/0003_mcp_tokens.sql?raw';
import migration0004 from '../../migrations/0004_drop_is_main_lp.sql?raw';
import migration0005 from '../../migrations/0005_live_content.sql?raw';
import migration0006 from '../../migrations/0006_background_color.sql?raw';
import migration0007 from '../../migrations/0007_frame_style.sql?raw';
import migration0008 from '../../migrations/0008_workspace_id.sql?raw';
import migration0009 from '../../migrations/0009_workspace_id_singletons.sql?raw';
import migration0010 from '../../migrations/0010_session_tracking.sql?raw';
import migration0011 from '../../migrations/0011_site_meta_domain.sql?raw';
import migration0012 from '../../migrations/0012_admin_auth.sql?raw';
import migration0013 from '../../migrations/0013_workspace_github_installations.sql?raw';

interface Migration {
  version: string;
  sql: string;
}

// Order matters — versions are applied in array order.
const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: '0001_initial_schema', sql: migration0001 },
  { version: '0002_preview_token', sql: migration0002 },
  { version: '0003_mcp_tokens', sql: migration0003 },
  { version: '0004_drop_is_main_lp', sql: migration0004 },
  { version: '0005_live_content', sql: migration0005 },
  { version: '0006_background_color', sql: migration0006 },
  { version: '0007_frame_style', sql: migration0007 },
  { version: '0008_workspace_id', sql: migration0008 },
  { version: '0009_workspace_id_singletons', sql: migration0009 },
  { version: '0010_session_tracking', sql: migration0010 },
  { version: '0011_site_meta_domain', sql: migration0011 },
  { version: '0012_admin_auth', sql: migration0012 },
  {
    version: '0013_workspace_github_installations',
    sql: migration0013,
  },
];

let runOnce: Promise<void> | null = null;

/**
 * Apply any migrations the database is missing. Safe to call on
 * every request — the actual work is memoised per isolate.
 */
export function runPendingMigrations(db: D1Database): Promise<void> {
  if (runOnce) return runOnce;
  runOnce = applyMigrations(db).catch((err) => {
    // Reset the cache so a future request can retry; logging is
    // best-effort because we don't want a migration failure to
    // crash the whole isolate.
    runOnce = null;
    console.error('Migration failed:', err);
    throw err;
  });
  return runOnce;
}

async function applyMigrations(db: D1Database): Promise<void> {
  // Read which versions are already applied. On a fresh database
  // schema_migrations doesn't exist yet — treat the SELECT failure
  // as "no migrations applied". Each migration file is responsible
  // for creating any tables it needs (including schema_migrations
  // itself in 0001).
  let appliedVersions = new Set<string>();
  try {
    const applied = await db
      .prepare('SELECT version FROM schema_migrations')
      .all<{ version: string }>();
    appliedVersions = new Set((applied.results ?? []).map((r) => r.version));
  } catch {
    // schema_migrations doesn't exist — fall through, run everything.
  }

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    try {
      const statements = splitStatements(migration.sql);
      // Run as a batch so partial failures don't leave the schema
      // half-applied. The final INSERT into schema_migrations rides
      // along, marking the migration applied iff every preceding
      // statement succeeded.
      await db.batch(statements.map((s) => db.prepare(s)));
    } catch (err) {
      throw new Error(
        `Failed to apply migration ${migration.version}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

/**
 * Split a migration SQL blob into individual statements ready for
 * `db.prepare()`. Strips line + block comments, splits on `;`, drops
 * empty fragments. Doesn't try to be a full SQL parser — string
 * literals containing semicolons would confuse it, but our migration
 * files don't carry any.
 */
function splitStatements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* block comments */
    .replace(/--[^\n]*/g, '') //         -- line comments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
