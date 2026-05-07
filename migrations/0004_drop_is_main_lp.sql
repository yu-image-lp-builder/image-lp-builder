
DROP INDEX IF EXISTS idx_pages_is_main_lp;

ALTER TABLE pages DROP COLUMN is_main_lp;

INSERT INTO schema_migrations (version) VALUES ('0004_drop_is_main_lp');
