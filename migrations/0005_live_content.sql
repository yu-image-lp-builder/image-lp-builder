
ALTER TABLE pages ADD COLUMN live_content TEXT;

UPDATE pages
SET live_content = content
WHERE status = 'published';

INSERT INTO schema_migrations (version) VALUES ('0005_live_content');
