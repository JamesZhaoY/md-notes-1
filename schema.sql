-- MD Notes 数据表。
-- Worker 首次运行时会自动执行同样的语句，所以这个文件只是备用：
--   npx wrangler d1 execute md-notes --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  title      TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at DESC);
