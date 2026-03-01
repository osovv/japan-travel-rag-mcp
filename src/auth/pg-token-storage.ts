// FILE: src/auth/pg-token-storage.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: PostgreSQL-backed TokenStorage implementation for persistent OAuth session state across redeploys.
//   SCOPE: Implements fastmcp TokenStorage interface (save/get/delete/cleanup) using oauth_token_store table via Drizzle raw SQL.
//   DEPENDS: M-DB, M-LOGGER
//   LINKS: M-AUTH-PG-TOKEN-STORAGE, M-DB, M-AUTH-PROXY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   PostgresTokenStorage - TokenStorage implementation backed by oauth_token_store PostgreSQL table.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial implementation of PostgreSQL-backed token storage.
// END_CHANGE_SUMMARY

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { TokenStorage } from "fastmcp/auth";
import type { Logger } from "../logger/index";

export class PostgresTokenStorage implements TokenStorage {
  private db: NodePgDatabase;
  private logger: Logger;

  constructor(db: NodePgDatabase, logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  async save(key: string, value: unknown, ttl?: number): Promise<void> {
    const expiresAt =
      ttl != null
        ? sql`NOW() + ${ttl}::integer * INTERVAL '1 second'`
        : sql`NULL`;

    await this.db.execute(sql`
      INSERT INTO oauth_token_store (key, value, expires_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${expiresAt})
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        expires_at = EXCLUDED.expires_at
    `);
  }

  async get(key: string): Promise<null | unknown> {
    const result = await this.db.execute(sql`
      SELECT value FROM oauth_token_store
      WHERE key = ${key}
        AND (expires_at IS NULL OR expires_at > NOW())
    `);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return (row as { value: unknown }).value;
  }

  async delete(key: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM oauth_token_store WHERE key = ${key}
    `);
  }

  async cleanup(): Promise<void> {
    const result = await this.db.execute(sql`
      DELETE FROM oauth_token_store
      WHERE expires_at IS NOT NULL AND expires_at <= NOW()
    `);

    const count = result.rowCount ?? 0;
    if (count > 0) {
      this.logger.info(
        `Cleaned up ${count} expired OAuth token entries.`,
        "PostgresTokenStorage.cleanup",
        "CLEANUP_EXPIRED_TOKENS",
      );
    }
  }
}
