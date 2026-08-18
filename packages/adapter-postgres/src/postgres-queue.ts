import type { SqlClient } from './sql-client.js';
import type { Queue, QueuedJob } from '@kotowari/plugin-sdk';

const QUEUE_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);
`;

type JobRow = { id: string | number | bigint; kind: string; payload: string };

function jobsFromRows(rows: readonly JobRow[]): QueuedJob[] {
  return rows.map((row) => ({
    kind: row.kind,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }));
}

class PostgresQueue implements Queue {
  private readonly ready: Promise<void>;

  constructor(private readonly sql: SqlClient) {
    this.ready = this.sql.exec(QUEUE_SCHEMA);
  }

  async enqueue(job: QueuedJob): Promise<void> {
    await this.ready;
    await this.sql.query('INSERT INTO jobs (kind, payload) VALUES ($1, $2)', [
      job.kind,
      JSON.stringify(job.payload),
    ]);
  }

  async listPending(): Promise<readonly QueuedJob[]> {
    await this.ready;
    const rows = await this.sql.query<JobRow>('SELECT id, kind, payload FROM jobs ORDER BY id');
    return jobsFromRows(rows);
  }

  async drain(): Promise<readonly QueuedJob[]> {
    await this.ready;
    return this.sql.withTransaction(async (tx) => {
      const rows = await tx.query<JobRow>('SELECT id, kind, payload FROM jobs ORDER BY id');
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
      await tx.query(`DELETE FROM jobs WHERE id IN (${placeholders})`, ids);
      return jobsFromRows(rows);
    });
  }
}

export function createPostgresQueue(client: SqlClient): Queue {
  return new PostgresQueue(client);
}
