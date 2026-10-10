-- Immutable repository body lets unchanged legacy formatting survive unpublish/republish.
ALTER TABLE cms.posts ADD COLUMN IF NOT EXISTS trusted_markdown text;
UPDATE cms.posts SET trusted_markdown = published->>'markdown'
WHERE source_path IS NOT NULL AND published->>'legacy' = 'true' AND trusted_markdown IS NULL;
