import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, type WebContents } from "electron";
import { z } from "zod";
import type {
  EditorMutationResult,
  ObservedAttempt,
  PracticeContext,
  ProblemDraft
} from "../shared/contracts";
import { makeProblemKey } from "../shared/workflow";

const draftSchema = z.object({
  sourceUrl: z.string().url().max(2_000),
  title: z.string().min(1).max(300),
  statement: z.string().min(1).max(60_000),
  language: z.enum(["cpp", "java", "python", "javascript"]),
  code: z.string().max(60_000),
  latestResult: z.string().max(20_000)
});

const contextSchema = z.object({
  recognized: z.boolean(),
  reason: z.string().max(500).optional(),
  draft: draftSchema.optional()
});

const attemptSchema = z.object({
  sequence: z.number().int().nonnegative(),
  trigger: z.enum(["run", "submit"]),
  status: z.enum([
    "not_run",
    "compile_error",
    "runtime_error",
    "wrong_answer",
    "time_limit",
    "memory_limit",
    "accepted",
    "other"
  ]),
  draft: draftSchema
});

interface AutomaticAdapterModule {
  id: string;
  mode: "automatic";
  supports(url: string): boolean;
  install(contents: WebContents): Promise<void>;
  readContext(contents: WebContents): Promise<unknown>;
  readAttempt(contents: WebContents): Promise<unknown>;
  insertSnippet(contents: WebContents, snippet: string): Promise<unknown>;
  replaceCode(contents: WebContents, code: string): Promise<unknown>;
}

function adapterPath(): string | undefined {
  const configured = process.env.ALGO_COMPANION_ADAPTER_PATH?.trim();
  if (configured) return path.resolve(configured);
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "leetcode-cn.cjs");
    if (existsSync(bundled)) return bundled;
  }
  const integrated = path.join(app.getAppPath(), "adapters", "leetcode-cn.cjs");
  if (existsSync(integrated)) return integrated;
  return undefined;
}

async function loadAdapter(): Promise<AutomaticAdapterModule | undefined> {
  const target = adapterPath();
  if (!target || !existsSync(target)) return undefined;
  const imported = (await import(/* @vite-ignore */ pathToFileURL(target).href)) as {
    default?: AutomaticAdapterModule;
  };
  const candidate = imported.default ?? (imported as unknown as AutomaticAdapterModule);
  if (
    !candidate ||
    candidate.mode !== "automatic" ||
    typeof candidate.supports !== "function" ||
    typeof candidate.readContext !== "function" ||
    typeof candidate.readAttempt !== "function" ||
    typeof candidate.insertSnippet !== "function" ||
    typeof candidate.replaceCode !== "function"
  ) {
    throw new Error("内置页面识别模块格式不正确。");
  }
  return candidate;
}

function normalizeMutation(
  value: unknown,
  fallbackCode: string,
  canUndo: boolean
): EditorMutationResult {
  const parsed = z
    .object({
      ok: z.boolean(),
      message: z.string().max(500).optional(),
      code: z.string().max(60_000).optional()
    })
    .parse(value);
  return {
    ok: parsed.ok,
    message: parsed.message || (parsed.ok ? "编辑器已更新。" : "编辑器写入失败。"),
    code: parsed.code ?? fallbackCode,
    canUndo: parsed.ok && canUndo
  };
}

export class PlatformAdapterHost {
  private loadedAdapter?: AutomaticAdapterModule;
  private readonly seenAttempts = new Set<string>();
  private readonly undoStacks = new Map<string, string[]>();

  constructor(private readonly contents: WebContents) {}

  async initialize(): Promise<void> {
    this.loadedAdapter = await loadAdapter();
  }

  get available(): boolean {
    return Boolean(this.loadedAdapter);
  }

  async attach(): Promise<void> {
    if (!this.loadedAdapter || !this.loadedAdapter.supports(this.contents.getURL())) return;
    await this.loadedAdapter.install(this.contents);
  }

  async readContext(): Promise<PracticeContext> {
    if (!this.loadedAdapter) {
      return {
        recognized: false,
        reason: "内置页面识别模块尚未加载。",
        capturedAt: new Date().toISOString()
      };
    }
    const url = this.contents.getURL();
    if (!this.loadedAdapter.supports(url)) {
      return {
        recognized: false,
        reason: "第一版只识别力扣中国站的普通题目页面。",
        capturedAt: new Date().toISOString()
      };
    }
    try {
      await this.attach();
      const parsed = contextSchema.parse(
        await this.loadedAdapter.readContext(this.contents)
      );
      return { ...parsed, capturedAt: new Date().toISOString() };
    } catch (error) {
      return {
        recognized: false,
        reason: error instanceof Error ? error.message : "当前页面暂未识别。",
        capturedAt: new Date().toISOString()
      };
    }
  }

  async pollAttempt(): Promise<ObservedAttempt | undefined> {
    if (
      !this.loadedAdapter ||
      !this.loadedAdapter.supports(this.contents.getURL())
    ) {
      return undefined;
    }
    try {
      await this.attach();
      const raw = await this.loadedAdapter.readAttempt(this.contents);
      if (!raw) return undefined;
      const attempt = attemptSchema.parse(raw);
      if (attempt.status === "not_run") return undefined;
      const key = `${attempt.draft.sourceUrl}:${attempt.sequence}`;
      if (this.seenAttempts.has(key)) return undefined;
      this.seenAttempts.add(key);
      if (this.seenAttempts.size > 200) {
        const oldest = this.seenAttempts.values().next().value;
        if (oldest) this.seenAttempts.delete(oldest);
      }
      return attempt;
    } catch {
      return undefined;
    }
  }

  async insertSnippet(snippet: string): Promise<EditorMutationResult> {
    const adapter = this.requireAdapter();
    const context = await this.requireContext();
    this.pushUndo(context.draft);
    const result = normalizeMutation(
      await adapter.insertSnippet(this.contents, snippet),
      context.draft.code,
      true
    );
    if (!result.ok) this.popUndo(context.draft);
    return result;
  }

  async replaceSolution(code: string): Promise<EditorMutationResult> {
    const adapter = this.requireAdapter();
    const context = await this.requireContext();
    this.pushUndo(context.draft);
    const result = normalizeMutation(
      await adapter.replaceCode(this.contents, code),
      context.draft.code,
      true
    );
    if (!result.ok) this.popUndo(context.draft);
    return result;
  }

  async undo(): Promise<EditorMutationResult> {
    const adapter = this.requireAdapter();
    const context = await this.requireContext();
    const key = makeProblemKey(context.draft);
    const stack = this.undoStacks.get(key);
    const previous = stack?.pop();
    if (previous === undefined) {
      return {
        ok: false,
        message: "当前题目没有可撤销的 Agent 写入。",
        code: context.draft.code,
        canUndo: false
      };
    }
    const result = normalizeMutation(
      await adapter.replaceCode(this.contents, previous),
      context.draft.code,
      false
    );
    if (!result.ok) stack?.push(previous);
    return { ...result, canUndo: Boolean(stack?.length) };
  }

  private requireAdapter(): AutomaticAdapterModule {
    if (!this.loadedAdapter) throw new Error("内置页面识别模块尚未加载。");
    if (!this.loadedAdapter.supports(this.contents.getURL())) {
      throw new Error("当前页面不支持自动编辑。");
    }
    return this.loadedAdapter;
  }

  private async requireContext(): Promise<PracticeContext & { draft: ProblemDraft }> {
    const context = await this.readContext();
    if (!context.recognized || !context.draft) {
      throw new Error(context.reason || "当前页面暂未识别。");
    }
    return context as PracticeContext & { draft: ProblemDraft };
  }

  private pushUndo(draft: ProblemDraft): void {
    const key = makeProblemKey(draft);
    const stack = this.undoStacks.get(key) ?? [];
    stack.push(draft.code);
    if (stack.length > 10) stack.shift();
    this.undoStacks.set(key, stack);
  }

  private popUndo(draft: ProblemDraft): void {
    this.undoStacks.get(makeProblemKey(draft))?.pop();
  }
}
