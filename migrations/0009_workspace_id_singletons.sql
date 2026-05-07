
PRAGMA foreign_keys = OFF;

CREATE TABLE tracking_tags_new (
  workspace_id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  gtm_id TEXT,
  ga4_id TEXT,
  clarity_id TEXT,
  meta_pixel_id TEXT,
  line_tag_id TEXT,
  tiktok_pixel_id TEXT,
  x_pixel_id TEXT,
  hotjar_id TEXT,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tracking_tags_new (
  workspace_id, gtm_id, ga4_id, clarity_id, meta_pixel_id,
  line_tag_id, tiktok_pixel_id, x_pixel_id, hotjar_id, meta, updated_at
)
SELECT
  'default', gtm_id, ga4_id, clarity_id, meta_pixel_id,
  line_tag_id, tiktok_pixel_id, x_pixel_id, hotjar_id, meta, updated_at
FROM tracking_tags;

DROP TABLE tracking_tags;
ALTER TABLE tracking_tags_new RENAME TO tracking_tags;

CREATE TABLE site_meta_new (
  workspace_id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  site_title TEXT,
  site_description TEXT,
  favicon_url TEXT,
  ogp_default_image_url TEXT,
  ogp_default_title TEXT,
  ogp_default_description TEXT,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO site_meta_new (
  workspace_id, site_title, site_description, favicon_url,
  ogp_default_image_url, ogp_default_title, ogp_default_description,
  meta, updated_at
)
SELECT
  'default', site_title, site_description, favicon_url,
  ogp_default_image_url, ogp_default_title, ogp_default_description,
  meta, updated_at
FROM site_meta;

DROP TABLE site_meta;
ALTER TABLE site_meta_new RENAME TO site_meta;

CREATE TABLE mcp_settings_new (
  workspace_id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  mode TEXT NOT NULL DEFAULT 'edit_no_delete',
  enabled INTEGER NOT NULL DEFAULT 1,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO mcp_settings_new (
  workspace_id, mode, enabled, meta, updated_at
)
SELECT
  'default', mode, enabled, meta, updated_at
FROM mcp_settings;

DROP TABLE mcp_settings;
ALTER TABLE mcp_settings_new RENAME TO mcp_settings;

PRAGMA foreign_keys = ON;

INSERT INTO schema_migrations (version) VALUES ('0009_workspace_id_singletons');
