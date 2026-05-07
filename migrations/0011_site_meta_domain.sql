
ALTER TABLE site_meta ADD COLUMN domain TEXT;
ALTER TABLE site_meta ADD COLUMN workers_dev_disabled INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (version) VALUES ('0011_site_meta_domain');
