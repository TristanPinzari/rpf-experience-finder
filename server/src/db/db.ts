import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "../config.js";

// One SQLite file holds everything:
//   projects    - the structured catalog, one row per project (filterable columns + full JSON)
//   documents   - every source file, with a content hash for change detection
//   chunks      - document pieces with their embedding vectors (for semantic search)
//   chunks_fts  - full-text index over the same chunks (for keyword search)
// In production this maps to Azure AI Search, which does filters, keyword and vector search in one service.

export const DB_PATH = path.join(DATA_DIR, "rfp.db");

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id               TEXT PRIMARY KEY,
      folder           TEXT NOT NULL UNIQUE,
      name             TEXT,
      client           TEXT,
      client_type      TEXT,
      sector           TEXT,
      location         TEXT,
      original_value   REAL,
      final_value      REAL,
      start_date       TEXT,
      completion_date  TEXT,
      delivery_method  TEXT,
      needs_review     INTEGER NOT NULL DEFAULT 0,
      record_json      TEXT NOT NULL,
      extracted_at     TEXT NOT NULL,
      model            TEXT
    );

    CREATE TABLE IF NOT EXISTS documents (
      id          INTEGER PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      sha256      TEXT NOT NULL,
      text        TEXT NOT NULL,
      UNIQUE (project_id, filename)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id           INTEGER PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      idx          INTEGER NOT NULL,
      text         TEXT NOT NULL,
      embedding    BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_project ON chunks(project_id);

    -- rowid = chunks.id. Indexed text includes project name and filename so
    -- keyword search can match on them too.
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize = 'porter unicode61');
  `);
  return db;
}

export function vectorToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

export function blobToVector(b: Uint8Array): Float32Array {
  // Copy so the vector is aligned and independent of SQLite's buffer.
  return new Float32Array(Uint8Array.from(b).buffer);
}
