
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE user_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  meta_key TEXT NOT NULL,
  meta_value TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, meta_key)
);

CREATE INDEX idx_user_meta_user_id ON user_meta(user_id);
CREATE INDEX idx_user_meta_key ON user_meta(meta_key);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'draft',
  page_type TEXT NOT NULL DEFAULT 'lp',
  parent_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,

  is_main_lp INTEGER NOT NULL DEFAULT 0,

  content TEXT NOT NULL DEFAULT '{}',

  max_width INTEGER NOT NULL DEFAULT 750,

  meta TEXT DEFAULT '{}',

  custom_domain TEXT,

  password_hash TEXT,

  publish_at TEXT,
  unpublish_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  trashed_at TEXT,

  FOREIGN KEY (parent_id) REFERENCES pages(id) ON DELETE SET NULL
);

CREATE INDEX idx_pages_slug ON pages(slug);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_pages_page_type ON pages(page_type);
CREATE INDEX idx_pages_is_main_lp ON pages(is_main_lp);
CREATE INDEX idx_pages_parent_id ON pages(parent_id);
CREATE INDEX idx_pages_trashed_at ON pages(trashed_at);

CREATE TABLE page_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL,
  meta_key TEXT NOT NULL,
  meta_value TEXT,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  UNIQUE(page_id, meta_key)
);

CREATE INDEX idx_page_meta_page_id ON page_meta(page_id);
CREATE INDEX idx_page_meta_key ON page_meta(meta_key);

CREATE TABLE my_links (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  meta TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_my_links_label ON my_links(label);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  endpoint TEXT,
  api_key_encrypted TEXT,
    -- Encrypted, never plain text
  meta TEXT DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_connections_type ON connections(type);

CREATE TABLE tracking_tags (
  id INTEGER PRIMARY KEY DEFAULT 1,
  gtm_id TEXT,
  ga4_id TEXT,
  clarity_id TEXT,
  meta_pixel_id TEXT,
  line_tag_id TEXT,
  tiktok_pixel_id TEXT,
  x_pixel_id TEXT,
  hotjar_id TEXT,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id = 1)
);

CREATE TABLE site_meta (
  id INTEGER PRIMARY KEY DEFAULT 1,
  site_title TEXT,
  site_description TEXT,
  favicon_url TEXT,
  ogp_default_image_url TEXT,
  ogp_default_title TEXT,
  ogp_default_description TEXT,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id = 1)
);

CREATE TABLE utm_links (
  id TEXT PRIMARY KEY,
  page_id TEXT,
  label TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  short_path TEXT UNIQUE,
  meta TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX idx_utm_links_page_id ON utm_links(page_id);
CREATE INDEX idx_utm_links_short_path ON utm_links(short_path);

CREATE TABLE mcp_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'edit_no_delete',
  enabled INTEGER NOT NULL DEFAULT 1,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id = 1)
);

CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  maintenance_mode INTEGER NOT NULL DEFAULT 0,
  custom_domain TEXT,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id = 1)
);

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO schema_migrations (version) VALUES ('0001_initial_schema');
