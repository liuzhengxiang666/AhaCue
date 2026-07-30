import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import type {
  AppSnapshot,
  BrowserState,
  GuidanceCard,
  GuidanceProgress,
  GuidanceStage,
  GuidedStartCard,
  LearningMemory,
  OverlayMode,
  PracticeContext,
  PracticeMode,
  ProviderId,
  ProviderTestResult
} from "../shared/contracts";
import {
  makeProblemKey,
  nextHandwritingGuidance
} from "../shared/workflow";

type Route = "menu" | "guided" | "idea" | "direct" | "review";

const providerNames: Record<Exclude<ProviderId, "zen">, string> = {
  deepseek: "DeepSeek",
  dashscope: "阿里百炼 / 通义千问",
  zhipu: "智谱 GLM",
  moonshot: "Moonshot / Kimi",
  siliconflow: "SiliconFlow"
};

const stageNames: Record<GuidanceStage, string> = {
  understand: "题意",
  method: "选择方法",
  pseudocode: "伪代码",
  implement: "下一步",
  diagnose: "卡住诊断",
  result: "参考答案",
  review: "复习"
};

function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return "操作失败，请稍后重试。";
  return error.message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
    .replace(/^\[[A-Z_]+\]\s*/, "");
}

function Icon({
  name,
  size = 18
}: {
  name: "spark" | "gear" | "close" | "expand" | "back" | "undo" | "grip";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    spark: (
      <>
        <path d="M12 3l1.5 4.7L18 9.3l-4.5 1.6L12 15.6l-1.5-4.7L6 9.3l4.5-1.6L12 3Z" />
        <path d="m5 16 .7 1.8 1.8.7-1.8.7L5 21l-.7-1.8-1.8-.7 1.8-.7L5 16Z" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.4 3.1a8 8 0 0 0-1.8 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a8 8 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1Z" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    expand: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />,
    back: <path d="m15 18-6-6 6-6" />,
    undo: <path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" />,
    grip: (
      <>
        <circle cx="9" cy="8" r=".8" fill="currentColor" stroke="none" />
        <circle cx="15" cy="8" r=".8" fill="currentColor" stroke="none" />
        <circle cx="9" cy="12" r=".8" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r=".8" fill="currentColor" stroke="none" />
        <circle cx="9" cy="16" r=".8" fill="currentColor" stroke="none" />
        <circle cx="15" cy="16" r=".8" fill="currentColor" stroke="none" />
      </>
    )
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function MethodRows({
  card,
  onMethod
}: {
  card: GuidedStartCard;
  onMethod?: (method: string) => void;
}) {
  return (
    <div className="method-list">
      {card.methods.map((method) => (
        <button
          type="button"
          key={method.id}
          onClick={() => onMethod?.(method.name)}
        >
          <span className="method-topline">
            <strong>{method.name}</strong>
            {method.recommended && <small>推荐</small>}
          </span>
          <span className="method-action">{method.action}</span>
          <span className="method-complexity">{method.complexity}</span>
        </button>
      ))}
    </div>
  );
}

function DetailCard({
  card,
  onMethod,
  onInsert,
  onWrite
}: {
  card: GuidanceCard;
  onMethod?: (method: string) => void;
  onInsert?: (snippet: string) => void;
  onWrite?: (code: string) => void;
}) {
  if (card.type === "guided_start") {
    return (
      <article className="detail-card">
        <div className="detail-label">题意与方法</div>
        <p className="detail-lead">{card.understanding}</p>
        {card.caution && <p className="detail-caution">注意：{card.caution}</p>}
        <MethodRows card={card} onMethod={onMethod} />
      </article>
    );
  }
  if (card.type === "pseudocode") {
    return (
      <article className="detail-card">
        <div className="detail-label">{card.method}</div>
        <p className="detail-lead">{card.reason}</p>
        <ol className="steps">
          {card.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {card.edgeCases.length > 0 && (
          <div className="detail-section">
            <strong>边界</strong>
            {card.edgeCases.map((edge) => (
              <span key={edge}>{edge}</span>
            ))}
          </div>
        )}
        {card.apiNotes.length > 0 && (
          <div className="detail-section">
            <strong>API</strong>
            {card.apiNotes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
        )}
        {card.snippet && (
          <CodeBlock
            value={card.snippet}
            action="插入局部片段"
            onAction={() => onInsert?.(card.snippet!)}
          />
        )}
      </article>
    );
  }
  if (card.type === "hint") {
    return (
      <article className="detail-card">
        <div className="detail-label">下一步</div>
        <p className="detail-lead">{card.nextStep}</p>
        {card.reason && <p className="detail-secondary">{card.reason}</p>}
        {card.apiNote && (
          <div className="detail-section">
            <strong>API</strong>
            <span>{card.apiNote}</span>
          </div>
        )}
        {card.snippet && (
          <CodeBlock
            value={card.snippet}
            action="插入局部片段"
            onAction={() => onInsert?.(card.snippet!)}
          />
        )}
      </article>
    );
  }
  if (card.type === "diagnosis") {
    return (
      <article className="detail-card">
        <div className="detail-label">问题</div>
        <p className="detail-lead">{card.problem}</p>
        <div className="detail-section">
          <strong>最小修改</strong>
          <span>{card.fix}</span>
        </div>
        {card.apiNote && (
          <div className="detail-section">
            <strong>API</strong>
            <span>{card.apiNote}</span>
          </div>
        )}
        {card.snippet && (
          <CodeBlock
            value={card.snippet}
            action="插入局部片段"
            onAction={() => onInsert?.(card.snippet!)}
          />
        )}
      </article>
    );
  }
  if (card.type === "solution") {
    return (
      <article className="detail-card">
        <div className="detail-label">参考答案</div>
        <p className="detail-lead">{card.approach}</p>
        <CodeBlock
          value={card.code}
          action="写入完整代码"
          onAction={() => onWrite?.(card.code)}
        />
      </article>
    );
  }
  return (
    <article className="detail-card">
      <div className="detail-label">复习</div>
      <p className="detail-lead">{card.question}</p>
      {card.originalMethod && (
        <div className="detail-section">
          <strong>上次方法</strong>
          <span>{card.originalMethod}</span>
        </div>
      )}
      {card.blockers.length > 0 && (
        <div className="detail-section">
          <strong>真实卡点</strong>
          {card.blockers.map((blocker) => (
            <span key={blocker}>{blocker}</span>
          ))}
        </div>
      )}
    </article>
  );
}

function CodeBlock({
  value,
  action,
  onAction
}: {
  value: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="code-block">
      <pre>{value}</pre>
      <button type="button" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

function CompactCard({
  card,
  stage,
  revealMethods,
  onRevealMethods,
  onMethod,
  onBeginHandwriting,
  onHint,
  onOpenDrawer,
  onRestart,
  onInsert
}: {
  card: GuidanceCard;
  stage: GuidanceStage;
  revealMethods: boolean;
  onRevealMethods: () => void;
  onMethod: (method: string) => void;
  onBeginHandwriting: () => void;
  onHint: () => void;
  onOpenDrawer: () => void;
  onRestart: () => void;
  onInsert: (snippet: string) => void;
}) {
  if (card.type === "guided_start") {
    if (!revealMethods && stage === "understand") {
      return (
        <article className="compact-card">
          <div className="stage-label">题意</div>
          <p className="primary-copy">{card.understanding}</p>
          {card.caution && <p className="caution-copy">{card.caution}</p>}
          <div className="actions">
            <button className="primary" type="button" onClick={onRevealMethods}>
              我懂了，选择方法
            </button>
          </div>
        </article>
      );
    }
    return (
      <article className="compact-card">
        <div className="stage-label">选择方法</div>
        <MethodRows card={card} onMethod={onMethod} />
      </article>
    );
  }
  if (card.type === "pseudocode") {
    return (
      <article className="compact-card">
        <div className="stage-label">{card.method}</div>
        <p className="primary-copy">{card.reason}</p>
        <ol className="steps compact">
          {card.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="actions">
          <button
            className="primary"
            type="button"
            onClick={onBeginHandwriting}
          >
            开始手写
          </button>
          <button type="button" onClick={onOpenDrawer}>
            查看边界和 API
          </button>
        </div>
      </article>
    );
  }
  if (card.type === "hint") {
    return (
      <article className="compact-card">
        <div className="stage-label">只做这一步</div>
        <p className="primary-copy">{card.nextStep}</p>
        {card.reason && <p className="secondary-copy">{card.reason}</p>}
        <div className="actions">
          <button className="primary" type="button" onClick={onHint}>
            再给一点提示
          </button>
          {card.snippet && (
            <button type="button" onClick={() => onInsert(card.snippet!)}>
              插入片段
            </button>
          )}
        </div>
      </article>
    );
  }
  if (card.type === "diagnosis") {
    return (
      <article className="compact-card">
        <div className="stage-label">卡住诊断</div>
        <p className="primary-copy">{card.problem}</p>
        <p className="fix-copy">{card.fix}</p>
        <div className="actions">
          <button className="primary" type="button" onClick={onHint}>
            换个角度提示
          </button>
          {card.snippet && (
            <button type="button" onClick={() => onInsert(card.snippet!)}>
              插入片段
            </button>
          )}
        </div>
      </article>
    );
  }
  if (card.type === "solution") {
    return (
      <article className="compact-card">
        <div className="stage-label">参考答案</div>
        <p className="primary-copy">{card.approach}</p>
        <div className="actions">
          <button className="primary" type="button" onClick={onOpenDrawer}>
            查看完整代码
          </button>
        </div>
      </article>
    );
  }
  return (
    <article className="compact-card">
      <div className="stage-label">复习</div>
      <p className="primary-copy">{card.question}</p>
      {card.originalMethod && (
        <p className="secondary-copy">上次方法：{card.originalMethod}</p>
      )}
      <div className="actions">
        <button
          className="primary"
          type="button"
          onClick={onBeginHandwriting}
        >
          按原方法再做
        </button>
        <button type="button" onClick={onRestart}>
          忘了，重新引导
        </button>
      </div>
    </article>
  );
}

export function App() {
  const previousUrl = useRef("");
  const activeRequestId = useRef("");
  const handwritingActive = useRef(false);
  const dragGesture = useRef<
    | {
        pointerId: number;
        startX: number;
        startY: number;
        moved: boolean;
        click?: () => void;
      }
    | undefined
  >(undefined);
  const [initialized, setInitialized] = useState(false);
  const [learningUseChecked, setLearningUseChecked] = useState(false);
  const [overlay, setOverlayMode] = useState<OverlayMode>("collapsed");
  const [browser, setBrowser] = useState<BrowserState>();
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [context, setContext] = useState<PracticeContext>();
  const [route, setRoute] = useState<Route>("menu");
  const [stage, setStage] = useState<GuidanceStage>("understand");
  const [cards, setCards] = useState<GuidanceCard[]>([]);
  const [revealMethods, setRevealMethods] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState("");
  const [hintLevel, setHintLevel] = useState(0);
  const [memory, setMemory] = useState<LearningMemory>();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<GuidanceProgress>();
  const [notice, setNotice] = useState("");
  const [failureDot, setFailureDot] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [providerId, setProviderId] =
    useState<Exclude<ProviderId, "zen">>("deepseek");
  const [providerKey, setProviderKey] = useState("");
  const [providerTest, setProviderTest] = useState<ProviderTestResult>();
  const [freeModelTest, setFreeModelTest] = useState<ProviderTestResult>();
  const [testedKey, setTestedKey] = useState("");

  const latestCard = cards.at(-1);
  const problemKey = context?.draft ? makeProblemKey(context.draft) : "";
  const recentProblem = useMemo(
    () => snapshot?.recentProblems.find((problem) => problem.problemKey === problemKey),
    [problemKey, snapshot]
  );
  const canReview = Boolean(memory || recentProblem?.accepted);

  function setOverlay(mode: OverlayMode, contentHeight?: number) {
    setOverlayMode(mode);
    void window.practiceAPI.setOverlay({ mode, contentHeight });
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    click?: () => void
  ) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, option")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragGesture.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false,
      click
    };
    void window.practiceAPI.dragOverlay({
      phase: "start",
      screenX: event.screenX,
      screenY: event.screenY
    });
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      Math.hypot(
        event.screenX - gesture.startX,
        event.screenY - gesture.startY
      ) >= 4
    ) {
      gesture.moved = true;
    }
    void window.practiceAPI.dragOverlay({
      phase: "move",
      screenX: event.screenX,
      screenY: event.screenY
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    void window.practiceAPI.dragOverlay({
      phase: "end",
      screenX: event.screenX,
      screenY: event.screenY
    });
    dragGesture.current = undefined;
    if (!gesture.moved) gesture.click?.();
  }

  async function refreshSnapshot() {
    setSnapshot(await window.practiceAPI.getSnapshot());
  }

  async function cancelActive() {
    const requestId = activeRequestId.current;
    if (!requestId) return;
    activeRequestId.current = "";
    await window.practiceAPI.cancelGuidance(requestId);
  }

  function closeOverlay() {
    void cancelActive();
    setOverlay("collapsed", 420);
  }

  function resetForPage() {
    void cancelActive();
    setContext(undefined);
    setCards([]);
    setRoute("menu");
    setStage("understand");
    setRevealMethods(false);
    setSelectedMethod("");
    setHintLevel(0);
    handwritingActive.current = false;
    setMemory(undefined);
    setNotice("");
    setCanUndo(false);
    setBusy(false);
    setOverlay("collapsed", 420);
  }

  useEffect(() => {
    void Promise.all([
      window.practiceAPI.getSnapshot().then((next) => {
        setSnapshot(next);
        setInitialized(true);
        const mode = next.learningUseAttestation ? "collapsed" : "bubble";
        const contentHeight = next.learningUseAttestation ? 420 : 580;
        setOverlayMode(mode);
        return window.practiceAPI.setOverlay({ mode, contentHeight });
      }),
      window.practiceAPI.getBrowserState().then((state) => {
        previousUrl.current = state.url;
        setBrowser(state);
      })
    ]);
    const removeBrowser = window.practiceAPI.onBrowserState((state) => {
      setBrowser(state);
      if (previousUrl.current && previousUrl.current !== state.url) resetForPage();
      previousUrl.current = state.url;
    });
    const removeAttempt = window.practiceAPI.onAttemptDetected((event) => {
      setContext({
        recognized: true,
        draft: event.draft,
        capturedAt: new Date().toISOString()
      });
      setFailureDot(event.record.status !== "accepted");
      if (event.record.status === "accepted") handwritingActive.current = false;
      setNotice(
        event.record.status === "accepted"
          ? "已记录通过，之后可以从复习路线回来。"
          : "检测到本次失败，点悬浮球可分析。"
      );
      void refreshSnapshot();
    });
    const removeProgress = window.practiceAPI.onGuidanceProgress((next) => {
      if (next.requestId === activeRequestId.current) setProgress(next);
    });
    return () => {
      removeBrowser();
      removeAttempt();
      removeProgress();
    };
  }, []);

  useEffect(() => {
    if (!busy || !activeRequestId.current) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1_000)),
      1_000
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (overlay === "collapsed" || overlay === "drawer") return;
    let height = 300;
    if (overlay === "settings") {
      height = 680;
    } else if (busy) {
      height = 300;
    } else if (!context?.recognized) {
      height = 260;
    } else if (route === "menu") {
      height = canReview ? 430 : 350;
    } else if (latestCard?.type === "guided_start") {
      height = revealMethods ? 420 : 300;
    } else if (latestCard?.type === "pseudocode") {
      height = 420;
    } else if (latestCard?.type === "diagnosis") {
      height = 350;
    } else if (latestCard?.type === "hint" || latestCard?.type === "review") {
      height = 330;
    }
    if (notice && context?.recognized && height < 400) height += 56;
    void window.practiceAPI.setOverlay({ mode: overlay, contentHeight: height });
  }, [
    overlay,
    route,
    busy,
    notice,
    revealMethods,
    canReview,
    latestCard?.type,
    context?.recognized
  ]);

  async function readCurrentContext(): Promise<
    | {
        value: PracticeContext;
        memory?: LearningMemory;
      }
    | undefined
  > {
    const next = await window.practiceAPI.readPracticeContext();
    setContext(next);
    if (!next.recognized || !next.draft) {
      setNotice(next.reason || "当前页面暂未识别。");
      setMemory(undefined);
      return undefined;
    }
    const nextMemory = await window.practiceAPI.getProblemMemory(
      makeProblemKey(next.draft)
    );
    setMemory(nextMemory);
    return { value: next, memory: nextMemory };
  }

  async function openAgent() {
    setOverlay("bubble", 420);
    setFailureDot(false);
    if (handwritingActive.current) {
      setNotice("");
      await requestHint();
      return;
    }
    setBusy(true);
    setNotice("");
    setCards([]);
    setRoute("menu");
    setRevealMethods(false);
    try {
      await readCurrentContext();
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function ask(
    nextStage: GuidanceStage,
    mode: PracticeMode,
    nextHint: number,
    allowSnippet: boolean,
    allowSolution: boolean,
    method = selectedMethod,
    options: { bypassCache?: boolean; replace?: boolean } = {}
  ) {
    await cancelActive();
    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    setBusy(true);
    setElapsed(0);
    setProgress({
      requestId,
      phase: "requesting",
      message: "正在生成最短提示"
    });
    setNotice("");
    setStage(nextStage);
    setHintLevel(nextHint);
    try {
      const latest = await readCurrentContext();
      if (!latest?.value.draft) return;
      await window.practiceAPI.setWorkflowState({
        mode,
        stage: nextStage,
        selectedMethod: method || undefined
      });
      const result = await window.practiceAPI.generateGuidance({
        requestId,
        draft: latest.value.draft,
        stage: nextStage,
        mode,
        hintLevel: nextHint,
        selectedMethod: method || undefined,
        allowSnippet,
        allowSolution,
        bypassCache: options.bypassCache,
        memory: latest.memory
      });
      setCards((current) =>
        options.replace && current.length > 0
          ? [...current.slice(0, -1), result.card]
          : [...current, result.card]
      );
      if (result.cached) setNotice("已使用本地缓存，点击展开可重新生成。");
    } catch (error) {
      const message = messageOf(error);
      if (!message.includes("取消")) {
        setNotice(message);
        if (message.includes("启用 Zen")) {
          setRoute("menu");
          setOverlay("settings", 680);
        }
      }
    } finally {
      if (activeRequestId.current === requestId) activeRequestId.current = "";
      setBusy(false);
      setProgress(undefined);
    }
  }

  async function startRoute(nextRoute: Exclude<Route, "menu">) {
    setRoute(nextRoute);
    setCards([]);
    setRevealMethods(false);
    setSelectedMethod("");
    setHintLevel(0);
    handwritingActive.current = nextRoute === "idea";
    if (nextRoute === "guided") {
      await ask("understand", "guided", 0, false, false, "");
    } else if (nextRoute === "idea") {
      await ask("implement", "guided", 1, true, false, "");
    } else if (nextRoute === "direct") {
      await ask("result", "direct", 0, false, true, "");
    } else {
      await ask("review", "review", 0, false, false, memory?.methodName || "");
    }
  }

  function showMethodSelection() {
    setStage("method");
    setRevealMethods(true);
    void window.practiceAPI.setWorkflowState({
      mode: "guided",
      stage: "method"
    });
  }

  async function chooseMethod(method: string) {
    setSelectedMethod(method);
    await ask(
      "pseudocode",
      route === "review" ? "review" : "guided",
      0,
      true,
      false,
      method
    );
  }

  async function requestHint() {
    const next = nextHandwritingGuidance(hintLevel);
    await ask(
      next.stage,
      route === "review" ? "review" : "guided",
      next.hintLevel,
      true,
      false
    );
  }

  function beginHandwriting() {
    handwritingActive.current = true;
    setStage("implement");
    setNotice("");
    void window.practiceAPI.setWorkflowState({
      mode: route === "review" ? "review" : "guided",
      stage: "implement",
      selectedMethod: selectedMethod || undefined
    });
    closeOverlay();
  }

  async function regenerateCurrent() {
    const mode: PracticeMode =
      route === "direct" ? "direct" : route === "review" ? "review" : "guided";
    await ask(
      stage,
      mode,
      hintLevel,
      stage === "pseudocode" || stage === "implement" || stage === "diagnose",
      stage === "result",
      selectedMethod,
      { bypassCache: true, replace: true }
    );
  }

  async function mutateEditor(action: "snippet" | "solution", value: string) {
    setBusy(true);
    setNotice("");
    try {
      const result =
        action === "snippet"
          ? await window.practiceAPI.insertSnippet(value)
          : await window.practiceAPI.replaceSolution(value);
      setNotice(result.message);
      setCanUndo(result.canUndo);
      if (result.ok) setOverlay("bubble", 420);
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function undoEditor() {
    setBusy(true);
    try {
      const result = await window.practiceAPI.undoEditorChange();
      setNotice(result.message);
      setCanUndo(result.canUndo);
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setProviderTest(undefined);
    setTestedKey("");
    setNotice("");
    try {
      const result = await window.practiceAPI.testProvider({
        providerId,
        apiKey: providerKey
      });
      setProviderTest(result);
      setTestedKey(providerKey);
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveProvider() {
    setBusy(true);
    try {
      const settings = await window.practiceAPI.saveProviderKey({
        providerId,
        apiKey: providerKey,
        fallbackConsent: true
      });
      setSnapshot((current) =>
        current ? { ...current, providerSettings: settings } : current
      );
      setProviderKey("");
      setProviderTest(undefined);
      setTestedKey("");
      setNotice("备用模型已保存。");
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function acceptZen() {
    setBusy(true);
    setNotice("");
    try {
      const settings = await window.practiceAPI.acceptZenTerms();
      setSnapshot((current) =>
        current ? { ...current, providerSettings: settings } : current
      );
      setNotice("Zen 免费通道已启用。");
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshFreeModels() {
    setBusy(true);
    setFreeModelTest(undefined);
    setNotice("");
    try {
      const settings = await window.practiceAPI.refreshFreeModels();
      setSnapshot((current) =>
        current ? { ...current, providerSettings: settings } : current
      );
      setNotice(`已发现 ${settings.freeModels.length} 个在线免费模型。`);
    } catch (error) {
      setNotice(`刷新失败：${messageOf(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function selectFreeModel(modelId: string) {
    setBusy(true);
    setFreeModelTest(undefined);
    setNotice("");
    try {
      const settings = await window.practiceAPI.selectFreeModel(modelId);
      setSnapshot((current) =>
        current ? { ...current, providerSettings: settings } : current
      );
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function testSelectedFreeModel() {
    const settings = snapshot?.providerSettings;
    if (!settings) return;
    const modelId =
      settings.routingMode === "auto_fast"
        ? "auto"
        : settings.activeFreeModel;
    if (!modelId) return;
    setBusy(true);
    setFreeModelTest(undefined);
    setNotice("");
    try {
      setFreeModelTest(await window.practiceAPI.testFreeModel(modelId));
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmLearningUse() {
    if (!learningUseChecked) return;
    setBusy(true);
    setNotice("");
    try {
      const attestation = await window.practiceAPI.acceptLearningUse();
      setSnapshot((current) =>
        current
          ? { ...current, learningUseAttestation: attestation }
          : current
      );
      setOverlay("collapsed", 420);
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  if (!initialized) {
    return <main className="overlay-root" />;
  }

  if (!snapshot?.learningUseAttestation) {
    return (
      <main className="overlay-root">
        <section className="panel attestation-panel">
          <header
            className="panel-header drag-zone"
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span className="drag-indicator">
              <Icon name="grip" size={18} />
            </span>
            <div className="header-copy">
              <strong>Algo Companion</strong>
              <span>首次使用确认</span>
            </div>
            <span className="header-spacer" />
          </header>
          <div className="attestation-content">
            <div className="stage-label">学习用途</div>
            <h1>只在练习时帮助你思考</h1>
            <p>
              本工具会读取当前题目、代码和运行结果。请确认仅用于个人学习或非营利教育。
            </p>
            <ul>
              <li>不用于比赛、考试、面试或招聘测评</li>
              <li>不用于商业服务、作弊或自动提交</li>
              <li>遵守目标平台条款和内容权利</li>
            </ul>
            <label className="attestation-check">
              <input
                type="checkbox"
                checked={learningUseChecked}
                onChange={(event) =>
                  setLearningUseChecked(event.target.checked)
                }
              />
              <span>我确认仅将本工具用于个人学习和非营利教育。</span>
            </label>
            <button
              className="primary attestation-accept"
              type="button"
              disabled={!learningUseChecked || busy}
              onClick={() => void confirmLearningUse()}
            >
              {busy ? "正在保存" : "确认并进入"}
            </button>
            <button
              className="attestation-exit"
              type="button"
              disabled={busy}
              onClick={() => void window.practiceAPI.quitApp()}
            >
              不同意并退出
            </button>
            <small>确认记录只保存在本机，不会上传。</small>
            {notice && <div className="inline-notice">{notice}</div>}
          </div>
        </section>
      </main>
    );
  }

  if (overlay === "collapsed") {
    return (
      <main className="overlay-root collapsed-root">
        <div
          className="orb"
          role="button"
          tabIndex={0}
          aria-label="打开算法陪练；拖动可移动"
          aria-disabled={browser?.restricted}
          onPointerDown={(event) =>
            beginDrag(event, browser?.restricted ? undefined : () => void openAgent())
          }
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !browser?.restricted) {
              void openAgent();
            }
          }}
        >
          <Icon name="spark" size={24} />
          <span className="orb-grip">
            <Icon name="grip" size={14} />
          </span>
          {failureDot && <span className="failure-dot" />}
        </div>
      </main>
    );
  }

  const Header = ({
    title,
    subtitle,
    back
  }: {
    title: string;
    subtitle: string;
    back?: () => void;
  }) => (
    <header
      className="panel-header drag-zone"
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {back ? (
        <button className="icon-button" type="button" onClick={back}>
          <Icon name="back" />
        </button>
      ) : (
        <span className="drag-indicator">
          <Icon name="grip" size={18} />
        </span>
      )}
      <div className="header-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <button className="icon-button" type="button" onClick={closeOverlay}>
        <Icon name="close" />
      </button>
    </header>
  );

  if (overlay === "settings") {
    const settings = snapshot?.providerSettings;
    const configured =
      settings?.providers.filter(
        (provider) => provider.id !== "zen" && provider.hasKey
      ) ?? [];
    const selectedFree =
      settings?.routingMode === "auto_fast"
        ? "auto"
        : settings?.activeFreeModel ?? "auto";
    return (
      <main className="overlay-root">
        <section className="panel settings-panel">
          <Header
            title="模型设置"
            subtitle="默认自动选择较快的免费模型"
            back={() => setOverlay("bubble", 420)}
          />
          <div className="settings-content">
            <section className="setting-block status-row">
              <div>
                <strong>Zen 免费通道</strong>
                <span>可能限流，失败后可使用你的备用 Key</span>
              </div>
              {settings?.zenAccepted ? (
                <span className="status-ok">已启用</span>
              ) : (
                <button type="button" onClick={() => void acceptZen()}>
                  了解并启用
                </button>
              )}
            </section>

            <section className="setting-block form-stack">
              <label>
                免费模型策略
                <select
                  value={selectedFree}
                  disabled={busy}
                  onChange={(event) => void selectFreeModel(event.target.value)}
                >
                  <option value="auto">自动（快速）</option>
                  {(settings?.freeModels ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="model-meta">
                自动模式遇到限流会立即切换，最多尝试两个免费模型。
              </span>
              {freeModelTest && (
                <div className="success-message">
                  {freeModelTest.model}：{freeModelTest.message}
                </div>
              )}
              <div className="button-grid">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshFreeModels()}
                >
                  刷新列表
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void testSelectedFreeModel()}
                >
                  测试免费模型
                </button>
              </div>
            </section>

            <section className="setting-block form-stack">
              <label>
                国内备用服务商
                <select
                  value={providerId}
                  onChange={(event) => {
                    setProviderId(
                      event.target.value as Exclude<ProviderId, "zen">
                    );
                    setProviderTest(undefined);
                    setTestedKey("");
                  }}
                >
                  {Object.entries(providerNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                API Key
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="只保存在本机"
                  value={providerKey}
                  onChange={(event) => {
                    setProviderKey(event.target.value);
                    setProviderTest(undefined);
                    setTestedKey("");
                  }}
                />
              </label>
              {providerTest && (
                <div className="success-message">
                  {providerTest.providerName}：{providerTest.message}
                </div>
              )}
              <div className="button-grid">
                <button
                  type="button"
                  disabled={busy || providerKey.trim().length < 8}
                  onClick={() => void testConnection()}
                >
                  测试连接
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={
                    busy || testedKey !== providerKey || !providerTest?.ok
                  }
                  onClick={() => void saveProvider()}
                >
                  保存备用
                </button>
              </div>
            </section>

            {configured.length > 0 && (
              <section className="configured-list">
                {configured.map((provider) => (
                  <div key={provider.id}>
                    <span>
                      <strong>{provider.name}</strong>
                      <small>
                        {provider.activeFallback ? "当前备用" : "已保存"} ·{" "}
                        {provider.persistence === "encrypted"
                          ? "系统加密"
                          : "仅本次运行"}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const next = await window.practiceAPI.clearProviderKey(
                          provider.id
                        );
                        setSnapshot((current) =>
                          current
                            ? { ...current, providerSettings: next }
                            : current
                        );
                      }}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </section>
            )}
            {notice && <div className="inline-notice">{notice}</div>}
          </div>
        </section>
      </main>
    );
  }

  if (overlay === "drawer") {
    return (
      <main className="overlay-root">
        <section className="panel drawer-panel">
          <Header
            title={context?.draft?.title || "本题详情"}
            subtitle={`${context?.draft?.language.toUpperCase() || ""} · ${cards.length} 个步骤`}
            back={() => setOverlay("bubble", 420)}
          />
          <div className="drawer-toolbar">
            <span>{stageNames[stage]}</span>
            <button
              type="button"
              disabled={busy || cards.length === 0}
              onClick={() => void regenerateCurrent()}
            >
              重新生成本步
            </button>
          </div>
          <div className="drawer-content">
            {cards.map((card, index) => (
              <DetailCard
                key={`${card.type}-${index}`}
                card={card}
                onMethod={(method) => void chooseMethod(method)}
                onInsert={(snippet) => void mutateEditor("snippet", snippet)}
                onWrite={(code) => void mutateEditor("solution", code)}
              />
            ))}
            {canUndo && (
              <button
                className="undo-button"
                type="button"
                onClick={() => void undoEditor()}
              >
                <Icon name="undo" size={17} /> 撤销 Agent 写入
              </button>
            )}
            {notice && <div className="inline-notice">{notice}</div>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="overlay-root">
      <section className="panel bubble-panel">
        <header
          className="panel-header drag-zone"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="drag-indicator">
            <Icon name="grip" size={18} />
          </span>
          <div className="header-copy">
            <strong>{context?.draft?.title || "算法陪练"}</strong>
            <span>
              {context?.recognized && context.draft
                ? `已识别 · ${context.draft.language.toUpperCase()}`
                : "进入普通题目后开始"}
            </span>
          </div>
          <div className="header-actions">
            {cards.length > 0 && (
              <button
                className="icon-button"
                type="button"
                aria-label="展开详情"
                onClick={() => setOverlay("drawer")}
              >
                <Icon name="expand" size={17} />
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              aria-label="模型设置"
              onClick={() => {
                setNotice("");
                setOverlay("settings", 680);
              }}
            >
              <Icon name="gear" size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="收起"
              onClick={closeOverlay}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        <div className="bubble-content">
          {busy && (
            <div className="thinking">
              <span className="spinner" />
              <strong>{progress?.message || "正在生成最短提示"}</strong>
              {elapsed >= 3 && <small>已等待 {elapsed} 秒</small>}
              {elapsed >= 3 && activeRequestId.current && (
                <button type="button" onClick={() => void cancelActive()}>
                  取消
                </button>
              )}
            </div>
          )}

          {!busy && !context?.recognized && (
            <div className="empty-state">
              <strong>当前页面暂未识别</strong>
              <p>{notice || "请先进入力扣中国站的一道普通算法题。"}</p>
              <button type="button" onClick={() => void openAgent()}>
                重新识别
              </button>
            </div>
          )}

          {!busy && context?.recognized && route === "menu" && (
            <>
              <p className="route-intro">你现在卡在哪一步？</p>
              <div className="route-list">
                <button type="button" onClick={() => void startRoute("guided")}>
                  <strong>没思路</strong>
                  <span>一句话题意，然后选择方法</span>
                </button>
                <button type="button" onClick={() => void startRoute("idea")}>
                  <strong>有思路</strong>
                  <span>只看当前代码的下一步</span>
                </button>
                <button type="button" onClick={() => void startRoute("direct")}>
                  <strong>直接看答案</strong>
                  <span>一句方法说明和完整代码</span>
                </button>
                {canReview && (
                  <button type="button" onClick={() => void startRoute("review")}>
                    <strong>复习这题</strong>
                    <span>结合上次真实卡点</span>
                  </button>
                )}
              </div>
            </>
          )}

          {!busy && latestCard && (
            <CompactCard
              card={latestCard}
              stage={stage}
              revealMethods={revealMethods}
              onRevealMethods={showMethodSelection}
              onMethod={(method) => void chooseMethod(method)}
              onBeginHandwriting={beginHandwriting}
              onHint={() => void requestHint()}
              onOpenDrawer={() => setOverlay("drawer")}
              onRestart={() => void startRoute("guided")}
              onInsert={(snippet) => void mutateEditor("snippet", snippet)}
            />
          )}

          {notice && context?.recognized && (
            <div className="inline-notice">{notice}</div>
          )}
          {canUndo && (
            <button
              className="undo-button full"
              type="button"
              onClick={() => void undoEditor()}
            >
              <Icon name="undo" size={17} /> 撤销 Agent 写入
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
