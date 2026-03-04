/**
 * init_db.ts — Database Initialization Script
 *
 * Creates the local_state.sqlite database with two core tables:
 * - active_context: FIFO rolling buffer for NanoClaw's short-term memory
 * - container_logs: Execution logs from Docker sandbox runs
 *
 * Usage: npx ts-node System/init_db.ts
 * Idempotent: Safe to run multiple times.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.resolve(__dirname, "..", "Memory", "local_state.sqlite");

// Ensure the Memory directory exists
const memoryDir = path.dirname(DB_PATH);
if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
}

console.log(`[init_db] Initializing database at: ${DB_PATH}`);

const db = new Database(DB_PATH);

// Enable WAL mode for concurrent read/write safety
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// --- Table: active_context ---
// Short-term rolling memory buffer for NanoClaw.
// Stores recent conversation context to maintain continuity between
// throwaway Docker container spawns.
db.exec(`
  CREATE TABLE IF NOT EXISTS active_context (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
    role        TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content     TEXT NOT NULL,
    task_id     TEXT,
    token_count INTEGER DEFAULT 0
  );
`);

// --- Table: container_logs ---
// Execution audit trail. Every Docker container spawn and exit is logged here.
// Used by the WebSocket bridge (Phase 3) to stream logs to the dashboard.
db.exec(`
  CREATE TABLE IF NOT EXISTS container_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
    task_id     TEXT NOT NULL,
    container_id TEXT,
    connector   TEXT,
    action      TEXT,
    exit_code   INTEGER,
    duration_ms INTEGER,
    error_log   TEXT,
    metadata    TEXT DEFAULT '{}'
  );
`);

// --- Table: state_transitions ---
// Audit trail for all task state machine transitions.
// Every status change is recorded for debugging and accountability.
db.exec(`
  CREATE TABLE IF NOT EXISTS state_transitions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
    task_id     TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    actor       TEXT NOT NULL CHECK(actor IN ('nanoclaw', 'antigravity', 'human', 'system')),
    reason      TEXT
  );
`);

// Create indexes for common queries
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_context_task    ON active_context(task_id);
  CREATE INDEX IF NOT EXISTS idx_context_time    ON active_context(timestamp);
  CREATE INDEX IF NOT EXISTS idx_logs_task       ON container_logs(task_id);
  CREATE INDEX IF NOT EXISTS idx_logs_time       ON container_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_transitions_task ON state_transitions(task_id);
`);

// Verify tables were created
const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];

console.log(`[init_db] Created tables: ${tables.map((t) => t.name).join(", ")}`);
console.log(`[init_db] WAL mode: ${db.pragma("journal_mode", { simple: true })}`);
console.log("[init_db] ✅ Database initialized successfully.");

db.close();
