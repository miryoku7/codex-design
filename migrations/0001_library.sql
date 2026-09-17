CREATE TABLE designs (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision TEXT NOT NULL
);
CREATE INDEX designs_updated_at ON designs(updated_at DESC, id);
