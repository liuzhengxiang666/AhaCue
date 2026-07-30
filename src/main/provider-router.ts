import { createHash } from "node:crypto";
import type {
  FreeModelInfo,
  GuidanceCard,
  GuidanceProgress,
  GuidanceRequest,
  ModelRoutingMode,
  ProviderId,
  ProviderSettings,
  ProviderStatus,
  ProviderTestResult
} from "../shared/contracts";
import type { DatabaseService } from "./database";
import {
  buildGuidancePrompt,
  guidanceCacheIdentity,
  isGuidanceCacheable,
  normalizeGuidanceCard,
  parseGuidanceCard,
  validateGuidanceCard
} from "./guidance-protocol";
import type { SecretStore } from "./secret-store";

interface ProviderPreset {
  id: ProviderId;
  name: string;
  endpoint: string;
  model: string;
}

type StoredFreeModel = FreeModelInfo;

interface ModelHealth {
  latencyMs?: number;
  failures: number;
  cooldownUntil: number;
  disabled: boolean;
}

interface CompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      reasoning?: string | null;
    };
  }>;
  error?: { message?: string };
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

interface ModelsDevModel {
  id?: string;
  name?: string;
  status?: string;
  cost?: { input?: number; output?: number };
  provider?: { npm?: string };
}

interface ProviderRouterOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

const presets: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash"
  },
  {
    id: "dashscope",
    name: "阿里百炼 / Qwen",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus"
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4.7-flash"
  },
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    model: "kimi-k2.5"
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    endpoint: "https://api.siliconflow.cn/v1/chat/completions",
    model: "deepseek-ai/DeepSeek-V4-Flash"
  },
  {
    id: "zen",
    name: "OpenCode Zen",
    endpoint: "https://opencode.ai/zen/v1/chat/completions",
    model: ""
  }
];

const defaultFreeModels: StoredFreeModel[] = [
  {
    id: "ling-3.0-flash-free",
    name: "Ling 3.0 Flash Free",
    protocol: "openai"
  },
  {
    id: "north-mini-code-free",
    name: "North Mini Code Free",
    protocol: "openai"
  },
  {
    id: "deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash Free",
    protocol: "openai"
  },
  {
    id: "mimo-v2.5-free",
    name: "MiMo V2.5 Free",
    protocol: "openai"
  }
];

const fastModelPreference = [
  "ling-3.0-flash-free",
  "north-mini-code-free",
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "laguna-s-2.1-free",
  "nemotron-3-ultra-free",
  "big-pickle"
];

const HTTP_COOLDOWN_MS = 2 * 60 * 1_000;
const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1_000;

function openAIContent(value: CompletionResponse["choices"]): string {
  const message = value?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) return content;
  }
  if (Array.isArray(content)) {
    const joined = content.map((item) => item.text ?? "").join("\n").trim();
    const start = joined.indexOf("{");
    const end = joined.lastIndexOf("}");
    if (start >= 0 && end > start) return joined;
  }
  return message?.reasoning?.trim() || (typeof content === "string" ? content : "");
}

function zenReasoningEffort(modelId: string): "none" | "low" | undefined {
  if (modelId === "north-mini-code-free") return "none";
  if (
    modelId === "ling-3.0-flash-free" ||
    modelId === "laguna-s-2.1-free"
  ) {
    return "low";
  }
  return undefined;
}

function zenTokenBudget(maxTokens: number): number {
  if (maxTokens <= 220) return 900;
  if (maxTokens <= 320) return 1_100;
  if (maxTokens <= 520) return 1_400;
  if (maxTokens <= 650) return 1_800;
  return Math.min(5_000, maxTokens * 2);
}

function cacheKey(request: GuidanceRequest): string {
  return createHash("sha256")
    .update(guidanceCacheIdentity(request))
    .digest("hex");
}

class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export class ProviderFailure extends Error {
  constructor(
    message: string,
    readonly code:
      | "ZEN_TERMS_REQUIRED"
      | "SETUP_REQUIRED"
      | "PROVIDER_FAILED"
      | "CANCELLED"
  ) {
    super(message);
  }
}

export interface GuidanceProviderResult {
  card: GuidanceCard;
  providerId: string;
  cached: boolean;
}

export class ProviderRouter {
  private freeModelCache?: StoredFreeModel[];
  private readonly health = new Map<string, ModelHealth>();
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly database: DatabaseService,
    private readonly secrets: SecretStore,
    options: ProviderRouterOptions = {}
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getSettings(): Promise<ProviderSettings> {
    const activeFallback = this.database.getSetting("activeFallback") as
      | ProviderId
      | undefined;
    const statuses: ProviderStatus[] = [];
    for (const preset of presets) {
      const hasKey = await this.secrets.has(preset.id);
      statuses.push({
        id: preset.id,
        name: preset.name,
        hasKey,
        activeFallback: activeFallback === preset.id,
        persistence: hasKey ? this.secrets.getPersistence() : "none"
      });
    }
    const freeModels = this.storedFreeModels();
    const selected = this.database.getSetting("activeZenModel");
    const activeFreeModel = freeModels.some((model) => model.id === selected)
      ? selected
      : freeModels[0]?.id;
    const storedMode = this.database.getSetting("zenRoutingMode");
    const routingMode: ModelRoutingMode =
      storedMode === "fixed" ? "fixed" : "auto_fast";
    return {
      zenAccepted: this.database.getSetting("zenAccepted") === "true",
      freeModels,
      routingMode,
      activeFreeModel,
      freeModelsUpdatedAt: this.database.getSetting("zenModelsUpdatedAt"),
      fallbackConsent: this.database.getSetting("fallbackConsent") === "true",
      activeFallback,
      providers: statuses
    };
  }

  async saveKey(
    providerId: ProviderId,
    apiKey: string,
    fallbackConsent: boolean
  ): Promise<ProviderSettings> {
    await this.secrets.set(providerId, apiKey);
    this.database.setSetting("activeFallback", providerId);
    this.database.setSetting("fallbackConsent", String(fallbackConsent));
    return this.getSettings();
  }

  async clearKey(providerId: ProviderId): Promise<ProviderSettings> {
    await this.secrets.delete(providerId);
    if (this.database.getSetting("activeFallback") === providerId) {
      this.database.setSetting("activeFallback", "");
      this.database.setSetting("fallbackConsent", "false");
    }
    return this.getSettings();
  }

  acceptZenTerms(): Promise<ProviderSettings> {
    this.database.setSetting("zenAccepted", "true");
    return this.getSettings();
  }

  async refreshFreeModels(): Promise<ProviderSettings> {
    const models = await this.discoverFreeModels();
    this.freeModelCache = models;
    this.database.setSetting("zenFreeModels", JSON.stringify(models));
    this.database.setSetting("zenModelsUpdatedAt", new Date().toISOString());
    const selected = this.database.getSetting("activeZenModel");
    if (!selected || !models.some((model) => model.id === selected)) {
      this.database.setSetting("activeZenModel", models[0].id);
    }
    return this.getSettings();
  }

  async selectFreeModel(modelId: string): Promise<ProviderSettings> {
    if (modelId === "auto") {
      this.database.setSetting("zenRoutingMode", "auto_fast");
      return this.getSettings();
    }
    const models = this.storedFreeModels();
    if (!models.some((model) => model.id === modelId)) {
      throw new ProviderFailure(
        "该免费模型已不在可用列表中，请刷新列表。",
        "SETUP_REQUIRED"
      );
    }
    this.database.setSetting("activeZenModel", modelId);
    this.database.setSetting("zenRoutingMode", "fixed");
    return this.getSettings();
  }

  async testFreeModel(modelId: string): Promise<ProviderTestResult> {
    const model =
      modelId === "auto"
        ? this.orderedFreeModels(this.storedFreeModels(), "auto_fast")[0]
        : this.storedFreeModels().find((item) => item.id === modelId);
    if (!model) {
      throw new ProviderFailure(
        "请选择一个当前可用的免费模型。",
        "SETUP_REQUIRED"
      );
    }
    const startedAt = this.now();
    try {
      await this.requestZenText(
        model,
        "只输出 JSON，不要解释。",
        '返回 {"ok":true}',
        128,
        AbortSignal.timeout(8_000)
      );
      this.markSuccess(model.id, this.now() - startedAt);
    } catch (error) {
      this.markFailure(model.id, error);
      throw error;
    }
    return {
      ok: true,
      providerId: "zen",
      providerName: "OpenCode Zen",
      model: model.name,
      message: "免费模型调用成功。"
    };
  }

  async testConnection(
    providerId: ProviderId,
    apiKey: string
  ): Promise<ProviderTestResult> {
    const preset = presets.find((item) => item.id === providerId);
    if (!preset || preset.id === "zen") {
      throw new ProviderFailure(
        "请选择一个国内备用模型。",
        "SETUP_REQUIRED"
      );
    }
    const response = await this.fetcher(preset.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: preset.model,
        messages: [{ role: "user", content: "只回复 OK" }],
        temperature: 0,
        max_tokens: 64,
        stream: false
      }),
      signal: AbortSignal.timeout(20_000)
    });
    const body = (await response.json().catch(() => ({}))) as CompletionResponse;
    if (!response.ok) {
      throw new ProviderFailure(
        `${preset.name} 连接失败：${body.error?.message || `HTTP ${response.status}`}`,
        "PROVIDER_FAILED"
      );
    }
    if (!body.choices?.[0]?.message) {
      throw new ProviderFailure(
        `${preset.name} 已响应，但返回格式无法识别。`,
        "PROVIDER_FAILED"
      );
    }
    return {
      ok: true,
      providerId,
      providerName: preset.name,
      model: preset.model,
      message: "连接成功，可以保存为备用模型。"
    };
  }

  cancel(requestId: string): void {
    this.activeRequests.get(requestId)?.abort();
  }

  async generate(
    request: GuidanceRequest,
    onProgress?: (progress: GuidanceProgress) => void
  ): Promise<GuidanceProviderResult> {
    this.cancel(request.requestId);
    const controller = new AbortController();
    this.activeRequests.set(request.requestId, controller);

    try {
      const cacheable = isGuidanceCacheable(request);
      const key = cacheable ? cacheKey(request) : "";
      if (cacheable && !request.bypassCache) {
        const cached = this.database.getGuidanceCache(key);
        if (cached) {
          try {
            const card = validateGuidanceCard(cached.card);
            onProgress?.({
              requestId: request.requestId,
              phase: "cache_hit",
              message: "已使用本地缓存。"
            });
            return {
              card,
              providerId: `cache/${cached.providerId}`,
              cached: true
            };
          } catch {
            // A prompt-version cache miss will normally avoid this path.
          }
        }
      }

      if (this.database.getSetting("zenAccepted") !== "true") {
        throw new ProviderFailure(
          "请先在齿轮中启用 Zen 免费通道。",
          "ZEN_TERMS_REQUIRED"
        );
      }

      const prompt = buildGuidancePrompt(request);
      const routingMode =
        this.database.getSetting("zenRoutingMode") === "fixed"
          ? "fixed"
          : "auto_fast";
      const models = this.orderedFreeModels(this.storedFreeModels(), routingMode);
      const attempts = models.slice(0, routingMode === "fixed" ? 1 : 2);
      let zenError: unknown;

      for (let index = 0; index < attempts.length; index += 1) {
        this.throwIfCancelled(controller.signal);
        const model = attempts[index];
        onProgress?.({
          requestId: request.requestId,
          phase: index === 0 ? "requesting" : "retrying",
          message:
            index === 0
              ? `正在使用 ${model.name}`
              : `当前免费模型不可用，切换到 ${model.name}`,
          modelName: model.name
        });
        const startedAt = this.now();
        try {
          const content = await this.requestZenText(
            model,
            prompt.system,
            prompt.user,
            prompt.maxTokens,
            AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(prompt.timeoutMs)
            ])
          );
          const card = parseGuidanceCard(content, request);
          this.markSuccess(model.id, this.now() - startedAt);
          const providerId = `zen-public/${model.id}`;
          if (cacheable) this.database.setGuidanceCache(key, card, providerId);
          return { card, providerId, cached: false };
        } catch (error) {
          this.throwIfCancelled(controller.signal);
          zenError = error;
          this.markFailure(model.id, error);
        }
      }

      this.throwIfCancelled(controller.signal);
      const fallback = await this.callFallback(request, controller.signal, onProgress);
      if (fallback) {
        if (cacheable) {
          this.database.setGuidanceCache(key, fallback.card, fallback.providerId);
        }
        return { ...fallback, cached: false };
      }
      throw new ProviderFailure(
        `免费模型暂时不可用。${this.describeError(zenError)}`,
        "SETUP_REQUIRED"
      );
    } finally {
      if (this.activeRequests.get(request.requestId) === controller) {
        this.activeRequests.delete(request.requestId);
      }
    }
  }

  private async callFallback(
    request: GuidanceRequest,
    signal: AbortSignal,
    onProgress?: (progress: GuidanceProgress) => void
  ): Promise<{ card: GuidanceCard; providerId: string } | undefined> {
    const active = this.database.getSetting("activeFallback") as
      | ProviderId
      | undefined;
    const consent = this.database.getSetting("fallbackConsent") === "true";
    if (!active || !consent) return undefined;
    const preset = presets.find(
      (item) => item.id === active && item.id !== "zen"
    );
    const apiKey = await this.secrets.get(active);
    if (!preset || !apiKey) return undefined;
    onProgress?.({
      requestId: request.requestId,
      phase: "fallback",
      message: `免费模型繁忙，正在使用 ${preset.name}`,
      modelName: preset.name
    });
    const card = await this.callOpenAI(
      preset.endpoint,
      preset.model,
      apiKey,
      request,
      signal
    );
    return { card, providerId: `${preset.id}/${preset.model}` };
  }

  private storedFreeModels(): StoredFreeModel[] {
    if (this.freeModelCache?.length) return this.freeModelCache;
    const stored = this.database.getSetting("zenFreeModels");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as StoredFreeModel[];
        const valid = parsed.filter(
          (model) =>
            typeof model.id === "string" &&
            typeof model.name === "string" &&
            (model.protocol === "openai" || model.protocol === "anthropic")
        );
        if (valid.length > 0) {
          this.freeModelCache = valid;
          return valid;
        }
      } catch {
        // Use the bundled bootstrap list.
      }
    }
    this.freeModelCache = [...defaultFreeModels];
    return this.freeModelCache;
  }

  private orderedFreeModels(
    models: StoredFreeModel[],
    routingMode: ModelRoutingMode
  ): StoredFreeModel[] {
    const selected = this.database.getSetting("activeZenModel");
    if (routingMode === "fixed") {
      const fixed = models.find((model) => model.id === selected);
      return fixed ? [fixed] : [];
    }
    const now = this.now();
    return models
      .filter((model) => {
        const health = this.health.get(model.id);
        return !health?.disabled && (health?.cooldownUntil ?? 0) <= now;
      })
      .sort((left, right) => this.modelScore(left.id) - this.modelScore(right.id));
  }

  private modelScore(modelId: string): number {
    const bootstrapIndex = fastModelPreference.indexOf(modelId);
    const bootstrap =
      (bootstrapIndex < 0 ? fastModelPreference.length : bootstrapIndex) * 700;
    const health = this.health.get(modelId);
    // A model that just succeeded should not be displaced by an unmeasured
    // candidate merely because the latter has a slightly better bootstrap rank.
    if (!health?.latencyMs) return 6_000 + bootstrap;
    return health.latencyMs + health.failures * 2_000 + bootstrap * 0.15;
  }

  private markSuccess(modelId: string, latencyMs: number): void {
    const previous = this.health.get(modelId);
    this.health.set(modelId, {
      latencyMs: previous?.latencyMs
        ? previous.latencyMs * 0.7 + latencyMs * 0.3
        : latencyMs,
      failures: 0,
      cooldownUntil: 0,
      disabled: false
    });
  }

  private markFailure(modelId: string, error: unknown): void {
    if (error instanceof ProviderFailure && error.code === "CANCELLED") return;
    const previous = this.health.get(modelId);
    const status =
      error instanceof ProviderHttpError ? error.status : undefined;
    this.health.set(modelId, {
      latencyMs: previous?.latencyMs,
      failures: (previous?.failures ?? 0) + 1,
      cooldownUntil:
        status === 429
          ? this.now() + RATE_LIMIT_COOLDOWN_MS
          : this.now() + HTTP_COOLDOWN_MS,
      disabled: status === 401 || previous?.disabled === true
    });
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new ProviderFailure("本次生成已取消。", "CANCELLED");
    }
  }

  private async discoverFreeModels(): Promise<StoredFreeModel[]> {
    const [metadataResponse, liveResponse] = await Promise.all([
      this.fetcher("https://models.dev/api.json", {
        headers: { "User-Agent": "opencode/algo-companion" },
        signal: AbortSignal.timeout(15_000)
      }),
      this.fetcher("https://opencode.ai/zen/v1/models", {
        signal: AbortSignal.timeout(12_000)
      })
    ]);
    if (!metadataResponse.ok) {
      throw new ProviderHttpError(
        `models.dev HTTP ${metadataResponse.status}`,
        metadataResponse.status
      );
    }
    if (!liveResponse.ok) {
      throw new ProviderHttpError(
        `Zen models HTTP ${liveResponse.status}`,
        liveResponse.status
      );
    }
    const metadata = (await metadataResponse.json()) as {
      opencode?: {
        npm?: string;
        models?: Record<string, ModelsDevModel>;
      };
    };
    const live = (await liveResponse.json()) as {
      data?: Array<{ id?: string }>;
    };
    const liveIds = new Set(
      (live.data ?? []).map((item) => item.id ?? "").filter(Boolean)
    );
    const provider = metadata.opencode;
    const models: StoredFreeModel[] = [];
    for (const value of Object.values(provider?.models ?? {})) {
      const id = value.id ?? "";
      if (
        !id ||
        !liveIds.has(id) ||
        value.status === "deprecated" ||
        value.cost?.input !== 0 ||
        value.cost?.output !== 0
      ) {
        continue;
      }
      const npm = value.provider?.npm ?? provider?.npm ?? "";
      models.push({
        id,
        name: value.name || id,
        protocol: npm.includes("anthropic") ? "anthropic" : "openai"
      });
    }
    for (const id of liveIds) {
      if (!id.endsWith("-free") || models.some((model) => model.id === id)) {
        continue;
      }
      models.push({ id, name: id, protocol: "openai" });
    }
    if (models.length === 0) {
      throw new ProviderHttpError("Zen 当前没有可用免费模型");
    }
    const preferenceRank = (modelId: string) => {
      const index = fastModelPreference.indexOf(modelId);
      return index < 0 ? fastModelPreference.length : index;
    };
    return models.sort(
      (left, right) =>
        preferenceRank(left.id) - preferenceRank(right.id) ||
        left.name.localeCompare(right.name)
    );
  }

  private async requestZenText(
    model: StoredFreeModel,
    system: string,
    user: string,
    maxTokens: number,
    signal: AbortSignal
  ): Promise<string> {
    if (model.protocol === "anthropic") {
      const response = await this.fetcher(
        "https://opencode.ai/zen/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": "public",
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            "User-Agent": "opencode/algo-companion",
            "x-opencode-client": "desktop"
          },
          body: JSON.stringify({
            model: model.id,
            system,
            messages: [{ role: "user", content: user }],
            temperature: 0.1,
            max_tokens: maxTokens,
            stream: false
          }),
          signal
        }
      );
      const body = (await response.json().catch(() => ({}))) as AnthropicResponse;
      if (!response.ok) {
        throw new ProviderHttpError(
          body.error?.message || `HTTP ${response.status}`,
          response.status
        );
      }
      const content = (body.content ?? [])
        .map((item) => item.text ?? "")
        .join("\n")
        .trim();
      if (!content) throw new ProviderHttpError(`${model.name} 没有返回文本`);
      return content;
    }
    const response = await this.fetcher(
      "https://opencode.ai/zen/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer public",
          "Content-Type": "application/json",
          "User-Agent": "opencode/algo-companion",
          "x-opencode-client": "desktop"
        },
        body: JSON.stringify({
          model: model.id,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ],
          temperature: 0.1,
          max_tokens: zenTokenBudget(maxTokens),
          ...(zenReasoningEffort(model.id)
            ? { reasoning_effort: zenReasoningEffort(model.id) }
            : {}),
          stream: false
        }),
        signal
      }
    );
    const body = (await response.json().catch(() => ({}))) as CompletionResponse;
    if (!response.ok) {
      throw new ProviderHttpError(
        body.error?.message || `HTTP ${response.status}`,
        response.status
      );
    }
    const content = openAIContent(body.choices);
    if (!content) throw new ProviderHttpError(`${model.name} 没有返回文本`);
    return content;
  }

  private async callOpenAI(
    endpoint: string,
    model: string,
    apiKey: string,
    request: GuidanceRequest,
    parentSignal: AbortSignal
  ): Promise<GuidanceCard> {
    const prompt = buildGuidancePrompt(request);
    const response = await this.fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        temperature: 0.1,
        max_tokens: prompt.maxTokens,
        response_format: { type: "json_object" },
        stream: false
      }),
      signal: AbortSignal.any([
        parentSignal,
        AbortSignal.timeout(request.allowSolution ? 25_000 : 12_000)
      ])
    });
    const body = (await response.json().catch(() => ({}))) as CompletionResponse;
    if (!response.ok) {
      throw new ProviderHttpError(
        body.error?.message || `HTTP ${response.status}`,
        response.status
      );
    }
    const content = openAIContent(body.choices);
    if (!content) throw new ProviderHttpError("模型没有返回文本");
    return parseGuidanceCard(content, request);
  }

  private describeError(error: unknown): string {
    if (!(error instanceof Error)) return "未知错误";
    if (error.name === "TimeoutError") return "请求超时";
    if (error instanceof ProviderHttpError && error.status === 429) {
      return "当前免费额度限流，请稍后重试或配置备用模型";
    }
    if (error instanceof ProviderHttpError && error.status === 401) {
      return "当前免费模型拒绝访问";
    }
    return error.message
      .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
      .slice(0, 160);
  }
}

export {
  buildGuidancePrompt,
  guidanceCacheIdentity,
  normalizeGuidanceCard
};
