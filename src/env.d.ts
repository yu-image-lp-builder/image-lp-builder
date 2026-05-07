/// <reference types="astro/client" />

// Cloudflare Workers bindings (defined in wrangler.jsonc)
// In Astro v6, use `import { env } from 'cloudflare:workers'` to access bindings.
interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  OAUTH_RELAY_URL?: string;
}

// Cloudflare Workers types augmentation
declare module 'cloudflare:workers' {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: Fetcher;
    RATE_LIMIT: KVNamespace;
    OAUTH_RELAY_URL?: string;
  }
}

// Authenticated admin info (populated by middleware from
// `admin_users` after a verified session-cookie hit).
interface User {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

declare namespace App {
  interface Locals {
    user: User | null;
    /**
     * Active workspace for this request. Always present — middleware
     * sets it to DEFAULT_WORKSPACE for both protected and public
     * routes. Used by db queries to scope reads / writes.
     */
    workspace_id: string;
    /**
     * Visitor session id for the current request. Set on public LP
     * routes (`/<slug>`) by the middleware — either pulled from the
     * `image_lp_sid` cookie or freshly minted. Null on every other route
     * (admin, api, preview, redirects) where session tracking doesn't
     * apply.
     */
    session_id: string | null;
  }
}
