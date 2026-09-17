CREATE TABLE design_kits (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  revision TEXT NOT NULL,
  latest_version INTEGER NOT NULL CHECK (latest_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX design_kits_updated_at ON design_kits(updated_at DESC, id);

CREATE TABLE design_kit_versions (
  kit_id TEXT NOT NULL REFERENCES design_kits(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kit_id, version)
);

CREATE TABLE project_kits (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
  kit_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY (kit_id, version) REFERENCES design_kit_versions(kit_id, version)
);
