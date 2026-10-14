import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDb(dir = process.env.DATA_DIR || path.resolve('data')) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dir === ':memory:' ? ':memory:' : path.join(dir, 'portfolio.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS clients (
      id          INTEGER PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      accent      TEXT NOT NULL DEFAULT '#c8a45c',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      published   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS videos (
      id          INTEGER PRIMARY KEY,
      client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      filename    TEXT NOT NULL,
      mime        TEXT NOT NULL,
      size        INTEGER NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_videos_client ON videos(client_id);

    -- Subscription packages (not exposed in the UI yet; schema is ready).
    CREATE TABLE IF NOT EXISTS plans (
      id            INTEGER PRIMARY KEY,
      code          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      price_cents   INTEGER NOT NULL DEFAULT 0,
      currency      TEXT NOT NULL DEFAULT 'USD',
      interval      TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year','once')),
      max_videos    INTEGER,            -- NULL = unlimited
      features_json TEXT NOT NULL DEFAULT '[]',
      active        INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id         INTEGER PRIMARY KEY,
      client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      plan_id    INTEGER NOT NULL REFERENCES plans(id),
      status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','expired')),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_subs_client ON subscriptions(client_id);
  `);
  return db;
}
