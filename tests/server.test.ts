import { describe, expect, test } from "bun:test";
import { createServer } from "../src/server.js";

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

  test("rejects explicitly empty keywords before collection", async () => {
    const app = createServer();
    const response = await app.handle(new Request("http://localhost/api/trends?words="));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("Invalid words");
  });
});
