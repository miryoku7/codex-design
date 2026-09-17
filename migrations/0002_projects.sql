CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision TEXT NOT NULL
);
CREATE INDEX projects_updated_at ON projects(updated_at DESC, id);

ALTER TABLE designs ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE designs ADD COLUMN kind TEXT NOT NULL DEFAULT 'screen' CHECK (kind IN ('screen', 'component'));
CREATE INDEX designs_project_kind_updated_at ON designs(project_id, kind, updated_at DESC, id);
