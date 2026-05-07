
ALTER TABLE pages ADD COLUMN background_color TEXT;

INSERT INTO schema_migrations (version) VALUES ('0006_background_color');
