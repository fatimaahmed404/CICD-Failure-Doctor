"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/cicd-doctor.db";
// Ensure the parent directory exists before opening the file
const dbDir = path_1.default.dirname(DATABASE_PATH);
if (!fs_1.default.existsSync(dbDir)) {
    fs_1.default.mkdirSync(dbDir, { recursive: true });
}
const db = new better_sqlite3_1.default(DATABASE_PATH);
exports.db = db;
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
// Create the feedback table (stretch feature — Req 13)
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
// Create github_tokens table (stretch feature — Req 17.18)
// Stores AES-256-GCM encrypted OAuth access tokens per anonymous client.
db.exec(`
  CREATE TABLE IF NOT EXISTS github_tokens (
    client_id       TEXT PRIMARY KEY,
    encrypted_token TEXT NOT NULL,
    github_username TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_github_tokens_created
    ON github_tokens(created_at DESC);
`);
// Create users table for per-user authentication and webhook isolation.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    webhook_secret  TEXT NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);

  CREATE INDEX IF NOT EXISTS idx_users_webhook_secret
    ON users(webhook_secret);
`);
// Add user_id column to build_records if it doesn't exist yet (migration).
const buildRecordsCols = db.pragma("table_info(build_records)");
const hasUserId = buildRecordsCols.some((col) => col.name === "user_id");
if (!hasUserId) {
    db.exec(`ALTER TABLE build_records ADD COLUMN user_id TEXT REFERENCES users(id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_build_records_user_id ON build_records(user_id)`);
}
// Add user_id column to github_tokens if it doesn't exist yet (migration).
const githubTokensCols = db.pragma("table_info(github_tokens)");
if (!githubTokensCols.some((col) => col.name === "user_id")) {
    db.exec(`ALTER TABLE github_tokens ADD COLUMN user_id TEXT REFERENCES users(id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_github_tokens_user_id ON github_tokens(user_id)`);
}
//# sourceMappingURL=init.js.map