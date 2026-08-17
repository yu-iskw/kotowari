import type { SqlClient } from './sql-client.js';
import type { Queue } from '@kotowari/plugin-sdk';

const QUEUE_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);
`;

type Job = { kind: string; payload: Record<string, unknown> };
type JobRow = { id: string | number | bigint; kind: string; payload: string };

class PostgresQueue implements Queue {
  private readonly ready: Promise<void>;

  constructor(private readonly sql: SqlClient) {
    this.ready = this.sql.exec(QUEUE_SCHEMA);
  }

  async enqueue(job: Job): Promise<void> {
    await this.ready;
    await this.sql.query('INSERT INTO jobs (kind, payload) VALUES ($1, $2)', [
      job.kind,
      JSON.stringify(job.payload),
    ]);
  }

  async drain(): Promise<readonly Job[]> {
    await this.ready;
    return this.sql.withTransaction(async (tx) => {
      const rows = await tx.query<JobRow>('SELECT id, kind, payload FROM jobs ORDER BY id');
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
      await tx.query(`DELETE FROM jobs WHERE id IN (${placeholders})`, ids);
      return rows.map((row) => ({
        kind: row.kind,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
      }));
    });
  }
}

export function createPostgresQueue(client: SqlClient): Queue {
  return new PostgresQueue(client);
}
