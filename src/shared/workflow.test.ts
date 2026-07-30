import { describe, expect, it } from "vitest";
import {
  calculateReviewSchedule,
  canUseGuidance,
  classifyResult,
  createAutomaticMemory,
  isRestrictedPracticeUrl,
  makeProblemKey,
  nextHandwritingGuidance,
  nextStage,
  normalizeNavigationUrl,
  shouldShowDiagnosis
} from "./workflow";

describe("workflow", () => {
  it("advances through the guidance stages", () => {
    expect(nextStage("understand")).toBe("method");
    expect(nextStage("review")).toBe("review");
  });

  it("continues handwriting hints instead of restarting the route", () => {
    expect(nextHandwritingGuidance(0)).toEqual({
      hintLevel: 1,
      stage: "implement"
    });
    expect(nextHandwritingGuidance(1)).toEqual({
      hintLevel: 2,
      stage: "implement"
    });
    expect(nextHandwritingGuidance(2)).toEqual({
      hintLevel: 3,
      stage: "diagnose"
    });
    expect(nextHandwritingGuidance(8)).toEqual({
      hintLevel: 8,
      stage: "diagnose"
    });
  });

  it("blocks assistance on contest and assessment routes", () => {
    expect(isRestrictedPracticeUrl("https://leetcode.com/contest/weekly-contest-1")).toBe(true);
    expect(isRestrictedPracticeUrl("https://leetcode.cn/assessment/demo")).toBe(true);
    expect(canUseGuidance("https://leetcode.cn/problems/synthetic-temperature-gap/")).toBe(true);
    expect(canUseGuidance("https://example.com/problems/demo")).toBe(false);
  });

  it("normalizes only supported navigation URLs", () => {
    expect(normalizeNavigationUrl("leetcode.cn/problemset/")).toBe(
      "https://leetcode.cn/problemset/"
    );
    expect(() => normalizeNavigationUrl("https://example.com")).toThrow();
  });

  it("creates a stable problem key without storing a statement", () => {
    expect(
      makeProblemKey({
        sourceUrl: "https://leetcode.cn/problems/synthetic-temperature-gap/",
        title: "相邻温差"
      })
    ).toBe("leetcode.cn:synthetic-temperature-gap");
  });

  it("classifies common failures conservatively", () => {
    expect(classifyResult("compile_error", "expected ';'")).toBe("syntax");
    expect(classifyResult("runtime_error", "IndexError: list index out of range")).toBe(
      "out_of_bounds"
    );
    expect(classifyResult("time_limit", "")).toBe("complexity");
    expect(classifyResult("accepted", "")).toBe("none");
  });

  it("shows diagnosis after repeated hints without progress", () => {
    expect(shouldShowDiagnosis(2, [], "return 0", "return 0")).toBe(true);
    expect(shouldShowDiagnosis(1, [], "return 0", "return 0")).toBe(false);
  });

  it("schedules review from one to thirty days", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(calculateReviewSchedule("forgot", 4, now).reviewDueAt).toBe(
      "2026-01-02T00:00:00.000Z"
    );
    expect(calculateReviewSchedule("remembered", 3, now).reviewDueAt).toBe(
      "2026-01-31T00:00:00.000Z"
    );
    expect(calculateReviewSchedule("remembered", 0, now).reviewDueAt).toBe(
      "2026-01-08T00:00:00.000Z"
    );
  });

  it("builds review memory from recorded blockers without calling a model", () => {
    const draft = {
      sourceUrl: "https://leetcode.cn/problems/synthetic-temperature-gap/",
      title: "相邻温差",
      statement: "合成题目",
      language: "python" as const,
      code: "return best",
      latestResult: "Accepted"
    };
    const memory = createAutomaticMemory(
      draft,
      [
        {
          id: "one",
          problemKey: "leetcode.cn:synthetic-temperature-gap",
          trigger: "run",
          status: "runtime_error",
          errorCategory: "out_of_bounds",
          code: "values[i + 1]",
          resultText: "IndexError",
          stage: "implement",
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "two",
          problemKey: "leetcode.cn:synthetic-temperature-gap",
          trigger: "submit",
          status: "accepted",
          errorCategory: "none",
          code: "return best",
          resultText: "Accepted",
          stage: "implement",
          createdAt: "2026-01-01T00:01:00.000Z"
        }
      ],
      "一次遍历"
    );
    expect(memory.methodName).toBe("一次遍历");
    expect(memory.actualBlockers).toContain("下标越界");
    expect(memory.edgeCases).toContain("曾出现下标越界");
  });
});
