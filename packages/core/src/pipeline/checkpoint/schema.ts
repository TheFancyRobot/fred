/**
 * SQL schema definitions for checkpoint storage adapters.
 *
 * Provides DDL strings for both Postgres and SQLite that define the
 * checkpoints table with proper indexing for query performance.
 */

// -----------------------------------------------------------------------------
// SQLite Schema DDL
// -----------------------------------------------------------------------------

/**
 * SQLite DDL for the checkpoints table.
 * Uses TEXT for JSON storage and timestamps (ISO 8601 strings).
 * Composite primary key on (run_id, step) for checkpoint ordering.
 */
export const SQLITE_CHECKPOINTS_DDL = `
CREATE TABLE IF NOT EXISTS checkpoints (
  run_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  status TEXT NOT NULL,
  context TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  step_name TEXT,
  pause_metadata TEXT,
  PRIMARY KEY (run_id, step)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints (run_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_pipeline_id ON checkpoints (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON checkpoints (status);
CREATE INDEX IF NOT EXISTS idx_checkpoints_expires_at ON checkpoints (expires_at);
`;
