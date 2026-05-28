import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { collectUnified } from "./runner.js";
import type { Options } from "./types.js";
import type { UnifiedMultiSourceOutput, UnifiedOutput } from "./unified-output.js";

export type TrendJobStatus = "queued" | "running" | "succeeded" | "failed";

export type TrendJob = {
  id: string;
  status: TrendJobStatus;
  queueKey: string;
  options: Options;
  result?: UnifiedOutput | UnifiedMultiSourceOutput;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

type TrendJobQueueOptions = {
  autoStart?: boolean;
  collect?: (options: Options) => Promise<UnifiedOutput | UnifiedMultiSourceOutput>;
};

type JobRow = {
  id: string;
  status: TrendJobStatus;
  queue_key: string;
  options_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export class TrendJobQueue {
  private readonly db: Database;
  private readonly autoStart: boolean;
  private readonly collect: (options: Options) => Promise<UnifiedOutput | UnifiedMultiSourceOutput>;
  private readonly runningKeys = new Set<string>();
  private drainPromise: Promise<void> | undefined;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(dbPath: string, options: TrendJobQueueOptions = {}) {
    this.autoStart = options.autoStart ?? true;
    this.collect = options.collect || collectUnified;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      create table if not exists trend_jobs (
        id text primary key,
        status text not null,
        queue_key text not null,
        options_json text not null,
        result_json text,
        error text,
        created_at text not null,
        updated_at text not null,
        started_at text,
        finished_at text
      );
      create index if not exists idx_trend_jobs_status_created
        on trend_jobs(status, created_at);
      create index if not exists idx_trend_jobs_queue_status_created
        on trend_jobs(queue_key, status, created_at);
    `);
    this.db.query("update trend_jobs set status = 'queued', started_at = null, updated_at = ? where status = 'running'")
      .run(new Date().toISOString());
    if (this.autoStart) this.wake();
  }

  enqueue(options: Options): TrendJob {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const queueKey = queueKeyForOptions(options);
    this.db.query(`
      insert into trend_jobs (id, status, queue_key, options_json, created_at, updated_at)
      values (?, 'queued', ?, ?, ?, ?)
    `).run(id, queueKey, JSON.stringify(options), now, now);
    if (this.autoStart) this.wake();
    return this.get(id)!;
  }

  get(id: string): TrendJob | undefined {
    const row = this.db.query("select * from trend_jobs where id = ?").get(id) as JobRow | null;
    return row ? rowToJob(row) : undefined;
  }

  list(limit = 50): TrendJob[] {
    const rows = this.db.query(`
      select * from trend_jobs
      order by created_at desc
      limit ?
    `).all(limit) as JobRow[];
    return rows.map(rowToJob);
  }

  async waitForCompletion(
    id: string,
    options: { pollIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<TrendJob | undefined> {
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const timeoutMs = options.timeoutMs ?? 0;
    const startedAt = Date.now();
    void this.drain();
    while (true) {
      const job = this.get(id);
      if (!job) return undefined;
      if (job.status === "succeeded" || job.status === "failed") return job;
      const elapsedMs = Date.now() - startedAt;
      if (timeoutMs > 0 && elapsedMs >= timeoutMs) return job;
      const sleepMs = timeoutMs > 0 ? Math.min(pollIntervalMs, Math.max(1, timeoutMs - elapsedMs)) : pollIntervalMs;
      await sleep(sleepMs);
    }
  }

  wake(): void {
    if (!this.autoStart) return;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      void this.drain();
    }, 0);
  }

  close(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.db.close();
  }

  async drain(): Promise<void> {
    if (!this.drainPromise) {
      this.drainPromise = this.drainLoop().finally(() => {
        this.drainPromise = undefined;
      });
    }
    return await this.drainPromise;
  }

  private async drainLoop(): Promise<void> {
    while (true) {
      const running = this.claimRunnableJobs().map((job) =>
        this.runJob(job).finally(() => {
          this.runningKeys.delete(job.queueKey);
        }));
      if (running.length === 0) return;
      await Promise.all(running);
    }
  }

  private claimRunnableJobs(): TrendJob[] {
    const jobs: TrendJob[] = [];
    while (true) {
      const job = this.claimNextJob();
      if (!job) return jobs;
      this.runningKeys.add(job.queueKey);
      jobs.push(job);
    }
  }

  private claimNextJob(): TrendJob | undefined {
    const row = this.db.transaction(() => {
      const queued = this.db.query(`
        select * from trend_jobs
        where status = 'queued'
        order by created_at asc
        limit 100
      `).all() as JobRow[];
      const next = queued.find((job) => !this.runningKeys.has(job.queue_key));
      if (!next) return undefined;
      const now = new Date().toISOString();
      this.db.query(`
        update trend_jobs
        set status = 'running', started_at = ?, updated_at = ?
        where id = ? and status = 'queued'
      `).run(now, now, next.id);
      return this.db.query("select * from trend_jobs where id = ?").get(next.id) as JobRow | null;
    })();
    return row ? rowToJob(row) : undefined;
  }

  private async runJob(job: TrendJob): Promise<void> {
    try {
      const result = await this.collect(job.options);
      const now = new Date().toISOString();
      this.db.query(`
        update trend_jobs
        set status = 'succeeded', result_json = ?, error = null, finished_at = ?, updated_at = ?
        where id = ?
      `).run(JSON.stringify(result), now, now, job.id);
    } catch (error) {
      const now = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.db.query(`
        update trend_jobs
        set status = 'failed', error = ?, finished_at = ?, updated_at = ?
        where id = ?
      `).run(message, now, now, job.id);
    }
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rowToJob(row: JobRow): TrendJob {
  return {
    id: row.id,
    status: row.status,
    queueKey: row.queue_key,
    options: JSON.parse(row.options_json) as Options,
    result: row.result_json ? JSON.parse(row.result_json) as UnifiedOutput | UnifiedMultiSourceOutput : undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || undefined,
    finishedAt: row.finished_at || undefined,
  };
}

function queueKeyForOptions(options: Options): string {
  if (options.source === "all") return `all:${options.profileDir}`;
  return `${options.source}:${options.profileDir}`;
}
