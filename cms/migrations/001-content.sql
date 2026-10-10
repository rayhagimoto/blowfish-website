CREATE SCHEMA IF NOT EXISTS cms;
CREATE SCHEMA IF NOT EXISTS cms_auth;

CREATE TABLE IF NOT EXISTS cms.posts (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  markdown text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]',
  date timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  published jsonb,
  published_at timestamptz,
  source_path text,
  frontmatter jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cms.media (
  id uuid PRIMARY KEY,
  object_key text UNIQUE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size >= 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  legacy_path text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cms.gallery (
  id text PRIMARY KEY CHECK (id = 'main'),
  items jsonb NOT NULL DEFAULT '[]',
  published jsonb,
  revision integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cms.rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS cms.builds (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  message text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS cms_rate_limits_expiry ON cms.rate_limits(expires_at);
