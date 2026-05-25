import { describe, expect, test } from "bun:test";
import { createLoginModel, loginOptionsFromArgs } from "../src/login-prompts.js";

describe("login prompt helpers", () => {
  test("defaults login to sequential Baidu and Google profiles", () => {
    const options = loginOptionsFromArgs([]);

    expect(options.map((item) => [item.source, item.profileDir])).toEqual([
      ["baidu", "profiles/baidu"],
      ["google", "profiles/google"],
    ]);
  });

  test("uses custom profile root for both services", () => {
    const options = loginOptionsFromArgs(["--profile-dir", "tmp/profiles"]);

    expect(options.map((item) => [item.source, item.profileDir])).toEqual([
      ["baidu", "tmp/profiles/baidu"],
      ["google", "tmp/profiles/google"],
    ]);
  });

  test("respects explicit source", () => {
    const options = loginOptionsFromArgs(["--source", "google"]);

    expect(options).toHaveLength(1);
    expect(options[0]?.source).toBe("google");
    expect(options[0]?.profileDir).toBe("profiles/google");
  });

  test("carries terminal language into login model", () => {
    const model = createLoginModel(["--source", "baidu", "--lang", "en"]);

    expect(model.items[0]?.message).toBe("Waiting for login");
    expect(model.items[0]?.options.lang).toBe("en");
  });

  test("creates a quiet status model for prompt rendering", () => {
    const model = createLoginModel(["--source", "baidu"]);

    expect(model.items).toHaveLength(1);
    expect(model.items[0]?.state).toBe("pending");
    expect(model.items[0]?.options.quietStatus).toBe(true);
  });
});
