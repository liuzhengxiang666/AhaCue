import type {
  AttemptRecord,
  AttemptStatus,
  ErrorCategory,
  GuidanceStage,
  MemoryInput,
  ProblemDraft,
  ReviewRating
} from "./contracts";
import { guidanceStages } from "./contracts";

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;

export function nextStage(stage: GuidanceStage): GuidanceStage {
  const index = guidanceStages.indexOf(stage);
  return guidanceStages[Math.min(index + 1, guidanceStages.length - 1)];
}

export function previousStage(stage: GuidanceStage): GuidanceStage {
  const index = guidanceStages.indexOf(stage);
  return guidanceStages[Math.max(index - 1, 0)];
}

export function nextHandwritingGuidance(hintLevel: number): {
  hintLevel: number;
  stage: "implement" | "diagnose";
} {
  const nextHintLevel = Math.min(8, Math.max(0, hintLevel) + 1);
  return {
    hintLevel: nextHintLevel,
    stage: nextHintLevel >= 3 ? "diagnose" : "implement"
  };
}

export function isSupportedPracticeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return (
      url.hostname === "leetcode.com" ||
      url.hostname.endsWith(".leetcode.com") ||
      url.hostname === "leetcode.cn" ||
      url.hostname.endsWith(".leetcode.cn")
    );
  } catch {
    return false;
  }
}

export function isRestrictedPracticeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const target = `${url.pathname}${url.search}`.toLowerCase();
    return [
      "/contest",
      "/assessment",
      "/interview",
      "/exam",
      "online-assessment"
    ].some((segment) => target.includes(segment));
  } catch {
    return false;
  }
}

export function normalizeNavigationUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  if (!value) return "https://leetcode.cn/problemset/";
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (!isSupportedPracticeUrl(url.toString())) {
    throw new Error("公开版浏览区只允许访问 leetcode.cn 与 leetcode.com。");
  }
  return url.toString();
}

export function makeProblemKey(draft: Pick<ProblemDraft, "sourceUrl" | "title">): string {
  try {
    const url = new URL(draft.sourceUrl);
    const slugMatch = url.pathname.match(/\/problems\/([^/]+)/i);
    if (slugMatch?.[1]) {
      return `${url.hostname}:${slugMatch[1].toLowerCase()}`;
    }
  } catch {
    // Manual entries may not have a valid source URL.
  }
  const normalized = draft.title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return `manual:${normalized || "untitled"}`;
}

export function classifyResult(
  status: AttemptStatus,
  resultText: string
): ErrorCategory {
  const value = resultText.toLowerCase();
  if (status === "accepted") return "none";
  if (status === "time_limit" || value.includes("time limit")) return "complexity";
  if (
    status === "compile_error" ||
    /syntax|expected|undeclared|not defined|cannot find symbol|编译|语法/.test(value)
  ) {
    return "syntax";
  }
  if (/null|none|nullpointer|nil|空指针|空值/.test(value)) return "null_or_empty";
  if (/out of bounds|indexerror|越界|下标/.test(value)) return "out_of_bounds";
  if (/method|function|attribute|api|类型.*转换|no matching/.test(value)) {
    return "api_usage";
  }
  if (/edge|boundary|empty input|single element|边界|空数组|单个/.test(value)) {
    return "boundary";
  }
  if (status === "wrong_answer") return "logic";
  return "unknown";
}

export function shouldShowDiagnosis(
  hintLevel: number,
  attemptsSinceFirstHint: AttemptRecord[],
  latestCode: string,
  codeAtFirstHint: string
): boolean {
  if (hintLevel < 2) return false;
  const hasNewAttempt = attemptsSinceFirstHint.length > 0;
  const meaningfulChange =
    latestCode.trim() !== codeAtFirstHint.trim() &&
    Math.abs(latestCode.length - codeAtFirstHint.length) >= 6;
  if (!hasNewAttempt && !meaningfulChange) return true;
  const recent = attemptsSinceFirstHint.slice(-2);
  return (
    recent.length === 2 &&
    recent[0].errorCategory !== "none" &&
    recent[0].errorCategory === recent[1].errorCategory
  );
}

export function calculateReviewSchedule(
  rating: ReviewRating,
  currentStep: number,
  now = new Date()
): { reviewStep: number; reviewDueAt: string } {
  let nextStep: number;
  if (rating === "forgot") nextStep = 0;
  else if (rating === "fuzzy") nextStep = Math.min(Math.max(currentStep, 1), 1);
  else nextStep = Math.min(Math.max(currentStep + 1, 2), REVIEW_INTERVALS.length - 1);
  const interval = REVIEW_INTERVALS[nextStep];
  return {
    reviewStep: nextStep,
    reviewDueAt: new Date(now.getTime() + interval * DAY_MS).toISOString()
  };
}

export function canUseGuidance(browserUrl: string): boolean {
  return isSupportedPracticeUrl(browserUrl) && !isRestrictedPracticeUrl(browserUrl);
}

const blockerLabels: Partial<Record<ErrorCategory, string>> = {
  problem_understanding: "题意理解出现偏差",
  syntax: "语法或标点问题",
  api_usage: "语言 API 调用不熟",
  null_or_empty: "空值或空输入处理",
  out_of_bounds: "下标越界",
  boundary: "边界条件遗漏",
  state_update: "状态更新顺序",
  complexity: "时间或空间复杂度",
  logic: "核心逻辑错误"
};

export function createAutomaticMemory(
  draft: ProblemDraft,
  history: AttemptRecord[],
  selectedMethod?: string
): MemoryInput {
  const categories: ErrorCategory[] = Array.from(
    new Set<ErrorCategory>(
      history
        .map((attempt) => attempt.errorCategory)
        .filter((category) => category !== "none" && category !== "unknown")
    )
  );
  const blockers = categories
    .map((category) => blockerLabels[category])
    .filter((label): label is string => Boolean(label));
  const has = (category: ErrorCategory): boolean => categories.includes(category);
  return {
    problemKey: makeProblemKey(draft),
    plainSummary: `已完成「${draft.title}」，复习时先用自己的话重新描述输入、输出和目标。`,
    methodName: selectedMethod || "复习时回忆本次使用的方法",
    actualBlockers: blockers.length > 0 ? blockers : ["本次未记录明显错误"],
    edgeCases: [
      ...(has("boundary") ? ["曾遗漏边界条件"] : []),
      ...(has("null_or_empty") ? ["曾遗漏空值或空输入"] : []),
      ...(has("out_of_bounds") ? ["曾出现下标越界"] : [])
    ],
    apiGaps: has("api_usage") ? ["曾在语言 API 调用上出错"] : [],
    rating: "fuzzy"
  };
}
