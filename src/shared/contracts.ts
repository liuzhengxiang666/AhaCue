export const languages = ["cpp", "java", "python", "javascript"] as const;
export type PracticeLanguage = (typeof languages)[number];

export const guidanceStages = [
  "understand",
  "method",
  "pseudocode",
  "implement",
  "diagnose",
  "result",
  "review"
] as const;
export type GuidanceStage = (typeof guidanceStages)[number];

export type PracticeMode = "guided" | "direct" | "review";
export type AttemptTrigger = "run" | "submit";
export type AttemptStatus =
  | "not_run"
  | "compile_error"
  | "runtime_error"
  | "wrong_answer"
  | "time_limit"
  | "memory_limit"
  | "accepted"
  | "other";

export type ErrorCategory =
  | "none"
  | "problem_understanding"
  | "syntax"
  | "api_usage"
  | "null_or_empty"
  | "out_of_bounds"
  | "boundary"
  | "state_update"
  | "complexity"
  | "logic"
  | "unknown";

export interface ProblemDraft {
  sourceUrl: string;
  title: string;
  statement: string;
  language: PracticeLanguage;
  code: string;
  latestResult: string;
}

export interface ProblemSummary {
  problemKey: string;
  sourceUrl: string;
  title: string;
  language: PracticeLanguage;
  lastSeenAt: string;
  attemptCount: number;
  accepted: boolean;
}

export interface AttemptInput extends ProblemDraft {
  mode: PracticeMode;
  stage: GuidanceStage;
  trigger: AttemptTrigger;
  status: AttemptStatus;
  errorCategory?: ErrorCategory;
}

export interface AttemptRecord {
  id: string;
  problemKey: string;
  trigger: AttemptTrigger;
  status: AttemptStatus;
  errorCategory: ErrorCategory;
  code: string;
  resultText: string;
  stage: GuidanceStage;
  createdAt: string;
}

export type ReviewRating = "forgot" | "fuzzy" | "remembered";

export interface MemoryInput {
  problemKey: string;
  plainSummary: string;
  methodName: string;
  actualBlockers: string[];
  edgeCases: string[];
  apiGaps: string[];
  rating: ReviewRating;
}

export interface LearningMemory extends MemoryInput {
  reviewStep: number;
  reviewDueAt: string;
  updatedAt: string;
}

export interface ReviewItem {
  problem: ProblemSummary;
  memory: LearningMemory;
}

export interface GuidanceMethod {
  id: string;
  name: string;
  action: string;
  complexity: string;
  recommended: boolean;
}

export interface GuidedStartCard {
  type: "guided_start";
  understanding: string;
  caution?: string;
  methods: GuidanceMethod[];
}

export interface PseudocodeCard {
  type: "pseudocode";
  method: string;
  reason: string;
  steps: string[];
  apiNotes: string[];
  edgeCases: string[];
  snippet?: string;
}

export interface HintCard {
  type: "hint";
  nextStep: string;
  reason?: string;
  apiNote?: string;
  snippet?: string;
}

export interface DiagnosisCard {
  type: "diagnosis";
  problem: string;
  fix: string;
  apiNote?: string;
  snippet?: string;
}

export interface SolutionCard {
  type: "solution";
  approach: string;
  code: string;
}

export interface ReviewCard {
  type: "review";
  question: string;
  originalMethod?: string;
  blockers: string[];
}

export type GuidanceCard =
  | GuidedStartCard
  | PseudocodeCard
  | HintCard
  | DiagnosisCard
  | SolutionCard
  | ReviewCard;

export interface GuidanceRequest {
  requestId: string;
  draft: ProblemDraft;
  stage: GuidanceStage;
  mode: PracticeMode;
  hintLevel: number;
  selectedMethod?: string;
  allowSnippet: boolean;
  allowSolution: boolean;
  bypassCache?: boolean;
  memory?: LearningMemory;
}

export type ModelRoutingMode = "auto_fast" | "fixed";

export type GuidanceProgressPhase =
  | "cache_hit"
  | "requesting"
  | "retrying"
  | "fallback";

export interface GuidanceProgress {
  requestId: string;
  phase: GuidanceProgressPhase;
  message: string;
  modelName?: string;
}

export interface GuidanceGenerationResult {
  card: GuidanceCard;
  cached: boolean;
}

export type OverlaySide = "left" | "right";

export interface OverlayAnchor {
  side: OverlaySide;
  yRatio: number;
}

export interface OverlayDragInput {
  phase: "start" | "move" | "end";
  screenX: number;
  screenY: number;
}

export interface GuidanceCacheEntry {
  card: GuidanceCard;
  providerId: string;
}

export const providerIds = [
  "deepseek",
  "dashscope",
  "zhipu",
  "moonshot",
  "siliconflow",
  "zen"
] as const;
export type ProviderId = (typeof providerIds)[number];

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  hasKey: boolean;
  activeFallback: boolean;
  persistence: "encrypted" | "session_only" | "none";
}

export interface FreeModelInfo {
  id: string;
  name: string;
  protocol: "openai" | "anthropic";
}

export interface ProviderSettings {
  zenAccepted: boolean;
  freeModels: FreeModelInfo[];
  routingMode: ModelRoutingMode;
  activeFreeModel?: string;
  freeModelsUpdatedAt?: string;
  fallbackConsent: boolean;
  activeFallback?: ProviderId;
  providers: ProviderStatus[];
}

export interface ProviderTestInput {
  providerId: ProviderId;
  apiKey: string;
}

export interface ProviderTestResult {
  ok: boolean;
  providerId: ProviderId;
  providerName: string;
  model: string;
  message: string;
}

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  restricted: boolean;
  supported: boolean;
}

export type OverlayMode = "collapsed" | "bubble" | "drawer" | "settings";

export interface OverlayStateInput {
  mode: OverlayMode;
  contentHeight?: number;
}

export interface PracticeContext {
  recognized: boolean;
  reason?: string;
  draft?: ProblemDraft;
  capturedAt: string;
}

export interface ObservedAttempt {
  sequence: number;
  trigger: AttemptTrigger;
  status: AttemptStatus;
  draft: ProblemDraft;
}

export interface DetectedAttemptEvent {
  record: AttemptRecord;
  draft: ProblemDraft;
}

export interface EditorMutationResult {
  ok: boolean;
  message: string;
  code: string;
  canUndo: boolean;
}

export interface WorkflowRuntimeState {
  mode: PracticeMode;
  stage: GuidanceStage;
  selectedMethod?: string;
}

export interface AppSnapshot {
  providerSettings: ProviderSettings;
  recentProblems: ProblemSummary[];
  dueReviews: ReviewItem[];
}

export interface ProviderKeyInput {
  providerId: ProviderId;
  apiKey: string;
  fallbackConsent: boolean;
}

export interface ExportBundle {
  format: "algo-companion-export";
  version: 1;
  exportedAt: string;
  problems: unknown[];
  attempts: unknown[];
  memories: unknown[];
  guidanceEvents: unknown[];
  settings: unknown[];
}

export interface PracticeAPI {
  getSnapshot(): Promise<AppSnapshot>;
  onBrowserState(listener: (state: BrowserState) => void): () => void;
  getBrowserState(): Promise<BrowserState>;
  navigate(url: string): Promise<BrowserState>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  acceptZenTerms(): Promise<ProviderSettings>;
  refreshFreeModels(): Promise<ProviderSettings>;
  selectFreeModel(modelId: string): Promise<ProviderSettings>;
  testFreeModel(modelId: string): Promise<ProviderTestResult>;
  testProvider(input: ProviderTestInput): Promise<ProviderTestResult>;
  saveProviderKey(input: ProviderKeyInput): Promise<ProviderSettings>;
  clearProviderKey(providerId: ProviderId): Promise<ProviderSettings>;
  generateGuidance(request: GuidanceRequest): Promise<GuidanceGenerationResult>;
  cancelGuidance(requestId: string): Promise<void>;
  onGuidanceProgress(listener: (progress: GuidanceProgress) => void): () => void;
  setOverlay(input: OverlayStateInput): Promise<void>;
  dragOverlay(input: OverlayDragInput): Promise<void>;
  setWorkflowState(input: WorkflowRuntimeState): Promise<void>;
  readPracticeContext(): Promise<PracticeContext>;
  insertSnippet(snippet: string): Promise<EditorMutationResult>;
  replaceSolution(code: string): Promise<EditorMutationResult>;
  undoEditorChange(): Promise<EditorMutationResult>;
  onAttemptDetected(listener: (attempt: DetectedAttemptEvent) => void): () => void;
  saveMemory(input: MemoryInput): Promise<LearningMemory>;
  getProblemMemory(problemKey: string): Promise<LearningMemory | undefined>;
  getProblemHistory(problemKey: string): Promise<AttemptRecord[]>;
  exportData(): Promise<{ canceled: boolean; path?: string }>;
  importData(): Promise<{ canceled: boolean; imported?: number }>;
  deleteAllData(): Promise<void>;
}

export interface PlatformAdapter {
  readonly id: string;
  readonly mode: "automatic";
  supports(url: string): boolean;
}
