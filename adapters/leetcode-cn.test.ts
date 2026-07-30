import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface IntegratedAdapter {
  id: string;
  mode: "automatic";
  supports(url: string): boolean;
  install: (...args: unknown[]) => Promise<unknown>;
  readContext: (...args: unknown[]) => Promise<unknown>;
  readAttempt: (...args: unknown[]) => Promise<unknown>;
  insertSnippet: (...args: unknown[]) => Promise<unknown>;
  replaceCode: (...args: unknown[]) => Promise<unknown>;
}

const require = createRequire(import.meta.url);
const adapter = require("./leetcode-cn.cjs") as IntegratedAdapter;

describe("integrated visible-page adapter", () => {
  it("supports only ordinary leetcode.cn problem pages", () => {
    expect(
      adapter.supports("https://leetcode.cn/problems/synthetic-example/")
    ).toBe(true);
    expect(adapter.supports("https://leetcode.cn/problemset/")).toBe(false);
    expect(adapter.supports("https://leetcode.cn/contest/weekly-1/")).toBe(
      false
    );
    expect(
      adapter.supports("https://leetcode.com/problems/synthetic-example/")
    ).toBe(false);
  });

  it("exposes the complete page integration contract", () => {
    expect(adapter.id).toBe("leetcode-cn-visible-page-v1");
    expect(adapter.mode).toBe("automatic");
    for (const method of [
      "install",
      "readContext",
      "readAttempt",
      "insertSnippet",
      "replaceCode"
    ] as const) {
      expect(adapter[method]).toBeTypeOf("function");
    }
  });
});
