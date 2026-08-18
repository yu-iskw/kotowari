import type { Queue } from '@kotowari/plugin-sdk';

type Job = { kind: string; payload: Record<string, unknown> };

class EmbeddedQueue implements Queue {
  private jobs: Job[] = [];

  async enqueue(job: Job): Promise<void> {
    this.jobs.push(job);
  }

  async drain(): Promise<readonly Job[]> {
    const copy = [...this.jobs];
    this.jobs = [];
    return copy;
  }
}

export function createEmbeddedQueue(): Queue {
  return new EmbeddedQueue();
}
