import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  AttemptInput,
  AttemptRecord,
  ExportBundle,
  GuidanceCacheEntry,
  GuidanceCard,
  GuidanceRequest,
  LearningMemory,
  MemoryInput,
  ProblemSummary,
  ReviewItem
} from "../shared/contracts";
import {
  calculateReviewSchedule,
  classifyResult,
  makeProblemKey
} from "../shared/workflow";

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export class DatabaseService {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, {
      open: true,
      allowExtension: false,
      timeout: 5_000
    });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA defensive = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS problems (
        problem_key TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        language TEXT NOT NULL,
        statement_digest TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        problem_key TEXT NOT NULL REFERENCES problems(problem_key) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        stage TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        error_category TEXT NOT NULL,
        code TEXT NOT NULL,
        result_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS attempts_problem_created
        ON attempts(problem_key, created_at DESC);

      CREATE TABLE IF NOT EXISTS memories (
        problem_key TEXT PRIMARY KEY REFERENCES problems(problem_key) ON DELETE CASCADE,
        plain_summary TEXT NOT NULL,
        method_name TEXT NOT NULL,
        actual_blockers_json TEXT NOT NULL,
        edge_cases_json TEXT NOT NULL,
        api_gaps_json TEXT NOT NULL,
        rating TEXT NOT NULL,
        review_step INTEGER NOT NULL,
        review_due_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS memories_due ON memories(review_due_at);

      CREATE TABLE IF NOT EXISTS guidance_events (
        id TEXT PRIMARY KEY,
        problem_key TEXT NOT NULL REFERENCES problems(problem_key) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        hint_level INTEGER NOT NULL,
        card_type TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS guidance_cache (
        cache_key TEXT PRIMARY KEY,
        card_json TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
  }

  private upsertProblem(input: {
    sourceUrl: string;
    title: string;
    language: string;
    statement: string;
  }): string {
    const problemKey = makeProblemKey(input);
    const now = new Date().toISOString();
    const digest = createHash("sha256").update(input.statement).digest("hex");
    this.db
      .prepare(`
        INSERT INTO problems (
          problem_key, source_url, title, language, statement_digest, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(problem_key) DO UPDATE SET
          source_url = excluded.source_url,
          title = excluded.title,
          language = excluded.language,
          statement_digest = excluded.statement_digest,
          last_seen_at = excluded.last_seen_at
      `)
      .run(problemKey, input.sourceUrl, input.title, input.language, digest, now, now);
    return problemKey;
  }

  recordAttempt(input: AttemptInput): AttemptRecord {
    const problemKey = this.upsertProblem(input);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const errorCategory =
      input.errorCategory && input.errorCategory !== "unknown"
        ? input.errorCategory
        : classifyResult(input.status, input.latestResult);
    this.db
      .prepare(`
        INSERT INTO attempts (
          id, problem_key, mode, stage, trigger, status, error_category,
          code, result_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        problemKey,
        input.mode,
        input.stage,
        input.trigger,
        input.status,
        errorCategory,
        input.code,
        input.latestResult,
        createdAt
      );
    return {
      id,
      problemKey,
      trigger: input.trigger,
      status: input.status,
      errorCategory,
      code: input.code,
      resultText: input.latestResult,
      stage: input.stage,
      createdAt
    };
  }

  recordGuidance(request: GuidanceRequest, card: GuidanceCard, providerId: string): void {
    const problemKey = this.upsertProblem(request.draft);
    this.db
      .prepare(`
        INSERT INTO guidance_events (
          id, problem_key, stage, hint_level, card_type, provider_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        problemKey,
        request.stage,
        request.hintLevel,
        card.type,
        providerId,
        new Date().toISOString()
      );
  }

  getGuidanceCache(cacheKey: string): GuidanceCacheEntry | undefined {
    const row = this.db
      .prepare(
        "SELECT card_json, provider_id FROM guidance_cache WHERE cache_key = ?"
      )
      .get(cacheKey) as Row | undefined;
    if (!row) return undefined;
    try {
      return {
        card: JSON.parse(asString(row.card_json)) as GuidanceCard,
        providerId: asString(row.provider_id)
      };
    } catch {
      this.db.prepare("DELETE FROM guidance_cache WHERE cache_key = ?").run(cacheKey);
      return undefined;
    }
  }

  setGuidanceCache(
    cacheKey: string,
    card: GuidanceCard,
    providerId: string
  ): void {
    this.db
      .prepare(`
        INSERT INTO guidance_cache(cache_key, card_json, provider_id, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          card_json = excluded.card_json,
          provider_id = excluded.provider_id,
          created_at = excluded.created_at
      `)
      .run(cacheKey, JSON.stringify(card), providerId, new Date().toISOString());
  }

  saveMemory(input: MemoryInput): LearningMemory {
    const existing = this.db
      .prepare("SELECT review_step FROM memories WHERE problem_key = ?")
      .get(input.problemKey) as Row | undefined;
    const schedule = calculateReviewSchedule(input.rating, asNumber(existing?.review_step));
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO memories (
          problem_key, plain_summary, method_name, actual_blockers_json,
          edge_cases_json, api_gaps_json, rating, review_step, review_due_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(problem_key) DO UPDATE SET
          plain_summary = excluded.plain_summary,
          method_name = excluded.method_name,
          actual_blockers_json = excluded.actual_blockers_json,
          edge_cases_json = excluded.edge_cases_json,
          api_gaps_json = excluded.api_gaps_json,
          rating = excluded.rating,
          review_step = excluded.review_step,
          review_due_at = excluded.review_due_at,
          updated_at = excluded.updated_at
      `)
      .run(
        input.problemKey,
        input.plainSummary,
        input.methodName,
        JSON.stringify(input.actualBlockers),
        JSON.stringify(input.edgeCases),
        JSON.stringify(input.apiGaps),
        input.rating,
        schedule.reviewStep,
        schedule.reviewDueAt,
        updatedAt
      );
    return {
      ...input,
      ...schedule,
      updatedAt
    };
  }

  listProblemHistory(problemKey: string): AttemptRecord[] {
    const rows = this.db
      .prepare(`
        SELECT id, problem_key, trigger, status, error_category, code,
               result_text, stage, created_at
        FROM attempts
        WHERE problem_key = ?
        ORDER BY created_at ASC
      `)
      .all(problemKey) as Row[];
    return rows.map((row) => ({
      id: asString(row.id),
      problemKey: asString(row.problem_key),
      trigger: asString(row.trigger) as AttemptRecord["trigger"],
      status: asString(row.status) as AttemptRecord["status"],
      errorCategory: asString(row.error_category) as AttemptRecord["errorCategory"],
      code: asString(row.code),
      resultText: asString(row.result_text),
      stage: asString(row.stage) as AttemptRecord["stage"],
      createdAt: asString(row.created_at)
    }));
  }

  listRecentProblems(limit = 12): ProblemSummary[] {
    const rows = this.db
      .prepare(`
        SELECT p.problem_key, p.source_url, p.title, p.language, p.last_seen_at,
               COUNT(a.id) AS attempt_count,
               MAX(CASE WHEN a.status = 'accepted' THEN 1 ELSE 0 END) AS accepted
        FROM problems p
        LEFT JOIN attempts a ON a.problem_key = p.problem_key
        GROUP BY p.problem_key
        ORDER BY p.last_seen_at DESC
        LIMIT ?
      `)
      .all(limit) as Row[];
    return rows.map((row) => ({
      problemKey: asString(row.problem_key),
      sourceUrl: asString(row.source_url),
      title: asString(row.title),
      language: asString(row.language) as ProblemSummary["language"],
      lastSeenAt: asString(row.last_seen_at),
      attemptCount: asNumber(row.attempt_count),
      accepted: Boolean(asNumber(row.accepted))
    }));
  }

  getMemory(problemKey: string): LearningMemory | undefined {
    const row = this.db
      .prepare(`
        SELECT problem_key, plain_summary, method_name, actual_blockers_json,
               edge_cases_json, api_gaps_json, rating, review_step,
               review_due_at, updated_at
        FROM memories
        WHERE problem_key = ?
      `)
      .get(problemKey) as Row | undefined;
    if (!row) return undefined;
    return {
      problemKey: asString(row.problem_key),
      plainSummary: asString(row.plain_summary),
      methodName: asString(row.method_name),
      actualBlockers: parseStringArray(row.actual_blockers_json),
      edgeCases: parseStringArray(row.edge_cases_json),
      apiGaps: parseStringArray(row.api_gaps_json),
      rating: asString(row.rating) as LearningMemory["rating"],
      reviewStep: asNumber(row.review_step),
      reviewDueAt: asString(row.review_due_at),
      updatedAt: asString(row.updated_at)
    };
  }

  listDueReviews(now = new Date().toISOString()): ReviewItem[] {
    const rows = this.db
      .prepare(`
        SELECT p.problem_key, p.source_url, p.title, p.language, p.last_seen_at,
               m.plain_summary, m.method_name, m.actual_blockers_json,
               m.edge_cases_json, m.api_gaps_json, m.rating, m.review_step,
               m.review_due_at, m.updated_at,
               (SELECT COUNT(*) FROM attempts a WHERE a.problem_key = p.problem_key) AS attempt_count,
               (SELECT MAX(CASE WHEN a.status = 'accepted' THEN 1 ELSE 0 END)
                  FROM attempts a WHERE a.problem_key = p.problem_key) AS accepted
        FROM memories m
        JOIN problems p ON p.problem_key = m.problem_key
        WHERE m.review_due_at <= ?
        ORDER BY m.review_due_at ASC
      `)
      .all(now) as Row[];
    return rows.map((row) => ({
      problem: {
        problemKey: asString(row.problem_key),
        sourceUrl: asString(row.source_url),
        title: asString(row.title),
        language: asString(row.language) as ProblemSummary["language"],
        lastSeenAt: asString(row.last_seen_at),
        attemptCount: asNumber(row.attempt_count),
        accepted: Boolean(asNumber(row.accepted))
      },
      memory: {
        problemKey: asString(row.problem_key),
        plainSummary: asString(row.plain_summary),
        methodName: asString(row.method_name),
        actualBlockers: parseStringArray(row.actual_blockers_json),
        edgeCases: parseStringArray(row.edge_cases_json),
        apiGaps: parseStringArray(row.api_gaps_json),
        rating: asString(row.rating) as LearningMemory["rating"],
        reviewStep: asNumber(row.review_step),
        reviewDueAt: asString(row.review_due_at),
        updatedAt: asString(row.updated_at)
      }
    }));
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | Row
      | undefined;
    return row ? asString(row.value) : undefined;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(`
        INSERT INTO settings(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, value);
  }

  exportData(): ExportBundle {
    const selectAll = (table: string): unknown[] =>
      this.db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
    return {
      format: "algo-companion-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      problems: selectAll("problems"),
      attempts: selectAll("attempts"),
      memories: selectAll("memories"),
      guidanceEvents: selectAll("guidance_events"),
      settings: (selectAll("settings") as Row[]).filter((row) =>
        ["zenAccepted", "fallbackConsent", "activeFallback"].includes(asString(row.key))
      )
    };
  }

  importData(bundle: ExportBundle): number {
    if (bundle.format !== "algo-companion-export" || bundle.version !== 1) {
      throw new Error("不支持的数据备份格式。");
    }
    const insertProblem = this.db.prepare(`
      INSERT OR REPLACE INTO problems
      (problem_key, source_url, title, language, statement_digest, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAttempt = this.db.prepare(`
      INSERT OR REPLACE INTO attempts
      (id, problem_key, mode, stage, trigger, status, error_category, code, result_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMemory = this.db.prepare(`
      INSERT OR REPLACE INTO memories
      (problem_key, plain_summary, method_name, actual_blockers_json, edge_cases_json,
       api_gaps_json, rating, review_step, review_due_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let imported = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const value of bundle.problems) {
        const row = value as Row;
        insertProblem.run(
          asString(row.problem_key),
          asString(row.source_url),
          asString(row.title),
          asString(row.language),
          asString(row.statement_digest),
          asString(row.first_seen_at),
          asString(row.last_seen_at)
        );
        imported += 1;
      }
      for (const value of bundle.attempts) {
        const row = value as Row;
        insertAttempt.run(
          asString(row.id),
          asString(row.problem_key),
          asString(row.mode),
          asString(row.stage),
          asString(row.trigger),
          asString(row.status),
          asString(row.error_category),
          asString(row.code),
          asString(row.result_text),
          asString(row.created_at)
        );
        imported += 1;
      }
      for (const value of bundle.memories) {
        const row = value as Row;
        insertMemory.run(
          asString(row.problem_key),
          asString(row.plain_summary),
          asString(row.method_name),
          asString(row.actual_blockers_json),
          asString(row.edge_cases_json),
          asString(row.api_gaps_json),
          asString(row.rating),
          asNumber(row.review_step),
          asString(row.review_due_at),
          asString(row.updated_at)
        );
        imported += 1;
      }
      this.db.exec("COMMIT");
      return imported;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  deleteAllData(): void {
    this.db.exec(`
      BEGIN IMMEDIATE;
      DELETE FROM guidance_cache;
      DELETE FROM guidance_events;
      DELETE FROM memories;
      DELETE FROM attempts;
      DELETE FROM problems;
      DELETE FROM settings;
      COMMIT;
    `);
  }

  close(): void {
    this.db.close();
  }
}
