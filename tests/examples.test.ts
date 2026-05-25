import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("examples", () => {
  test("use the unified JSON output shape", () => {
    for (const file of ["examples/google-output.json", "examples/baidu-output.json"]) {
      const example = JSON.parse(readFileSync(file, "utf8"));
      expect(example.schemaVersion).toBe(1);
      expect(example.query.range).toBe("30d");
      expect(example.query).not.toHaveProperty("period");
      expect(Array.isArray(example.results)).toBe(true);
      expect(example.sourceMeta.apiUrls).toBeDefined();
    }
  });

  test("publishes JSON output docs and schema", () => {
    expect(existsSync("docs/json-output.md")).toBe(true);
    expect(existsSync("docs/json-output.zh-CN.md")).toBe(true);
    const schema = JSON.parse(readFileSync("schemas/unified-output.schema.json", "utf8"));
    expect(schema.title).toBe("ohmytrends unified JSON output");
    expect(schema.oneOf).toHaveLength(2);
  });
});
