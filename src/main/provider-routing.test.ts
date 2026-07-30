import { describe, expect, it } from "vitest";
import type { GuidanceCacheEntry, GuidanceRequest } from "../shared/contracts";
import type { DatabaseService } from "./database";
import { ProviderFailure, ProviderRouter } from "./provider-router";
import type { SecretStore } from "./secret-store";

class FakeDatabase {
  readonly settings = new Map<string, string>([["zenAccepted", "true"]]);
  readonly cache = new Map<string, GuidanceCacheEntry>();

  getSetting(key: string): string | undefined {
    return this.settings.get(key);
  }

  setSetting(key: string, value: string): void {
    this.settings.set(key, value);
  }

  getGuidanceCache(key: string): GuidanceCacheEntry | undefined {
    return this.cache.get(key);
  }

  setGuidanceCache(
    key: string,
    card: GuidanceCacheEntry["card"],
    providerId: string
  ): void {
    this.cache.set(key, { card, providerId });
  }
}

const secrets = {
  has: async () => false,
  get: async () => undefined,
  getPersistence: () => "none"
} as unknown as SecretStore;

function guidanceRequest(
  requestId: string,
  overrides: Partial<GuidanceRequest> = {}
): GuidanceRequest {
  return {
    requestId,
    draft: {
      sourceUrl: "https://example.invalid/problems/synthetic",
      title: "合成题",
      statement: "给定数组，返回满足条件的位置。",
      language: "cpp",
      code: "class Solution {};",
      latestResult: ""
    },
    stage: "understand",
    mode: "guided",
    hintLevel: 0,
    allowSnippet: false,
    allowSolution: false,
    ...overrides
  };
}

function successResponse(): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            type: "guided_start",
            understanding: "从数组中找到满足条件的位置并返回。",
            caution: "不要重复使用同一位置。",
            methods: [
              {
                id: "hash",
                name: "哈希表",
                action: "边遍历边查目标差值",
                complexity: "O(n)",
                recommended: true
              }
            ]
          })
        }
      }
    ]
  });
}

describe("fast provider routing", () => {
  it("cools down a 429 model, switches once, then serves local cache", async () => {
    const database = new FakeDatabase();
    const requestedModels: string[] = [];
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);
      return requestedModels.length === 1
        ? Response.json(
            { error: { message: "rate limited" } },
            { status: 429 }
          )
        : successResponse();
    }) as typeof fetch;
    const router = new ProviderRouter(
      database as unknown as DatabaseService,
      secrets,
      { fetch: fetcher, now: () => 1_000 }
    );

    const progress: string[] = [];
    const first = await router.generate(guidanceRequest("one"), (event) =>
      progress.push(event.phase)
    );
    const second = await router.generate(guidanceRequest("two"));

    expect(requestedModels).toEqual([
      "ling-3.0-flash-free",
      "north-mini-code-free"
    ]);
    expect(progress).toContain("retrying");
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(requestedModels).toHaveLength(2);
  });

  it("uses the Zen public-key protocol without forcing unsupported JSON mode", async () => {
    const database = new FakeDatabase();
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return successResponse();
    }) as typeof fetch;
    const router = new ProviderRouter(
      database as unknown as DatabaseService,
      secrets,
      { fetch: fetcher }
    );

    await router.generate(guidanceRequest("zen-protocol"));

    expect(requestBody?.model).toBe("ling-3.0-flash-free");
    expect(requestBody?.reasoning_effort).toBe("low");
    expect(requestBody?.max_tokens).toBe(1_400);
    expect(requestBody).not.toHaveProperty("response_format");
  });

  it("keeps a recently successful free model ahead of unmeasured models", async () => {
    const database = new FakeDatabase();
    const models: string[] = [];
    let clock = 1_000;
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      models.push(body.model);
      clock += 5_000;
      return successResponse();
    }) as typeof fetch;
    const router = new ProviderRouter(
      database as unknown as DatabaseService,
      secrets,
      { fetch: fetcher, now: () => clock }
    );

    await router.generate(
      guidanceRequest("first-non-cache", { stage: "implement" })
    );
    await router.generate(
      guidanceRequest("second-non-cache", { stage: "implement" })
    );

    expect(models).toEqual([
      "ling-3.0-flash-free",
      "ling-3.0-flash-free"
    ]);
  });

  it("never tries more than two free models in automatic mode", async () => {
    const database = new FakeDatabase();
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return Response.json(
        { error: { message: "rate limited" } },
        { status: 429 }
      );
    }) as typeof fetch;
    const router = new ProviderRouter(
      database as unknown as DatabaseService,
      secrets,
      { fetch: fetcher, now: () => 1_000 }
    );

    await expect(router.generate(guidanceRequest("limited"))).rejects.toBeInstanceOf(
      ProviderFailure
    );
    expect(calls).toBe(2);
  });

  it("fixed mode calls only the selected free model", async () => {
    const database = new FakeDatabase();
    database.settings.set("zenRoutingMode", "fixed");
    database.settings.set("activeZenModel", "deepseek-v4-flash-free");
    const models: string[] = [];
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      models.push(body.model);
      return Response.json({ error: { message: "busy" } }, { status: 429 });
    }) as typeof fetch;
    const router = new ProviderRouter(
      database as unknown as DatabaseService,
      secrets,
      { fetch: fetcher, now: () => 1_000 }
    );

    await expect(router.generate(guidanceRequest("fixed"))).rejects.toBeInstanceOf(
      ProviderFailure
    );
    expect(models).toEqual(["deepseek-v4-flash-free"]);
  });

  it("cancels an active request", async () => {
    const database = new FakeDatabase();
    const fetcher = ((_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted")),
          { once: true }
        );
      })) as typeof fetch;
    const router = new ProviderRouter(
      database as unknown as DatabaseService,
      secrets,
      { fetch: fetcher }
    );

    const pending = router.generate(guidanceRequest("cancel-me"));
    await Promise.resolve();
    router.cancel("cancel-me");

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
