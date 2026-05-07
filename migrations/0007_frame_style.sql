
ALTER TABLE pages ADD COLUMN frame_style TEXT;

INSERT INTO schema_migrations (version) VALUES ('0007_frame_style');
