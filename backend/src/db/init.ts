import Database, { type Database as DatabaseType } from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATABASE_PATH =
  process.env.DATABASE_PATH ?? "./data/cicd-doctor.db";

// Ensure the parent directory exists before opening the file
const dbDir = path.dirname(DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db: DatabaseType = new Database(DATABASE_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// Create the build_records table (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS build_records (
    id            TEXT PRIMARY KEY,
    repo_name     TEXT NOT NULL,
    job_name      TEXT NOT NULL,
    commit_sha    TEXT NOT NULL,
    branch        TEXT,
    source        TEXT NOT NULL CHECK(source IN ('github','jenkins','simulate')),
    raw_log       TEXT NOT NULL,
    cleaned_log   TEXT,
    truncated     INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','complete','unavailable')),
    category      TEXT,
    explanation   TEXT,
    suggested_fix TEXT,
    confidence    TEXT CHECK(confidence IN ('high','medium','low')),
    retry_count   INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at    TEXT NOT NULL,
    completed_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_build_records_status
    ON build_records(status);

  CREATE INDEX IF NOT EXISTS idx_build_records_created
    ON build_records(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_build_records_category
    ON build_records(category);
`);

// Create the feedback table (stretch feature)
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id              TEXT PRIMARY KEY,
    build_record_id TEXT NOT NULL REFERENCES build_records(id),
    client_id       TEXT NOT NULL,
    rating          TEXT NOT NULL CHECK(rating IN ('helpful','unhelpful')),
    created_at      TEXT NOT NULL,
    UNIQUE(build_record_id, client_id)
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_build_record
    ON feedback(build_record_id);

  CREATE INDEX IF NOT EXISTS idx_feedback_category
    ON feedback(build_record_id);
`);

export { db };
