import { PGlite } from '@electric-sql/pglite';
import { Pool, type PoolClient } from 'pg';

export type SqlClient = {
  exec(sql: string): Promise<void>;
  query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
};

function asRows<T extends Record<string, unknown>>(rows: unknown): T[] {
  return rows as T[];
}

class PgliteSqlClient implements SqlClient {
  private inTransaction = false;

  constructor(private readonly db: PGlite) {}

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    const result =
      params === undefined ? await this.db.query<T>(sql) : await this.db.query<T>(sql, [...params]);
    return result.rows;
  }

  async withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return fn(this);
    }
    this.inTransaction = true;
    try {
      await this.exec('BEGIN');
      try {
        const result = await fn(this);
        await this.exec('COMMIT');
        return result;
      } catch (error) {
        await this.exec('ROLLBACK');
        throw error;
      }
    } finally {
      this.inTransaction = false;
    }
  }
}

class PgBoundSqlClient implements SqlClient {
  constructor(private readonly client: PoolClient) {}

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    const result =
      params === undefined
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);
    return asRows<T>(result.rows);
  }

  async withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

class PgPoolSqlClient implements SqlClient {
  constructor(private readonly pool: Pool) {}

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    const result =
      params === undefined ? await this.pool.query(sql) : await this.pool.query(sql, [...params]);
    return asRows<T>(result.rows);
  }

  async withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new PgBoundSqlClient(client);
    try {
      await client.query('BEGIN');
      try {
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }
}

export async function createPgliteClient(): Promise<SqlClient> {
  const db = new PGlite();
  await db.waitReady;
  return new PgliteSqlClient(db);
}

export function createPgPoolClient(connectionString: string): SqlClient {
  return new PgPoolSqlClient(new Pool({ connectionString }));
}
