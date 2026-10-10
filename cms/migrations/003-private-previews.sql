ALTER TABLE cms.media ADD COLUMN IF NOT EXISTS preview_object_key text UNIQUE;
ALTER TABLE cms.media ADD COLUMN IF NOT EXISTS preview_size integer NOT NULL DEFAULT 0 CHECK (preview_size >= 0);
