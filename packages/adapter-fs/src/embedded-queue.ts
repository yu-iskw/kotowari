import type { Queue, QueuedJob } from '@kotowari/plugin-sdk';

class EmbeddedQueue implements Queue {
  private jobs: QueuedJob[] = [];

  async enqueue(job: QueuedJob): Promise<void> {
    this.jobs.push(job);
  }

  async drain(): Promise<readonly QueuedJob[]> {
    const copy = [...this.jobs];
    this.jobs = [];
    return copy;
  }

  async listPending(): Promise<readonly QueuedJob[]> {
    return [...this.jobs];
  }
}

export function createEmbeddedQueue(): Queue {
  return new EmbeddedQueue();
}
