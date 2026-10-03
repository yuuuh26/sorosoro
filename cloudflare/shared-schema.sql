-- Run on a NEW shared database. Preserves this app's existing retention policy.
CREATE TABLE sorosoro_auth_attempts (
  ip_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(ip_hash,bucket)
);
CREATE TABLE sorosoro_auth_config (
  app_id TEXT PRIMARY KEY CHECK(app_id='sorosoro'),
  key_sha256 TEXT NOT NULL
);
CREATE TABLE sorosoro_auth_sessions (
  session_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE sorosoro_backup_chunks (
  backup_id TEXT NOT NULL REFERENCES sorosoro_backups(backup_id),
  chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
  backup_json TEXT NOT NULL,
  PRIMARY KEY(backup_id,chunk_index)
);
CREATE TABLE sorosoro_backup_retention (
  backup_id TEXT PRIMARY KEY REFERENCES sorosoro_backups(backup_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL CHECK(app_id='sorosoro'),
  verified_at TEXT,
  version_number INTEGER,
  UNIQUE(app_id,version_number),
  CHECK((verified_at IS NULL AND version_number IS NULL) OR (verified_at IS NOT NULL AND version_number>0))
);
CREATE TABLE sorosoro_backups (
  backup_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL CHECK(app_id='sorosoro'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  device_id TEXT,
  record_count INTEGER NOT NULL CHECK(record_count>=0),
  source_revision INTEGER NOT NULL CHECK(source_revision>=0),
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>0),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 42)
);
CREATE INDEX sorosoro_auth_sessions_app ON sorosoro_auth_sessions(app_id, revoked_at);
CREATE INDEX sorosoro_backups_history ON sorosoro_backups(app_id,received_at DESC,backup_id DESC);
CREATE TRIGGER sorosoro_backups_no_delete BEFORE DELETE ON sorosoro_backups
WHEN OLD.backup_id NOT IN (
  SELECT b.backup_id FROM sorosoro_backups b JOIN sorosoro_backup_retention r ON r.backup_id=b.backup_id
  WHERE b.app_id=OLD.app_id AND r.version_number IS NOT NULL
  ORDER BY r.version_number DESC LIMIT -1 OFFSET 5
) BEGIN SELECT RAISE(ABORT,'protected backup'); END;
CREATE TRIGGER sorosoro_backups_no_update BEFORE UPDATE ON sorosoro_backups BEGIN SELECT RAISE(ABORT,'immutable backup'); END;
CREATE TRIGGER sorosoro_chunks_no_delete BEFORE DELETE ON sorosoro_backup_chunks
WHEN OLD.backup_id NOT IN (
  SELECT b.backup_id FROM sorosoro_backups b JOIN sorosoro_backup_retention r ON r.backup_id=b.backup_id
  WHERE b.app_id='sorosoro' AND r.version_number IS NOT NULL
  ORDER BY r.version_number DESC LIMIT -1 OFFSET 5
) BEGIN SELECT RAISE(ABORT,'protected backup'); END;
CREATE TRIGGER sorosoro_chunks_no_update BEFORE UPDATE ON sorosoro_backup_chunks BEGIN SELECT RAISE(ABORT,'immutable backup'); END;
