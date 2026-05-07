
ALTER TABLE pages ADD COLUMN preview_token TEXT;

CREATE INDEX idx_pages_preview_token ON pages(preview_token);

INSERT INTO schema_migrations (version) VALUES ('0002_preview_token');
