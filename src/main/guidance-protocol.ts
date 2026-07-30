import { z } from "zod";
import type {
  DiagnosisCard,
  GuidanceCard,
  GuidanceMethod,
  GuidanceRequest,
  GuidedStartCard,
  HintCard,
  PseudocodeCard,
  ReviewCard,
  SolutionCard
} from "../shared/contracts";

export const GUIDANCE_PROMPT_VERSION = "compact-v2";

export interface GuidancePrompt {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

const guidedStartSchema = z.object({
  type: z.literal("guided_start"),
  understanding: z.string().min(1).max(70),
  caution: z.string().max(40).optional(),
  methods: z
    .array(
      z.object({
        id: z.string().min(1).max(24),
        name: z.string().min(1).max(14),
        action: z.string().min(1).max(36),
        complexity: z.string().min(1).max(24),
        recommended: z.boolean()
      })
    )
    .min(1)
    .max(3)
});

const pseudocodeSchema = z.object({
  type: z.literal("pseudocode"),
  method: z.string().min(1).max(20),
  reason: z.string().min(1).max(70),
  steps: z.array(z.string().min(1).max(48)).min(1).max(4),
  apiNotes: z.array(z.string().min(1).max(52)).max(2),
  edgeCases: z.array(z.string().min(1).max(48)).max(2),
  snippet: z.string().max(1_200).optional()
});

const hintSchema = z.object({
  type: z.literal("hint"),
  nextStep: z.string().min(1).max(70),
  reason: z.string().max(55).optional(),
  apiNote: z.string().max(52).optional(),
  snippet: z.string().max(1_200).optional()
});

const diagnosisSchema = z.object({
  type: z.literal("diagnosis"),
  problem: z.string().min(1).max(70),
  fix: z.string().min(1).max(80),
  apiNote: z.string().max(52).optional(),
  snippet: z.string().max(1_200).optional()
});

const solutionSchema = z.object({
  type: z.literal("solution"),
  approach: z.string().min(1).max(80),
  code: z.string().min(1).max(20_000)
});

const reviewSchema = z.object({
  type: z.literal("review"),
  question: z.string().min(1).max(80),
  originalMethod: z.string().max(30).optional(),
  blockers: z.array(z.string().min(1).max(48)).max(2)
});

const cardSchema = z.discriminatedUnion("type", [
  guidedStartSchema,
  pseudocodeSchema,
  hintSchema,
  diagnosisSchema,
  solutionSchema,
  reviewSchema
]);

const BASE_SYSTEM = `你是算法手写陪练，只给当前一步。
禁止寒暄、背景知识、定义、复述题面、总结段和“首先/其次/最后”式套话。
禁止输出用户没有请求的 API、边界或完整代码。
只输出一个 JSON 对象，不要 Markdown 围栏，不要 JSON 之外的文字。
所有文字使用简短中文，宁可少写，不要解释完整原理。`;

const STAGE_SYSTEM: Record<GuidanceRequest["stage"], string> = {
  understand: `输出 type="guided_start"。
understanding：一句大白话说明“用户究竟要做什么”，最多70字。
caution：只写最容易误解的一点，最多40字；没有则省略。
methods：1到3项。每项只含 id、name、action、complexity、recommended。
name最多14字；action只写核心动作，最多36字；不要在方法列表解释原理。
只能有一个 recommended=true。`,
  method: `输出 type="guided_start"，规则与题意阶段相同。`,
  pseudocode: `输出 type="pseudocode"。
字段只允许 method、reason、steps、apiNotes、edgeCases、snippet。
reason用一句话说明为什么这个方法/数据结构合适，最多70字。
steps最多4步，每步只写一个动作；edgeCases最多2条；apiNotes最多2条且对应当前语言。
未提供所选方法但附有当前代码线索时，从代码中概括用户正在采用的方法。
只有允许局部片段时才输出 snippet，绝不能给完整答案。`,
  implement: `输出 type="hint"。
nextStep只指出用户此刻应该补的一个动作，不能重新讲整题。
reason可选，只解释这一动作；apiNote可选且最多一个。
只有允许局部片段时才输出 snippet，绝不能给完整答案。`,
  diagnose: `输出 type="diagnosis"。
problem只指出当前最可能的一个问题；fix只给最小修改方向。
apiNote可选且最多一个。不要罗列多种可能，不要重新讲题。
只有允许局部片段时才输出 snippet，绝不能给完整答案。`,
  result: `输出 type="solution"。
approach只用一句话说明方法；code给当前语言可直接运行的完整实现。
不要在代码前后增加教程。`,
  review: `输出 type="review"。
question只问一个能唤起题意或原方法的问题。
originalMethod可选；blockers最多2条，只使用本地历史中的真实卡点。`
};

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function compactWhitespace(value: string): string {
  return value
    .replace(/```(?:json)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampSentence(value: unknown, maxLength: number, fallback = ""): string {
  const normalized = compactWhitespace(valueText(value)) || fallback;
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  const candidate = chars.slice(0, Math.max(1, maxLength - 1)).join("");
  const punctuation = [...candidate.matchAll(/[。！？；，,.!?;:：]/g)];
  const last = punctuation.at(-1)?.index;
  const clipped =
    typeof last === "number" && last >= Math.floor(maxLength * 0.55)
      ? candidate.slice(0, last + 1)
      : candidate;
  return `${clipped.replace(/[，,；;：:\s]+$/u, "")}…`;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  let values: unknown[];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === "string") {
    values = value
      .split(/\n+|(?<=。)\s*|(?:^|\s)\d+[.)、]\s*/u)
      .filter(Boolean);
  } else {
    values = [];
  }
  return values
    .map((item) => clampSentence(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstListItem(...values: unknown[]): string {
  for (const value of values) {
    const item = textList(value, 1, 200)[0];
    if (item) return item;
  }
  return "";
}

function normalizeMethods(input: Record<string, unknown>): GuidanceMethod[] {
  const rawMethods = Array.isArray(input.methods) ? input.methods : [];
  const methods = rawMethods.slice(0, 3).map((raw, index) => {
    const method = asRecord(raw);
    return {
      id: clampSentence(method.id, 24, `method-${index + 1}`),
      name: clampSentence(method.name, 14, `方法${index + 1}`),
      action: clampSentence(
        method.action ?? method.core ?? method.why ?? method.description,
        36,
        "按题意维护所需状态"
      ),
      complexity: clampSentence(
        method.complexity ?? method.timeComplexity ?? method.time_complexity,
        24,
        "视实现而定"
      ),
      recommended:
        method.recommended === true ||
        valueText(method.recommended).toLowerCase() === "true"
    };
  });
  if (methods.length === 0) {
    methods.push({
      id: "direct",
      name: "按题意模拟",
      action: "按输入顺序维护题目要求的状态",
      complexity: "视实现而定",
      recommended: true
    });
  }
  const recommendedIndex = methods.findIndex((method) => method.recommended);
  return methods.map((method, index) => ({
    ...method,
    recommended: index === (recommendedIndex < 0 ? 0 : recommendedIndex)
  }));
}

function normalizeGuidedStart(input: Record<string, unknown>): GuidedStartCard {
  const understandingRecord = asRecord(input.understanding);
  return guidedStartSchema.parse({
    type: "guided_start",
    understanding: clampSentence(
      typeof input.understanding === "string"
        ? input.understanding
        : understandingRecord.summary ??
            input.summary ??
            input.explanation ??
            input.content,
      70,
      "先确认题目要求的输入、目标和返回值。"
    ),
    ...(clampSentence(
      input.caution ??
        understandingRecord.caution ??
        firstListItem(input.edgeCases, input.edge_cases),
      40
    )
      ? {
          caution: clampSentence(
            input.caution ??
              understandingRecord.caution ??
              firstListItem(input.edgeCases, input.edge_cases),
            40
          )
        }
      : {}),
    methods: normalizeMethods(input)
  });
}

function normalizePseudocode(
  input: Record<string, unknown>,
  request: GuidanceRequest
): PseudocodeCard {
  const steps = textList(
    input.steps ?? input.pseudocode ?? input.bullets,
    4,
    48
  );
  const snippet = valueText(input.snippet).trim().slice(0, 1_200);
  return pseudocodeSchema.parse({
    type: "pseudocode",
    method: clampSentence(
      input.method ?? input.methodName ?? request.selectedMethod,
      20,
      request.selectedMethod || "所选方法"
    ),
    reason: clampSentence(
      input.reason ?? input.why ?? input.summary,
      70,
      "这个方法能直接维护题目需要的状态。"
    ),
    steps: steps.length > 0 ? steps : ["按所选方法初始化状态", "遍历输入并更新状态"],
    apiNotes: textList(input.apiNotes ?? input.api_notes, 2, 52),
    edgeCases: textList(input.edgeCases ?? input.edge_cases, 2, 48),
    ...(request.allowSnippet && snippet ? { snippet } : {})
  });
}

function normalizeHint(
  input: Record<string, unknown>,
  request: GuidanceRequest
): HintCard {
  const bullets = textList(input.bullets, 2, 70);
  const nextStep = clampSentence(
    input.nextStep ?? input.next_step ?? input.summary ?? bullets[0],
    70,
    "只补上当前缺失的下一步。"
  );
  const reason = clampSentence(input.reason ?? input.why ?? bullets[1], 55);
  const apiNote = clampSentence(
    input.apiNote ?? firstListItem(input.apiNotes, input.api_notes),
    52
  );
  const snippet = valueText(input.snippet).trim().slice(0, 1_200);
  return hintSchema.parse({
    type: "hint",
    nextStep,
    ...(reason ? { reason } : {}),
    ...(apiNote ? { apiNote } : {}),
    ...(request.allowSnippet && snippet ? { snippet } : {})
  });
}

function normalizeDiagnosis(
  input: Record<string, unknown>,
  request: GuidanceRequest
): DiagnosisCard {
  const bullets = textList(input.bullets, 2, 80);
  const apiNote = clampSentence(
    input.apiNote ?? firstListItem(input.apiNotes, input.api_notes),
    52
  );
  const snippet = valueText(input.snippet).trim().slice(0, 1_200);
  return diagnosisSchema.parse({
    type: "diagnosis",
    problem: clampSentence(
      input.problem ?? input.issue ?? input.summary ?? bullets[0],
      70,
      "当前代码还没有正确处理关键状态。"
    ),
    fix: clampSentence(
      input.fix ?? input.nextStep ?? input.solution ?? bullets[1],
      80,
      "只修改对应状态的初始化或更新位置。"
    ),
    ...(apiNote ? { apiNote } : {}),
    ...(request.allowSnippet && snippet ? { snippet } : {})
  });
}

function extractCode(value: unknown, fallbackContent: string): string {
  const direct = valueText(value).trim();
  if (direct) return direct.slice(0, 20_000);
  const fenced = fallbackContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? "").trim().slice(0, 20_000);
}

function normalizeSolution(
  input: Record<string, unknown>,
  fallbackContent: string
): SolutionCard {
  return solutionSchema.parse({
    type: "solution",
    approach: clampSentence(
      input.approach ?? input.summary ?? input.explanation,
      80,
      "按推荐方法完成实现。"
    ),
    code: extractCode(input.code ?? input.solution, fallbackContent) || "// 模型未返回代码"
  });
}

function normalizeReview(
  input: Record<string, unknown>,
  request: GuidanceRequest
): ReviewCard {
  return reviewSchema.parse({
    type: "review",
    question: clampSentence(
      input.question ?? input.summary,
      80,
      "你还记得这道题的输入、目标和原来的做法吗？"
    ),
    ...(clampSentence(
      input.originalMethod ?? input.method ?? request.memory?.methodName,
      30
    )
      ? {
          originalMethod: clampSentence(
            input.originalMethod ?? input.method ?? request.memory?.methodName,
            30
          )
        }
      : {}),
    blockers: textList(
      input.blockers ?? request.memory?.actualBlockers,
      2,
      48
    )
  });
}

function parseObject(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return asRecord(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return {};
  }
}

export function normalizeGuidanceCard(
  raw: unknown,
  fallbackContent: string,
  request: GuidanceRequest
): GuidanceCard {
  const input = asRecord(raw);
  if (request.allowSolution || request.stage === "result") {
    return normalizeSolution(input, fallbackContent);
  }
  if (request.stage === "understand" || request.stage === "method") {
    return normalizeGuidedStart(input);
  }
  if (request.stage === "pseudocode") {
    return normalizePseudocode(input, request);
  }
  if (request.stage === "diagnose") {
    return normalizeDiagnosis(input, request);
  }
  if (request.stage === "review") {
    return normalizeReview(input, request);
  }
  return normalizeHint(input, request);
}

export function parseGuidanceCard(
  content: string,
  request: GuidanceRequest
): GuidanceCard {
  return normalizeGuidanceCard(parseObject(content), content, request);
}

function languageName(language: GuidanceRequest["draft"]["language"]): string {
  const names = {
    cpp: "C++",
    java: "Java",
    python: "Python",
    javascript: "JavaScript/TypeScript"
  };
  return names[language];
}

export function buildGuidancePrompt(request: GuidanceRequest): GuidancePrompt {
  const title = request.draft.title.slice(0, 160);
  const language = languageName(request.draft.language);
  let user: string;
  let maxTokens: number;
  let timeoutMs = 8_000;

  switch (request.stage) {
    case "understand":
    case "method":
      user = `语言：${language}
题目：${title}
题面：
${request.draft.statement.slice(0, 8_000)}`;
      maxTokens = 520;
      break;
    case "pseudocode":
      user = `语言：${language}
题目：${title}
所选方法：${request.selectedMethod || "未提供"}
题面：
${request.draft.statement.slice(0, 5_000)}
${request.inferMethodFromCode ? `当前代码线索：
${request.draft.code.slice(0, 12_000)}
请让伪代码与当前代码准备采用的方法一致，方便用户放在旁边对照手写。
` : ""}
允许局部片段：${request.allowSnippet ? "是" : "否"}`;
      maxTokens = 650;
      break;
    case "implement":
      user = `语言：${language}
题目：${title}
所选方法：${request.selectedMethod || "未提供"}
提示级别：${request.hintLevel}
必要题面：
${request.draft.statement.slice(0, 3_500)}
当前代码：
${request.draft.code.slice(0, 12_000)}
允许局部片段：${request.allowSnippet ? "是" : "否"}`;
      maxTokens = 220;
      break;
    case "diagnose":
      user = `语言：${language}
题目：${title}
所选方法：${request.selectedMethod || "未提供"}
当前代码：
${request.draft.code.slice(0, 15_000)}
最新错误或结果：
${request.draft.latestResult.slice(0, 3_000)}
必要题面：
${request.draft.statement.slice(0, 3_000)}
允许局部片段：${request.allowSnippet ? "是" : "否"}`;
      maxTokens = 320;
      break;
    case "result":
      user = `语言：${language}
题目：${title}
题面：
${request.draft.statement.slice(0, 8_000)}
编辑器中的函数签名或已有代码：
${request.draft.code.slice(0, 5_000)}`;
      maxTokens = 2_400;
      timeoutMs = 25_000;
      break;
    case "review":
      user = `语言：${language}
题目：${title}
必要题面：
${request.draft.statement.slice(0, 3_000)}
本地复习记忆：
${JSON.stringify({
  原方法: request.memory?.methodName || "",
  真实卡点: request.memory?.actualBlockers.slice(0, 2) || [],
  API遗忘: request.memory?.apiGaps.slice(0, 2) || []
})}`;
      maxTokens = 320;
      break;
  }

  return {
    system: `${BASE_SYSTEM}\n${STAGE_SYSTEM[request.stage]}`,
    user,
    maxTokens,
    timeoutMs
  };
}

export function isGuidanceCacheable(request: GuidanceRequest): boolean {
  return request.stage === "understand" || request.stage === "pseudocode";
}

export function guidanceCacheIdentity(request: GuidanceRequest): string {
  return JSON.stringify({
    version: GUIDANCE_PROMPT_VERSION,
    sourceUrl: request.draft.sourceUrl,
    statement: request.draft.statement,
    language: request.draft.language,
    stage: request.stage,
    selectedMethod:
      request.stage === "pseudocode" ? request.selectedMethod || "" : "",
    inferMethodFromCode: Boolean(request.inferMethodFromCode),
    code:
      request.stage === "pseudocode" && request.inferMethodFromCode
        ? request.draft.code.slice(0, 12_000)
        : ""
  });
}

export function validateGuidanceCard(value: unknown): GuidanceCard {
  return cardSchema.parse(value) as GuidanceCard;
}
