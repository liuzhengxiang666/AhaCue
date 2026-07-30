import { readFile, writeFile } from "node:fs/promises";
import { dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type {
  AppSnapshot,
  BrowserState,
  EditorMutationResult,
  ExportBundle,
  PracticeContext,
  ProviderId,
  OverlayDragInput,
  WorkflowRuntimeState
} from "../shared/contracts";
import { providerIds } from "../shared/contracts";
import { canUseGuidance } from "../shared/workflow";
import {
  createLearningUseAttestation,
  LEARNING_USE_SETTING,
  parseLearningUseAttestation
} from "../shared/use-attestation";
import { DatabaseService } from "./database";
import { ProviderFailure, ProviderRouter } from "./provider-router";
import { SecretStore } from "./secret-store";

const draftSchema = z.object({
  sourceUrl: z.string().max(2_000),
  title: z.string().min(1).max(300),
  statement: z.string().min(1).max(60_000),
  language: z.enum(["cpp", "java", "python", "javascript"]),
  code: z.string().max(60_000),
  latestResult: z.string().max(20_000)
});

const guidanceRequestSchema = z.object({
  requestId: z.string().min(1).max(100),
  draft: draftSchema,
  stage: z.enum([
    "understand",
    "method",
    "pseudocode",
    "implement",
    "diagnose",
    "result",
    "review"
  ]),
  mode: z.enum(["guided", "direct", "review"]),
  hintLevel: z.number().int().min(0).max(8),
  selectedMethod: z.string().max(200).optional(),
  allowSnippet: z.boolean(),
  allowSolution: z.boolean(),
  bypassCache: z.boolean().optional(),
  memory: z
    .object({
      problemKey: z.string(),
      plainSummary: z.string(),
      methodName: z.string(),
      actualBlockers: z.array(z.string()),
      edgeCases: z.array(z.string()),
      apiGaps: z.array(z.string()),
      rating: z.enum(["forgot", "fuzzy", "remembered"]),
      reviewStep: z.number(),
      reviewDueAt: z.string(),
      updatedAt: z.string()
    })
    .optional()
});

const memorySchema = z.object({
  problemKey: z.string().min(1).max(500),
  plainSummary: z.string().max(2_000),
  methodName: z.string().max(300),
  actualBlockers: z.array(z.string().max(500)).max(20),
  edgeCases: z.array(z.string().max(500)).max(20),
  apiGaps: z.array(z.string().max(500)).max(20),
  rating: z.enum(["forgot", "fuzzy", "remembered"])
});

export interface IpcDependencies {
  appContentsId: number;
  database: DatabaseService;
  providers: ProviderRouter;
  secrets: SecretStore;
  getBrowserState: () => BrowserState;
  navigate: (url: string) => Promise<BrowserState>;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  setOverlay: (mode: "collapsed" | "bubble" | "drawer" | "settings", height?: number) => void;
  dragOverlay: (input: OverlayDragInput) => void;
  setWorkflowState: (state: WorkflowRuntimeState) => void;
  readPracticeContext: () => Promise<PracticeContext>;
  insertSnippet: (snippet: string) => Promise<EditorMutationResult>;
  replaceSolution: (code: string) => Promise<EditorMutationResult>;
  undoEditorChange: () => Promise<EditorMutationResult>;
  quitApp: () => void;
}

function errorForRenderer(error: unknown): Error {
  if (error instanceof ProviderFailure) {
    return new Error(`[${error.code}] ${error.message}`);
  }
  if (error instanceof z.ZodError) {
    return new Error(`输入数据不完整：${error.issues[0]?.message ?? "校验失败"}`);
  }
  return error instanceof Error ? error : new Error("操作失败。");
}

export function registerIpc(deps: IpcDependencies): () => void {
  const channels: string[] = [];
  const handle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, input?: unknown) => unknown
  ): void => {
    channels.push(channel);
    ipcMain.handle(channel, async (event, input) => {
      if (event.sender.id !== deps.appContentsId) {
        throw new Error("拒绝来自非可信页面的 IPC 请求。");
      }
      try {
        return await listener(event, input);
      } catch (error) {
        throw errorForRenderer(error);
      }
    });
  };

  const currentLearningUseAttestation = () =>
    parseLearningUseAttestation(
      deps.database.getSetting(LEARNING_USE_SETTING)
    );
  const requireLearningUseAttestation = (): void => {
    if (!currentLearningUseAttestation()) {
      throw new Error("请先确认本工具仅用于个人学习和非营利教育。");
    }
  };

  const snapshot = async (): Promise<AppSnapshot> => ({
    providerSettings: await deps.providers.getSettings(),
    recentProblems: deps.database.listRecentProblems(),
    dueReviews: deps.database.listDueReviews(),
    learningUseAttestation: currentLearningUseAttestation()
  });

  handle("app:snapshot", snapshot);
  handle("learning-use:accept", () => {
    const existing = currentLearningUseAttestation();
    if (existing) return existing;
    const attestation = createLearningUseAttestation();
    deps.database.setSetting(
      LEARNING_USE_SETTING,
      JSON.stringify(attestation)
    );
    return attestation;
  });
  handle("app:quit", () => deps.quitApp());
  handle("browser:state", () => deps.getBrowserState());
  handle("browser:navigate", (_event, input) => deps.navigate(z.string().parse(input)));
  handle("browser:back", () => deps.goBack());
  handle("browser:forward", () => deps.goForward());
  handle("browser:reload", () => deps.reload());

  handle("provider:accept-zen", () => {
    requireLearningUseAttestation();
    return deps.providers.acceptZenTerms();
  });
  handle("provider:zen-refresh", () => {
    requireLearningUseAttestation();
    return deps.providers.refreshFreeModels();
  });
  handle("provider:zen-select", (_event, input) => {
    requireLearningUseAttestation();
    return deps.providers.selectFreeModel(
      z.string().min(1).max(200).parse(input)
    );
  });
  handle("provider:zen-test", (_event, input) => {
    requireLearningUseAttestation();
    return deps.providers.testFreeModel(
      z.string().min(1).max(200).parse(input)
    );
  });
  handle("provider:test", (_event, input) => {
    requireLearningUseAttestation();
    const value = z
      .object({
        providerId: z.enum(providerIds),
        apiKey: z.string().min(8).max(500)
      })
      .parse(input);
    return deps.providers.testConnection(value.providerId, value.apiKey);
  });
  handle("provider:save-key", (_event, input) => {
    requireLearningUseAttestation();
    const value = z
      .object({
        providerId: z.enum(providerIds),
        apiKey: z.string().min(8).max(500),
        fallbackConsent: z.boolean()
      })
      .parse(input);
    return deps.providers.saveKey(value.providerId, value.apiKey, value.fallbackConsent);
  });
  handle("provider:clear-key", (_event, input) => {
    requireLearningUseAttestation();
    return deps.providers.clearKey(z.enum(providerIds).parse(input));
  });

  handle("guidance:generate", async (event, input) => {
    requireLearningUseAttestation();
    const state = deps.getBrowserState();
    if (!canUseGuidance(state.url)) {
      throw new Error("当前页面属于比赛、测评或非支持站点，辅导能力已关闭。");
    }
    const request = guidanceRequestSchema.parse(input);
    const result = await deps.providers.generate(request, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("guidance:progress", progress);
      }
    });
    deps.database.recordGuidance(request, result.card, result.providerId);
    return { card: result.card, cached: result.cached };
  });
  handle("guidance:cancel", (_event, input) => {
    deps.providers.cancel(z.string().min(1).max(100).parse(input));
  });

  handle("overlay:set", (_event, input) => {
    const value = z
      .object({
        mode: z.enum(["collapsed", "bubble", "drawer", "settings"]),
        contentHeight: z.number().int().min(64).max(2_000).optional()
      })
      .parse(input);
    deps.setOverlay(value.mode, value.contentHeight);
  });
  handle("overlay:drag", (_event, input) => {
    const value = z
      .object({
        phase: z.enum(["start", "move", "end"]),
        screenX: z.number().finite(),
        screenY: z.number().finite()
      })
      .parse(input);
    deps.dragOverlay(value);
  });
  handle("workflow:set-state", (_event, input) => {
    requireLearningUseAttestation();
    const value = z
      .object({
        mode: z.enum(["guided", "direct", "review"]),
        stage: guidanceRequestSchema.shape.stage,
        selectedMethod: z.string().max(200).optional()
      })
      .parse(input);
    deps.setWorkflowState(value);
  });
  handle("practice:context", () => {
    requireLearningUseAttestation();
    return deps.readPracticeContext();
  });
  handle("editor:insert-snippet", (_event, input) => {
    requireLearningUseAttestation();
    return deps.insertSnippet(z.string().min(1).max(2_000).parse(input));
  });
  handle("editor:replace-solution", (_event, input) => {
    requireLearningUseAttestation();
    return deps.replaceSolution(z.string().min(1).max(20_000).parse(input));
  });
  handle("editor:undo", () => {
    requireLearningUseAttestation();
    return deps.undoEditorChange();
  });

  handle("memory:save", (_event, input) => {
    requireLearningUseAttestation();
    return deps.database.saveMemory(memorySchema.parse(input));
  });
  handle("memory:get", (_event, input) => {
    requireLearningUseAttestation();
    return deps.database.getMemory(z.string().min(1).max(500).parse(input));
  });
  handle("problem:history", (_event, input) => {
    requireLearningUseAttestation();
    return deps.database.listProblemHistory(
      z.string().max(500).parse(input)
    );
  });

  handle("data:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "导出学习记录",
      defaultPath: `ahacue-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "AhaCue JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, JSON.stringify(deps.database.exportData(), null, 2), "utf8");
    return { canceled: false, path: result.filePath };
  });

  handle("data:import", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入学习记录",
      properties: ["openFile"],
      filters: [{ name: "AhaCue JSON", extensions: ["json"] }]
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { canceled: true };
    const bundle = JSON.parse(await readFile(filePath, "utf8")) as ExportBundle;
    return { canceled: false, imported: deps.database.importData(bundle) };
  });

  handle("data:delete-all", async () => {
    deps.database.deleteAllData();
    await deps.secrets.clear();
  });

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
