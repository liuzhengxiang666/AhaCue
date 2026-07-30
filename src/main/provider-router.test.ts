import { describe, expect, it } from "vitest";
import type { GuidanceRequest } from "../shared/contracts";
import {
  buildGuidancePrompt,
  normalizeGuidanceCard
} from "./provider-router";

function request(
  stage: GuidanceRequest["stage"],
  overrides: Partial<GuidanceRequest> = {}
): GuidanceRequest {
  return {
    requestId: `request-${stage}`,
    draft: {
      sourceUrl: "https://example.invalid/problems/synthetic-two-sum",
      title: "合成测试题",
      statement: "给定一个整数数组，返回满足条件的两个位置。",
      language: "cpp",
      code: "class Solution { /* secret-current-code */ };",
      latestResult: "secret-runtime-result"
    },
    stage,
    mode: "guided",
    hintLevel: 0,
    allowSnippet: false,
    allowSolution: false,
    ...overrides
  };
}

describe("compact guidance protocol", () => {
  it("将冗长题意和方法强制压缩为联合卡片", () => {
    const card = normalizeGuidanceCard(
      {
        type: "understand",
        summary:
          "这是一段非常长的题意说明，它本来会继续解释大量背景知识和没有必要的算法定义。".repeat(
            4
          ),
        edgeCases: "不能重复使用同一个元素，而且还有很多不应在首屏出现的解释。",
        methods: [
          {
            id: 1,
            name: "哈希表查找并维护补数的详细方法名称",
            description:
              "一边遍历一边查询目标差值，同时继续解释很多不需要在方法列表显示的原理。",
            complexity: "时间 O(n)，空间 O(n)，以及一段多余说明",
            recommended: true
          },
          {
            id: 2,
            name: "排序双指针",
            action: "排序后从两端收缩",
            complexity: "O(n log n)",
            recommended: true
          }
        ],
        snippet: "不应泄露",
        code: "不应泄露"
      },
      "",
      request("understand")
    );

    expect(card.type).toBe("guided_start");
    if (card.type !== "guided_start") throw new Error("unexpected card");
    expect(Array.from(card.understanding).length).toBeLessThanOrEqual(70);
    expect(Array.from(card.caution ?? "").length).toBeLessThanOrEqual(40);
    expect(card.methods).toHaveLength(2);
    expect(card.methods.filter((method) => method.recommended)).toHaveLength(1);
    expect(Array.from(card.methods[0].action).length).toBeLessThanOrEqual(36);
    expect("code" in card).toBe(false);
  });

  it("题意提示不携带当前代码和运行结果", () => {
    const prompt = buildGuidancePrompt(request("understand"));

    expect(prompt.maxTokens).toBe(520);
    expect(prompt.user).not.toContain("secret-current-code");
    expect(prompt.user).not.toContain("secret-runtime-result");
  });

  it("伪代码只携带题面、语言和所选方法", () => {
    const prompt = buildGuidancePrompt(
      request("pseudocode", { selectedMethod: "哈希表", allowSnippet: true })
    );

    expect(prompt.user).toContain("所选方法：哈希表");
    expect(prompt.user).not.toContain("secret-current-code");
    expect(prompt.user).not.toContain("secret-runtime-result");
  });

  it("诊断优先携带当前代码和错误", () => {
    const prompt = buildGuidancePrompt(request("diagnose"));

    expect(prompt.maxTokens).toBe(320);
    expect(prompt.user).toContain("secret-current-code");
    expect(prompt.user).toContain("secret-runtime-result");
  });

  it("非答案阶段丢弃完整代码，只保留允许的局部片段", () => {
    const card = normalizeGuidanceCard(
      {
        summary: "补上哈希表查询",
        reason: "需要先判断差值是否存在",
        apiNotes: "unordered_map::find",
        snippet: "auto it = seen.find(need);",
        code: "int main() { return 0; }"
      },
      "",
      request("implement", { allowSnippet: true })
    );

    expect(card.type).toBe("hint");
    if (card.type !== "hint") throw new Error("unexpected card");
    expect(card.snippet).toBe("auto it = seen.find(need);");
    expect("code" in card).toBe(false);
  });
});
