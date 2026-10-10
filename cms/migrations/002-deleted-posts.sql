ALTER TABLE cms.posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
