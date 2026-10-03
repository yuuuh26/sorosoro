CREATE TABLE IF NOT EXISTS auth_config (
  app_id TEXT PRIMARY KEY CHECK(app_id='sorosoro'),
  key_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  ip_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(ip_hash,bucket)
);
