import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TrendJobQueue } from "../src/job-queue.js";
import { createServer, createServerWithQueue } from "../src/server.js";
import type { Options } from "../src/types.js";

describe("HTTP API", () => {
  test("serves an example client page", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("OhMyTrends API Example");
    expect(html).toContain("/api/trends?");
    expect(html).toContain('data-code-tab="curl"');
    expect(html).toContain('data-code-tab="typescript"');
    expect(html).toContain('data-code-tab="python"');
    expect(html).toContain('data-code-tab="go"');
    expect(html).toContain("navigator.language");
    expect(html).toContain("关键词");
    expect(html).toContain('id="language-toggle"');
    expect(html).toContain('id="workspace"');
    expect(html).toContain('id="response-drawer"');
    expect(html).toContain('id="meta-query-id"');
    expect(html).toContain('id="meta-poll-url"');
    expect(html).toContain("function pollQuery");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_0fr]");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(html).toContain("function openDrawer()");
  });

  test("returns health status", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "ohmytrends",
    });
  });

  test("validates request parameters before collection", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/api/trends?source=google&range=today%2012-m"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("Invalid --range");
  });

  test("validates Baidu collection mode before collection", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/api/trends?source=baidu&baiduMode=fast"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("Invalid --baidu-mode");
  });

  test("accepts log path before collection", async () => {
    const app = createServer();
    const response = await app.handle(new Request(
      "http://localhost/api/trends?source=baidu&log=logs/api-events.jsonl&baiduMode=fast",
    ));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("Invalid --baidu-mode");
  });

  test("rejects explicitly empty keywords before collection", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/api/trends?words="));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("Invalid words");
  });

  test("validates wait parameter before collection", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt&wait=maybe"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("Invalid wait");
  });

  test("validates wait timeout before collection", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt&wait=true&waitTimeoutMs=-1"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("Invalid waitTimeoutMs");
  });

  test("keeps the legacy jobs path as a compatibility alias", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-queue-"));
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      collect: async (options: Options) => ({
        schemaVersion: 1,
        source: options.source,
        status: "ok",
        capturedAt: "2026-05-27T00:00:00.000Z",
        query: {
          keywords: options.words,
          range: options.rangeLabel || null,
          startDate: options.startDate || null,
          endDate: options.endDate || null,
          region: options.geo || options.area || null,
        },
        results: [],
        messages: [],
        sourceMeta: {},
      }),
    });
    const app = createServerWithQueue([], queue);

    const createdResponse = await app.handle(new Request("http://localhost/api/trends/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "google", words: "gpt", range: "30d" }),
    }));
    expect(createdResponse.status).toBe(202);
    const created = await createdResponse.json() as { id: string; queryId: string; status: string; words: string[] };
    expect(created.status).toBe("queued");
    expect(created.queryId).toBe(created.id);
    expect(created.words).toEqual(["gpt"]);

    await queue.drain();

    const jobResponse = await app.handle(new Request(`http://localhost/api/trends/jobs/${created.id}`));
    expect(jobResponse.status).toBe(200);
    const job = await jobResponse.json() as { status: string; result?: { status: string } };
    expect(job.status).toBe("succeeded");
    expect(job.result?.status).toBe("ok");

    const listResponse = await app.handle(new Request("http://localhost/api/trends/jobs"));
    const list = await listResponse.json() as { jobs: { id: string }[] };
    expect(list.jobs.map((item) => item.id)).toContain(created.id);
  });

  test("creates a query id for direct trend requests by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-queue-direct-"));
    let calls = 0;
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      autoStart: false,
      collect: async (options: Options) => {
        calls += 1;
        return {
          schemaVersion: 1,
          source: options.source,
          status: "ok",
          capturedAt: "2026-05-27T00:00:00.000Z",
          query: {
            keywords: options.words,
            range: options.rangeLabel || null,
            startDate: options.startDate || null,
            endDate: options.endDate || null,
            region: options.geo || options.area || null,
          },
          results: [],
          messages: [],
          sourceMeta: {},
        };
      },
    });
    const app = createServerWithQueue([], queue);

    const response = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt&range=30d"));
    expect(response.status).toBe(202);
    const body = await response.json() as { id: string; queryId: string; status: string; source: string; pollUrl: string };
    expect(body.status).toBe("queued");
    expect(body.queryId).toBe(body.id);
    expect(body.source).toBe("google");
    expect(body.pollUrl).toBe(`/api/trends/${body.id}`);
    expect(body).not.toHaveProperty("queueKey");
    expect(calls).toBe(0);

    await queue.drain();

    const pollResponse = await app.handle(new Request(`http://localhost${body.pollUrl}`));
    expect(pollResponse.status).toBe(200);
    const polled = await pollResponse.json() as { status: string; result?: { status: string; source: string } };
    expect(polled.status).toBe("succeeded");
    expect(polled.result?.status).toBe("ok");
    expect(polled.result?.source).toBe("google");
    expect(calls).toBe(1);
  });

  test("can disable queueing for direct trend requests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-queue-off-"));
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      collect: async () => {
        throw new Error("queue should not run");
      },
    });
    const app = createServerWithQueue([], queue, {
      queueEnabled: false,
    });

    const response = await app.handle(new Request("http://localhost/api/trends?source=google&range=today%2012-m"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("Invalid --range");
    expect(queue.list()).toHaveLength(0);
  });

  test("waits for completion on the main trend endpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-wait-"));
    let calls = 0;
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      autoStart: false,
      collect: async (options: Options) => {
        calls += 1;
        return {
          schemaVersion: 1,
          source: options.source,
          status: "ok",
          capturedAt: "2026-05-27T00:00:00.000Z",
          query: {
            keywords: options.words,
            range: options.rangeLabel || null,
            startDate: options.startDate || null,
            endDate: options.endDate || null,
            region: options.geo || options.area || null,
          },
          results: [],
          messages: [],
          sourceMeta: {},
        };
      },
    });
    const app = createServerWithQueue([], queue);

    const response = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt&wait=true"));
    expect(response.status).toBe(200);
    const body = await response.json() as { id: string; status: string; result?: { status: string } };
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("succeeded");
    expect(body.result?.status).toBe("ok");
    expect(calls).toBe(1);
    expect(queue.list()).toHaveLength(1);
  });

  test("waited trend requests report collection failures as server errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-wait-fail-"));
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      autoStart: false,
      collect: async () => {
        throw new Error("collection failed");
      },
    });
    const app = createServerWithQueue([], queue);

    const response = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt&wait=true"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.status).toBe("failed");
    expect(body.error).toContain("collection failed");
    expect(queue.list()).toHaveLength(1);
  });

  test("returns the current job status when wait timeout expires", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-wait-timeout-"));
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      autoStart: false,
      collect: async (options: Options) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          schemaVersion: 1,
          source: options.source,
          status: "ok",
          capturedAt: "2026-05-27T00:00:00.000Z",
          query: {
            keywords: options.words,
            range: options.rangeLabel || null,
            startDate: options.startDate || null,
            endDate: options.endDate || null,
            region: options.geo || options.area || null,
          },
          results: [],
          messages: [],
          sourceMeta: {},
        };
      },
    });
    const app = createServerWithQueue([], queue);

    const response = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt&wait=true&waitTimeoutMs=1"));
    expect(response.status).toBe(202);
    const body = await response.json() as { status: string; pollUrl: string };
    expect(["queued", "running"]).toContain(body.status);
    expect(body.pollUrl).toBeTruthy();

    await queue.drain();
    queue.close();
  });

  test("keeps the explicit synchronous endpoint as a compatibility alias", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-sync-alias-"));
    let calls = 0;
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      autoStart: false,
      collect: async (options: Options) => {
        calls += 1;
        return {
          schemaVersion: 1,
          source: options.source,
          status: "ok",
          capturedAt: "2026-05-27T00:00:00.000Z",
          query: {
            keywords: options.words,
            range: options.rangeLabel || null,
            startDate: options.startDate || null,
            endDate: options.endDate || null,
            region: options.geo || options.area || null,
          },
          results: [],
          messages: [],
          sourceMeta: {},
        };
      },
    });
    const app = createServerWithQueue([], queue);

    const response = await app.handle(new Request("http://localhost/api/trends/sync?source=google&words=gpt"));
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; result?: { status: string } };
    expect(body.status).toBe("succeeded");
    expect(body.result?.status).toBe("ok");
    expect(calls).toBe(1);
  });

  test("returns an error HTTP status when polling a failed query", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-failed-"));
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      autoStart: false,
      collect: async () => {
        throw new Error("collection failed");
      },
    });
    const app = createServerWithQueue([], queue);

    const createdResponse = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt"));
    const created = await createdResponse.json() as { pollUrl: string };
    await queue.drain();

    const pollResponse = await app.handle(new Request(`http://localhost${created.pollUrl}`));
    expect(pollResponse.status).toBe(500);
    const failed = await pollResponse.json() as { status: string; error?: string };
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("collection failed");
  });

  test("persists queued results across server restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-restart-"));
    const dbPath = join(dir, "queue.sqlite");
    const firstQueue = new TrendJobQueue(dbPath, { autoStart: false });
    const firstApp = createServerWithQueue([], firstQueue);

    const createdResponse = await firstApp.handle(new Request("http://localhost/api/trends?source=google&words=gpt"));
    expect(createdResponse.status).toBe(202);
    const created = await createdResponse.json() as { id: string; pollUrl: string };
    firstQueue.close();

    const secondQueue = new TrendJobQueue(dbPath, {
      autoStart: false,
      collect: async (options: Options) => ({
        schemaVersion: 1,
        source: options.source,
        status: "ok",
        capturedAt: "2026-05-27T00:00:00.000Z",
        query: {
          keywords: options.words,
          range: options.rangeLabel || null,
          startDate: options.startDate || null,
          endDate: options.endDate || null,
          region: options.geo || options.area || null,
        },
        results: [],
        messages: ["resumed after restart"],
        sourceMeta: {},
      }),
    });
    const secondApp = createServerWithQueue([], secondQueue);
    await secondQueue.drain();

    const polledResponse = await secondApp.handle(new Request(`http://localhost${created.pollUrl}`));
    expect(polledResponse.status).toBe(200);
    const polled = await polledResponse.json() as { id: string; status: string; result?: { status: string; messages: string[] } };
    expect(polled.id).toBe(created.id);
    expect(polled.status).toBe("succeeded");
    expect(polled.result?.status).toBe("ok");
    expect(polled.result?.messages).toContain("resumed after restart");
    secondQueue.close();

    const thirdQueue = new TrendJobQueue(dbPath, { autoStart: false });
    const thirdApp = createServerWithQueue([], thirdQueue);
    const persistedResponse = await thirdApp.handle(new Request(`http://localhost${created.pollUrl}`));
    expect(persistedResponse.status).toBe(200);
    const persisted = await persistedResponse.json() as { id: string; status: string; result?: { messages: string[] } };
    expect(persisted.id).toBe(created.id);
    expect(persisted.status).toBe("succeeded");
    expect(persisted.result?.messages).toContain("resumed after restart");
    thirdQueue.close();
  });

  test("serializes jobs for the same source and profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-serial-"));
    let active = 0;
    let maxActive = 0;
    const queue = new TrendJobQueue(join(dir, "queue.sqlite"), {
      autoStart: false,
      collect: async (options: Options) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return {
          schemaVersion: 1,
          source: options.source,
          status: "ok",
          capturedAt: "2026-05-27T00:00:00.000Z",
          query: {
            keywords: options.words,
            range: options.rangeLabel || null,
            startDate: options.startDate || null,
            endDate: options.endDate || null,
            region: options.geo || options.area || null,
          },
          results: [],
          messages: [],
          sourceMeta: {},
        };
      },
    });
    const app = createServerWithQueue([], queue);

    await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt"));
    await app.handle(new Request("http://localhost/api/trends?source=google&words=claude"));
    await queue.drain();

    expect(maxActive).toBe(1);
    expect(queue.list().map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
    queue.close();
  });

  test("requeues running jobs when the server restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ohmytrends-running-restart-"));
    const dbPath = join(dir, "queue.sqlite");
    const queue = new TrendJobQueue(dbPath, { autoStart: false });
    const app = createServerWithQueue([], queue);

    const createdResponse = await app.handle(new Request("http://localhost/api/trends?source=google&words=gpt"));
    const created = await createdResponse.json() as { id: string };
    queue.close();

    const db = new Database(dbPath);
    db.query("update trend_jobs set status = 'running', started_at = ?, updated_at = ? where id = ?")
      .run("2026-05-27T00:00:00.000Z", "2026-05-27T00:00:00.000Z", created.id);
    db.close();

    const restartedQueue = new TrendJobQueue(dbPath, { autoStart: false });
    const restored = restartedQueue.get(created.id);
    expect(restored?.status).toBe("queued");
    expect(restored?.startedAt).toBeUndefined();
    restartedQueue.close();
  });
});
